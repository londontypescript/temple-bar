// A stand-in for GitHub's REST API on localhost, answering only what the
// judge reads: a pull request, its list of changed files, and the files in
// the repository at a ref. The installed judge is pointed at it through
// GITHUB_API_URL, the variable GitHub sets for its own Actions, so the
// packed judge runs for real without GitHub.
//
// Files carry git's modes (regular, executable, symlink, submodule) and git's
// own object ids, so the same content has the same id at every ref.
//
// It can also answer the way GitHub does when something is off: a file
// count that doesn't match the list, a path listed twice, a head or base
// that moves while the judge is reading, or a tree too big to list whole.
// The judge must fail closed on each, so the tests need a GitHub that can
// say them.

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  entryAt,
  listTree,
  writeGitObjects,
  type FakeFile,
  type TreeEntry,
} from "./fake-git-objects.ts";

/** A changed file as GitHub lists it. A bare path means "modified". */
interface FakeChangedFile {
  readonly filename: string;
  readonly status: "added" | "modified" | "removed" | "renamed";
  /** The old path, for a rename. */
  readonly previousFilename?: string;
}

export interface FakePullRequest {
  readonly number: number;
  /** Listed in this order, duplicates included. */
  readonly files: readonly (string | FakeChangedFile)[];
  /** The count GitHub claims. Defaults to the length of `files`; set it to
   * something else to send a list that doesn't match. */
  readonly changedFiles?: number;
  /** The head commit on each read of the pull request, in order; the last
   * one repeats. More than one makes the head move mid-judgement. Defaults
   * to a single head of forty "a"s. */
  readonly headShas?: readonly string[];
  readonly baseRef?: string;
  /** The base commit on each read, in the same way. */
  readonly baseShas?: readonly string[];
}

/** The files in the repository at each ref (a branch name or a commit
 * sha), by path from the root. A path missing from a ref is absent there. */
type FakeTrees = Readonly<Record<string, Readonly<Record<string, FakeFile>>>>;

export interface FakeRepository {
  /** The files at each ref; see FakeTrees. */
  readonly trees?: FakeTrees;
  /** Each branch's tip on each read of it, in order; the last one repeats.
   * More than one makes the branch move mid-judgement. */
  readonly branches?: Readonly<Record<string, readonly string[]>>;
  /** Refs whose recursive tree GitHub cuts short, saying so with
   * `truncated: true`, as it does for a very large repository. */
  readonly truncated?: readonly string[];
}

export interface FakeGithubApi {
  /** The API's base address, without a trailing slash. */
  readonly url: string;
  /** Every path requested so far, query included, in order. */
  readonly requests: readonly string[];
  close(): Promise<void>;
}

const DEFAULT_HEAD = "a".repeat(40);
const DEFAULT_BASE_SHA = "b".repeat(40);
/** GitHub's own largest page, and the most files it lists for a pull
 * request however many it changes. */
const MAX_PAGE = 100;
const MAX_FILES = 3000;

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  reply(res, 404, { message: "Not Found" });
}

/** The answer for this read of something that moves: the next in line,
 * then the last one for good. */
function nth<T>(answers: readonly T[], read: number): T | undefined {
  return answers[Math.min(read, answers.length - 1)];
}

