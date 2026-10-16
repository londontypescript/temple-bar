// A stand-in for GitHub's REST API on localhost, answering only what the
// judge reads: a pull request, its base branch's tip, a commit's whole tree,
// and a file's blob. The installed judge is pointed at it through
// GITHUB_API_URL, the variable GitHub sets for its own Actions, so the
// packed judge runs for real without GitHub.
//
// Files carry git's modes (regular, executable, symlink, submodule) and git's
// own object ids, so the same content has the same id at every ref.
//
// It can also answer the way GitHub does when something is off: a head or
// base that moves while the judge is reading, or a tree too big to list
// whole. The judge must fail closed on each, so the tests need a GitHub that
// can say them.

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  listTree,
  writeGitObjects,
  type FakeFile,
} from "./fake-git-objects.ts";

export interface FakePullRequest {
  readonly number: number;
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

/** Base64 as GitHub sends it, broken into lines of 60 characters, so a
 * reader that can't take the line breaks fails here as it would there. */
function base64(text: string): string {
  const flat = Buffer.from(text, "utf8").toString("base64");
  return (
    (flat.match(/.{1,60}/g) ?? [""]).join("\n") + (flat === "" ? "" : "\n")
  );
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
    });
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
    // GitHub's limit is on the tree, so asking for it by its own id is cut
    // short too.
    const cut =
      recursive &&
      truncated.some((ref) => ref === id || objects.roots.get(ref) === sha);
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
    const pulls = /^\/pulls\/(\d+)$/.exec(route);
    const pr = pullRequests.find(
      (entry) => String(entry.number) === pulls?.[1],
    );
    if (pulls !== null && pr !== undefined) {
      pull(res, pr);
      return;
    }
    // Matched before decoding: a ref such as "feature/x" arrives as one
    // encoded segment, and decoding first would split it in two.
    const routes: readonly [RegExp, (part: string) => void][] = [
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
