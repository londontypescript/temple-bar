// A stand-in for GitHub's REST API on localhost, answering only what the
// judge reads: a pull request, its list of changed files, and the files in
// the repository at a ref. The installed judge is pointed at it through
// GITHUB_API_URL, the variable GitHub sets for its own Actions, so the
// packed judge runs for real without GitHub.
//
// It can also answer the way GitHub does when something is off: a file
// count that doesn't match the list, a path listed twice, a head or base
// that moves while the judge is reading, or a tree too big to list whole.
// The judge must fail closed on each, so the tests need a GitHub that can
// say them.

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

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
type FakeTrees = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

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

/** An object's id: its kind, ref and path, so no two objects share one and
 * the routes can find it again without a table. */
function objectId(kind: "blob" | "tree", ref: string, at: string): string {
  return Buffer.from(`${kind}\0${ref}\0${at}`, "utf8").toString("base64url");
}

function fromObjectId(id: string): string[] {
  return Buffer.from(id, "base64url").toString("utf8").split("\0");
}

/** Every folder above a file, nearest the root first: "a/b/c.json" gives
 * "a" and "a/b". */
function foldersOf(filePath: string): string[] {
  const parts = filePath.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The files and folders under `folder` ("" for the root), by their path
 * below it: only its own children, or everything with `recursive`. */
function listTree(
  ref: string,
  files: ReadonlyMap<string, string>,
  folder: string,
  recursive: boolean,
): { path: string; type: string; sha: string }[] {
  const prefix = folder === "" ? "" : `${folder}/`;
  const below = (full: string) =>
    full.startsWith(prefix) && full !== folder
      ? full.slice(prefix.length)
      : undefined;
  const entries = new Map<
    string,
    { path: string; type: string; sha: string }
  >();
  for (const filePath of files.keys()) {
    for (const dir of foldersOf(filePath)) {
      const rel = below(dir);
      if (rel !== undefined && (recursive || !rel.includes("/"))) {
        entries.set(rel, {
          path: rel,
          type: "tree",
          sha: objectId("tree", ref, dir),
        });
      }
    }
    const rel = below(filePath);
    if (rel !== undefined && (recursive || !rel.includes("/"))) {
      entries.set(rel, {
        path: rel,
        type: "blob",
        sha: objectId("blob", ref, filePath),
      });
    }
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
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
  const refs = new Map(
    Object.entries(trees).map(([ref, files]) => [
      ref,
      new Map(Object.entries(files)),
    ]),
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
    const ref = url.searchParams.get("ref") ?? "";
    const files = refs.get(ref);
    const text = files?.get(at);
    if (files === undefined) {
      notFound(res);
    } else if (text !== undefined) {
      reply(res, 200, {
        type: "file",
        path: at,
        content: base64(text),
        encoding: "base64",
      });
    } else {
      const entries = listTree(ref, files, at, false);
      if (entries.length === 0) {
        notFound(res);
        return;
      }
      reply(
        res,
        200,
        entries.map((entry) => ({
          type: entry.type === "tree" ? "dir" : "file",
          name: entry.path,
          path: at === "" ? entry.path : `${at}/${entry.path}`,
          sha: entry.sha,
        })),
      );
    }
  }

  // A ref names its root tree; a tree's id names a folder inside one.
  function tree(res: ServerResponse, id: string, url: URL): void {
    const [kind, idRef, idFolder] = fromObjectId(id);
    const [ref, folder] = refs.has(id)
      ? [id, ""]
      : kind === "tree"
        ? [idRef, idFolder]
        : [];
    const files = ref === undefined ? undefined : refs.get(ref);
    if (ref === undefined || folder === undefined || files === undefined) {
      notFound(res);
      return;
    }
    const recursive = url.searchParams.get("recursive") !== null;
    const entries = listTree(ref, files, folder, recursive);
    const cut = recursive && truncated.includes(ref);
    reply(res, 200, {
      sha: id,
      tree: cut ? entries.slice(0, Math.ceil(entries.length / 2)) : entries,
      truncated: cut,
    });
  }

  function blob(res: ServerResponse, id: string): void {
    const [kind, ref, at] = fromObjectId(id);
    const text =
      kind === "blob" && ref !== undefined && at !== undefined
        ? refs.get(ref)?.get(at)
        : undefined;
    if (text === undefined) {
      notFound(res);
      return;
    }
    reply(res, 200, { sha: id, content: base64(text), encoding: "base64" });
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