function toEntry(file: string | FakeChangedFile): Record<string, string> {
  if (typeof file === "string") {
    return { filename: file, status: "modified" };
  }
  return file.previousFilename === undefined
    ? { filename: file.filename, status: file.status }
    : {
        filename: file.filename,
        status: file.status,
        previous_filename: file.previousFilename,
      };
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** How the contents API names an entry in a folder's list. For backwards
 * compatibility GitHub lists symlinks and submodules there as files. */
function contentsType(entry: TreeEntry): string {
  return entry.type === "tree" ? "dir" : "file";
}

export function serveFakeGithubApi(
  owner: string,
  repo: string,
  pullRequests: readonly FakePullRequest[],
  { trees = {}, branches = {}, truncated = [] }: FakeRepository = {},
): Promise<FakeGithubApi> {
  const requests: string[] = [];
  const reads = new Map<string, number>();
  const prefix = `/repos/${owner}/${repo}`;
  // Maps rather than the objects the tests pass, so a path such as
  // "constructor" is absent, as on GitHub, not an inherited property.
  const objects = writeGitObjects(
    new Map(
      Object.entries(trees).map(([ref, files]) => [
        ref,
        new Map(Object.entries(files)),
      ]),
    ),
  );
  const tips = new Map(Object.entries(branches));

  function readCount(key: string): number {
    const count = reads.get(key) ?? 0;
    reads.set(key, count + 1);
    return count;
  }

  function pull(res: ServerResponse, pr: FakePullRequest): void {
    const read = readCount(`pull ${String(pr.number)}`);
    reply(res, 200, {
      number: pr.number,
      head: { sha: nth(pr.headShas ?? [DEFAULT_HEAD], read) },
      base: {
        ref: pr.baseRef ?? "main",
        sha: nth(pr.baseShas ?? [DEFAULT_BASE_SHA], read),
      },
      changed_files: pr.changedFiles ?? pr.files.length,
    });
  }

  function files(res: ServerResponse, pr: FakePullRequest, url: URL): void {
    const perPage = Math.min(
      Number(url.searchParams.get("per_page") ?? "30"),
      MAX_PAGE,
    );
    const page = Number(url.searchParams.get("page") ?? "1");
    const start = (page - 1) * perPage;
    const listed = pr.files.slice(0, MAX_FILES);
    reply(res, 200, listed.slice(start, start + perPage).map(toEntry));
  }

  function branch(res: ServerResponse, name: string): void {
    const answers = tips.get(name);
    if (answers === undefined || answers.length === 0) {
      notFound(res);
      return;
    }
    reply(res, 200, {
      ref: `refs/heads/${name}`,
      object: {
        type: "commit",
        sha: nth(answers, readCount(`branch ${name}`)),
      },
    });
  }

  // A file's text, or a folder's entries, as the contents API gives them.
  function contents(res: ServerResponse, at: string, url: URL): void {
    const root = objects.roots.get(url.searchParams.get("ref") ?? "");
    const entry =
      root === undefined || at === ""
        ? undefined
        : entryAt(objects.trees, root, at);
    const folder =
      at === "" ? root : entry?.type === "tree" ? entry.sha : undefined;
    if (folder !== undefined) {
      reply(
        res,
        200,
        listTree(objects.trees, folder, false).map((item) => ({
          type: contentsType(item),
          name: item.path,
          path: at === "" ? item.path : `${at}/${item.path}`,
          sha: item.sha,
        })),
      );
    } else if (entry?.mode === "160000") {
      reply(res, 200, { type: "submodule", path: at, sha: entry.sha });
    } else if (entry?.mode === "120000") {
      const target = objects.blobs.get(entry.sha);
      reply(res, 200, { type: "symlink", path: at, sha: entry.sha, target });
    } else if (entry !== undefined) {
      reply(res, 200, {
        type: "file",
        path: at,
        sha: entry.sha,
        content: base64(objects.blobs.get(entry.sha) ?? ""),
        encoding: "base64",
      });
    } else {
      notFound(res);
    }
  }

  // A ref, or a commit sha the tests gave files for, names its root tree;
  // any other id is a tree's own.
  function tree(res: ServerResponse, id: string, url: URL): void {
    const sha = objects.roots.get(id) ?? id;
    if (!objects.trees.has(sha)) {
      notFound(res);
      return;
    }
    const recursive = url.searchParams.get("recursive") !== null;
    const entries = listTree(objects.trees, sha, recursive);
    const cut = recursive && truncated.includes(id);
    reply(res, 200, {
      sha,
      tree: cut ? entries.slice(0, Math.ceil(entries.length / 2)) : entries,
      truncated: cut,
    });
  }

  function blob(res: ServerResponse, id: string): void {
    const text = objects.blobs.get(id);
    if (text === undefined) {
      notFound(res);
      return;
    }
    reply(res, 200, {
      sha: id,
      size: Buffer.byteLength(text),
      content: base64(text),
      encoding: "base64",
    });
  }

  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "/");
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = url.pathname.startsWith(`${prefix}/`)
      ? url.pathname.slice(prefix.length)
      : "";
    const pulls = /^\/pulls\/(\d+)(\/files)?$/.exec(route);
    const pr = pullRequests.find(
      (entry) => String(entry.number) === pulls?.[1],
    );
    if (pulls !== null && pr !== undefined) {
      if (pulls[2] === undefined) {
        pull(res, pr);
      } else {
        files(res, pr, url);
      }
      return;
    }
    // Matched before decoding: a ref such as "feature/x" arrives as one
    // encoded segment, and decoding first would split it in two.
    const routes: readonly [RegExp, (part: string) => void][] = [
      [
        /^\/contents(?:\/(.*))?$/,
        (part) => {
          contents(res, part, url);
        },
      ],
      [
        /^\/git\/ref\/heads\/(.+)$/,
        (part) => {
          branch(res, part);
        },
      ],
      [
        /^\/git\/trees\/([^/]+)$/,
        (part) => {
          tree(res, part, url);
        },
      ],
      [
        /^\/git\/blobs\/([^/]+)$/,
        (part) => {
          blob(res, part);
        },
      ],
    ];
    for (const [pattern, answer] of routes) {
      const match = pattern.exec(route);
      if (match !== null) {
        // The contents API's root has no path at all.
        answer(decodeURIComponent(match[1] ?? ""));
        return;
      }
    }
    notFound(res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
