// Reads a pull request from GitHub's API as data: its head commit and base
// branch, the base branch's tip, a commit's whole tree, and a file's blob.
// Nothing here checks out, runs or installs anything from the pull request.
// That is what makes the judge safe to run with the default branch's trust:
// the pull request's content is only ever compared, never executed.
//
// Every failure comes back as a reason, never a guess. An answer that isn't
// the shape GitHub documents is a failure too, never an empty answer: a
// judge that can't read the pull request must fail rather than pass it
// unseen.

import { createHash } from "node:crypto";

import type { Context } from "../context.ts";
import { checkEntry, isTreePath, type TreeEntry } from "./tree-entry.ts";

export interface PullRequestRef {
  readonly api: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly token: string | undefined;
}

export interface PullRequestFacts {
  readonly headSha: string;
  readonly baseRef: string;
}

export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const COMMIT_ID = /^[0-9a-f]{40}$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function answered(status: number): string {
  return status === 403 || status === 429
    ? `GitHub answered ${String(status)} (probably the rate limit: set GH_TOKEN to a GitHub token)`
    : `GitHub answered ${String(status)}`;
}

/** GET a JSON object. Anything else, a 404 included, is a failure: every
 * read here names something that must exist. */
async function getObject(
  ctx: Context,
  url: string,
  token: string | undefined,
): Promise<Read<Record<string, unknown>>> {
  const reply = await ctx.http.get(url, token);
  if (reply.kind === "network-error") {
    return fail(reply.message);
  }
  if (reply.status !== 200) {
    return fail(answered(reply.status));
  }
  const value = parse(reply.body);
  return isRecord(value)
    ? { ok: true, value }
    : fail("an answer that isn't a JSON object");
}

function repoUrl(pr: PullRequestRef): string {
  return `${pr.api}/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}`;
}

/** The pull request's head commit and base branch, as they are now. */
export async function readPullRequest(
  ctx: Context,
  pr: PullRequestRef,
): Promise<Read<PullRequestFacts>> {
  const read = await getObject(
    ctx,
    `${repoUrl(pr)}/pulls/${String(pr.number)}`,
    pr.token,
  );
  if (!read.ok) {
    return read;
  }
  const { head, base } = read.value;
  const headSha = isRecord(head) ? head.sha : undefined;
  const baseRef = isRecord(base) ? base.ref : undefined;
  if (
    typeof headSha !== "string" ||
    !COMMIT_ID.test(headSha) ||
    typeof baseRef !== "string" ||
    baseRef === ""
  ) {
    return fail("an unexpected description of the pull request");
  }
  return { ok: true, value: { headSha, baseRef } };
}

/** The commit at the tip of `branch` now. The name keeps its slashes, each
 * part encoded, and the answer must name exactly that branch: GitHub's ref
 * endpoints can answer for a different ref than the one asked for. */
export async function readBranchTip(
  ctx: Context,
  pr: PullRequestRef,
  branch: string,
): Promise<Read<string>> {
  const name = branch.split("/").map(encodeURIComponent).join("/");
  const read = await getObject(
    ctx,
    `${repoUrl(pr)}/git/ref/heads/${name}`,
    pr.token,
  );
  if (!read.ok) {
    return read;
  }
  const { ref, object } = read.value;
  const sha = isRecord(object) ? object.sha : undefined;
  if (
    ref !== `refs/heads/${branch}` ||
    !isRecord(object) ||
    object.type !== "commit" ||
    typeof sha !== "string" ||
    !COMMIT_ID.test(sha)
  ) {
    return fail(`an unexpected answer for the tip of ${branch}`);
  }
  return { ok: true, value: sha };
}

/** Every entry of the commit's tree, files and folders at every depth, by
 * path. A tree GitHub cuts short (it stops at 100,000 entries or 7 MB) is
 * no answer: a file it didn't list could be a workflow. */
export async function readTree(
  ctx: Context,
  pr: PullRequestRef,
  commit: string,
): Promise<Read<Map<string, TreeEntry>>> {
  const read = await getObject(
    ctx,
    `${repoUrl(pr)}/git/trees/${encodeURIComponent(commit)}?recursive=1`,
    pr.token,
  );
  if (!read.ok) {
    return read;
  }
  const { truncated, tree } = read.value;
  if (truncated === true) {
    return fail(
      `GitHub can't list the tree of ${commit} whole: the repository is too big for one listing`,
    );
  }
  if (truncated !== false || !Array.isArray(tree)) {
    return fail(`an unexpected answer for the tree of ${commit}`);
  }
  const entries = new Map<string, TreeEntry>();
  for (const item of tree as unknown[]) {
    const path = isRecord(item) ? item.path : undefined;
    const entry = isRecord(item)
      ? checkEntry(item.mode, item.type, item.sha)
      : undefined;
    if (typeof path !== "string" || !isTreePath(path) || entry === undefined) {
      return fail(`an unexpected entry in the tree of ${commit}`);
    }
    if (entries.has(path)) {
      return fail(`the tree of ${commit} lists ${path} twice`);
    }
    entries.set(path, entry);
  }
  return { ok: true, value: entries };
}

/** git's own id for a blob with these bytes. */
function blobId(bytes: Buffer): string {
  return createHash("sha1")
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest("hex");
}

/** A blob's text. Read through the blobs API rather than the contents API,
 * which stops at 1 MB: a large repo's lockfile can be bigger than that.
 * GitHub wraps the base64 across lines; once the breaks are out, it must
 * decode and encode back to the same text, or bytes were dropped on the
 * way. The bytes must also be the ones the id names, which proves the
 * text is the file the tree listed. */
export async function readBlob(
  ctx: Context,
  pr: PullRequestRef,
  id: string,
): Promise<Read<string>> {
  const read = await getObject(
    ctx,
    `${repoUrl(pr)}/git/blobs/${encodeURIComponent(id)}`,
    pr.token,
  );
  if (!read.ok) {
    return read;
  }
  const { content, encoding } = read.value;
  if (typeof content !== "string" || encoding !== "base64") {
    return fail(`an unexpected answer for the blob ${id}`);
  }
  const flat = content.replace(/\r?\n/g, "");
  const bytes = Buffer.from(flat, "base64");
  if (bytes.toString("base64") !== flat) {
    return fail(`the blob ${id} came back in base64 that doesn't decode`);
  }
  if (blobId(bytes) !== id) {
    return fail(`the blob ${id} came back with other content`);
  }
  return { ok: true, value: bytes.toString("utf8") };
}
