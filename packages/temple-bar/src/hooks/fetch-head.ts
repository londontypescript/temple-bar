// What a `git fetch` that is still running has just received from origin.
//
// `git fetch origin main:main` updates the local `main` and origin's
// remote-tracking ref in two separate ref transactions, local `main` first.
// So while the reference-transaction hook checks `main`,
// `refs/remotes/origin/main` still holds the previous fetch's value, and a
// check against it alone refuses the very commit GitHub has on `main`. The
// fetch has, however, already written what it received to FETCH_HEAD: git
// appends each fetched ref there before updating the local ref it maps to
// (only `git fetch --atomic` holds FETCH_HEAD back, and that puts both refs
// in one transaction instead, which the hook sees directly).

import path from "node:path";

import type { Context } from "../context.ts";

export interface FetchHeadEntry {
  readonly sha: string;
  readonly branch: string;
  /** The remote's URL in the form git writes to FETCH_HEAD. */
  readonly url: string;
}

// `<sha>\t<"not-for-merge" or empty>\tbranch '<name>' of <url>`
const BRANCH_LINE = /^([0-9a-f]{40,64})\t[^\t]*\tbranch '(.+)' of (.+)$/;

/** Parses FETCH_HEAD's branch lines; tags and other lines are skipped. */
export function parseFetchHead(text: string): FetchHeadEntry[] {
  const entries: FetchHeadEntry[] = [];
  for (const line of text.split("\n")) {
    const match = BRANCH_LINE.exec(line.replace(/\r$/, ""));
    if (match !== null) {
      const [, sha, branch, url] = match as unknown as [
        string,
        string,
        string,
        string,
      ];
      entries.push({ sha, branch, url });
    }
  }
  return entries;
}

function isLocalPath(url: string): boolean {
  const colon = url.indexOf(":");
  const slash = url.indexOf("/");
  return colon === -1 || (slash !== -1 && slash < colon);
}

/** Drops a `user[:password]@` part, as git does before writing a URL to
 * FETCH_HEAD, so a token never lands in a file. */
function withoutCredentials(url: string): string {
  const at = url.indexOf("@");
  if (at === -1 || isLocalPath(url)) {
    return url;
  }
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(url);
  if (scheme === null) {
    // scp-like `user@host:path`.
    return url.slice(at + 1).includes(":") ? url.slice(at + 1) : url;
  }
  const userinfo = url.slice(scheme[0].length, at);
  return userinfo.includes("/") ? url : scheme[0] + url.slice(at + 1);
}

/**
 * Puts a remote URL in the form git writes to FETCH_HEAD: credentials
 * dropped, then trailing slashes and a trailing `.git` removed. Comparing
 * two URLs in this form tells whether FETCH_HEAD came from that remote.
 */
export function fetchHeadUrlForm(url: string): string {
  let result = withoutCredentials(url.trim()).replace(/\/+$/, "");
  if (result.length > 5 && result.endsWith(".git")) {
    result = result.slice(0, -".git".length);
  }
  return result;
}

/**
 * The commit the running (or last) fetch received for origin's `branch`, or
 * undefined when FETCH_HEAD has no such entry, came from another remote, or
 * doesn't exist.
 */
export async function fetchedFromOrigin(
  ctx: Context,
  repoRoot: string,
  branch: string,
): Promise<string | undefined> {
  const gitPath = await ctx.git.run(
    ["rev-parse", "--git-path", "FETCH_HEAD"],
    repoRoot,
  );
  const originUrl = await ctx.git.run(
    ["remote", "get-url", "origin"],
    repoRoot,
  );
  if (gitPath.code !== 0 || originUrl.code !== 0) {
    return undefined;
  }

  const text = await ctx.fs.readText(
    path.resolve(repoRoot, gitPath.stdout.trim()),
  );
  if (text === undefined) {
    return undefined;
  }

  const origin = fetchHeadUrlForm(originUrl.stdout);
  return parseFetchHead(text).find(
    (entry) => entry.branch === branch && entry.url === origin,
  )?.sha;
}
