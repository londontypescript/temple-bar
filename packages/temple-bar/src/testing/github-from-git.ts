// A fake of GitHub's API, as far as the judge reads it, answering from a
// real git repository: pull request #7 of acme/widgets, its base branch's
// tip, whole trees and blobs, with git's own modes and object ids. Tests can
// move the head or the base between reads, and replace any answer to see
// the judge fail closed on it. Excluded from the built package
// (tsconfig.build.json).

import { execFileSync } from "node:child_process";

import type { HttpResult } from "../seams/http.ts";
import { createFakeHttp, type FakeHttp } from "./fakes.ts";

export const API = "https://api.github.com/repos/acme/widgets";

export interface GithubScript {
  /** The repository the trees and blobs come from. */
  readonly dir: string;
  /** The head commit on each read of the pull request; the last repeats. */
  readonly heads: readonly string[];
  /** The base branch on each read of the pull request; the last repeats.
   * "main" when not given. */
  readonly baseRefs?: readonly string[];
  /** The base branch's tip on each read of it; the last repeats. */
  readonly tips: readonly string[];
  /** An answer to use instead of the repository's, for a URL it matches. */
  readonly override?: (url: string) => HttpResult | undefined;
}

const json = (value: unknown): HttpResult => ({
  kind: "response",
  status: 200,
  body: JSON.stringify(value),
});

const notFound: HttpResult = { kind: "response", status: 404, body: "{}" };

function nth<T>(answers: readonly T[], read: number): T {
  const answer = answers[Math.min(read, answers.length - 1)];
  if (answer === undefined) {
    throw new Error("githubFromGit: nothing to answer with");
  }
  return answer;
}

/** Base64 as GitHub sends it, in lines of 60 characters. */
export function wrappedBase64(bytes: Buffer): string {
  const flat = bytes.toString("base64");
  return (flat.match(/.{1,60}/g) ?? []).map((line) => `${line}\n`).join("");
}

function tree(dir: string, sha: string): HttpResult {
  let listing: string;
  try {
    listing = execFileSync(
      "git",
      ["ls-tree", "-r", "-t", "-z", "--full-tree", sha],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return notFound;
  }
  const entries = listing
    .split("\0")
    .filter((line) => line !== "")
    .map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, id] = line.slice(0, tab).split(" ");
      return { path: line.slice(tab + 1), mode, type, sha: id };
    });
  return json({ sha, tree: entries, truncated: false });
}

function blob(dir: string, id: string): HttpResult {
  try {
    const bytes = execFileSync("git", ["cat-file", "blob", id], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return json({
      sha: id,
      size: bytes.length,
      content: wrappedBase64(bytes),
      encoding: "base64",
    });
  } catch {
    return notFound;
  }
}

export function githubFromGit(script: GithubScript): FakeHttp {
  let pullReads = 0;
  let tipReads = 0;
  return createFakeHttp((url) => {
    const replaced = script.override?.(url);
    if (replaced !== undefined) {
      return replaced;
    }
    if (url === `${API}/pulls/7`) {
      const read = pullReads++;
      return json({
        head: { sha: nth(script.heads, read) },
        base: { ref: nth(script.baseRefs ?? ["main"], read) },
      });
    }
    const ref = /\/git\/ref\/heads\/(.+)$/.exec(url);
    if (ref !== null) {
      const branch = (ref[1] ?? "").split("/").map(decodeURIComponent);
      return json({
        ref: `refs/heads/${branch.join("/")}`,
        object: { type: "commit", sha: nth(script.tips, tipReads++) },
      });
    }
    const trees = /\/git\/trees\/([0-9a-f]+)\?recursive=1$/.exec(url);
    if (trees !== null) {
      return tree(script.dir, trees[1] ?? "");
    }
    const blobs = /\/git\/blobs\/([0-9a-f]+)$/.exec(url);
    return blobs === null ? notFound : blob(script.dir, blobs[1] ?? "");
  });
}
