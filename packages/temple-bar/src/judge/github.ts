// Reads a pull request from GitHub's API as data: its changed files, and
// package.json and pnpm-lock.yaml on each side when they changed. Nothing here checks out, runs or
// installs anything from the pull request. That is what makes the judge safe
// to run with the default branch's trust: the pull request's content is only
// ever compared, never executed.
//
// Every failure comes back as a reason, never a guess. A judge that can't
// read the pull request must fail rather than pass it unseen.

import type { Context } from "../context.ts";
import type { ChangedFile, TextPair } from "./changes.ts";
import { LOCKFILE } from "./lockfile.ts";

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
  readonly files: readonly ChangedFile[];
}

export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** GitHub lists at most 100 files a page and 3000 files in all. */
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

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

/** GET a JSON document. `missingOk` turns a 404 into `undefined`. */
async function getJson(
  ctx: Context,
  url: string,
  token: string | undefined,
  missingOk = false,
): Promise<Read<unknown>> {
  const reply = await ctx.http.get(url, token);
  if (reply.kind === "network-error") {
    return fail(reply.message);
  }
  if (missingOk && reply.status === 404) {
    return { ok: true, value: undefined };
  }
  if (reply.status !== 200) {
    return fail(answered(reply.status));
  }
  const value = parse(reply.body);
  return value === undefined
    ? fail("an answer that isn't JSON")
    : { ok: true, value };
}

function repoUrl(pr: PullRequestRef): string {
  return `${pr.api}/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}`;
}

function toChangedFile(entry: unknown): ChangedFile | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const { filename, status, previous_filename: previous } = entry;
  if (typeof filename !== "string" || typeof status !== "string") {
    return undefined;
  }
  return typeof previous === "string"
    ? { filename, status, previousFilename: previous }
    : { filename, status };
}

async function readFiles(
  ctx: Context,
  pr: PullRequestRef,
  expected: number,
): Promise<Read<ChangedFile[]>> {
  const files: ChangedFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${repoUrl(pr)}/pulls/${String(pr.number)}/files?per_page=${String(PAGE_SIZE)}&page=${String(page)}`;
    const read = await getJson(ctx, url, pr.token);
    if (!read.ok) {
      return read;
    }
    if (!Array.isArray(read.value)) {
      return fail("an unexpected list of changed files");
    }
    for (const entry of read.value) {
      const file = toChangedFile(entry);
      if (file === undefined) {
        return fail("an unexpected entry in the list of changed files");
      }
      files.push(file);
    }
    if (read.value.length < PAGE_SIZE) {
      break;
    }
  }
  // GitHub stops listing at 3000 files. A file it didn't list could be a
  // workflow, so a list shorter than the pull request is no answer at all.
  if (files.length < expected) {
    return fail(
      `GitHub listed ${String(files.length)} of the ${String(expected)} changed files`,
    );
  }
  return { ok: true, value: files };
}

/** The pull request's head commit, base branch and every changed file. */
export async function readPullRequest(
  ctx: Context,
  pr: PullRequestRef,
): Promise<Read<PullRequestFacts>> {
  const read = await getJson(
    ctx,
    `${repoUrl(pr)}/pulls/${String(pr.number)}`,
    pr.token,
  );
  if (!read.ok) {
    return read;
  }
  const value = read.value;
  const head = isRecord(value) ? value.head : undefined;
  const base = isRecord(value) ? value.base : undefined;
  const headSha = isRecord(head) ? head.sha : undefined;
  const baseRef = isRecord(base) ? base.ref : undefined;
  const changed = isRecord(value) ? value.changed_files : undefined;
  if (
    typeof headSha !== "string" ||
    typeof baseRef !== "string" ||
    typeof changed !== "number"
  ) {
    return fail("an unexpected description of the pull request");
  }
  const files = await readFiles(ctx, pr, changed);
  if (!files.ok) {
    return files;
  }
  return { ok: true, value: { headSha, baseRef, files: files.value } };
}

/** package.json's text at `ref`, or undefined when there is none there. */
async function readManifestAt(
  ctx: Context,
  pr: PullRequestRef,
  ref: string,
): Promise<Read<string | undefined>> {
  const read = await getJson(
    ctx,
    `${repoUrl(pr)}/contents/package.json?ref=${encodeURIComponent(ref)}`,
    pr.token,
    true,
  );
  if (!read.ok || read.value === undefined) {
    return read.ok ? { ok: true, value: undefined } : read;
  }
  const { content, encoding } = isRecord(read.value)
    ? read.value
    : { content: undefined, encoding: undefined };
  if (typeof content !== "string" || encoding !== "base64") {
    return fail("an unexpected answer for package.json");
  }
  return { ok: true, value: Buffer.from(content, "base64").toString("utf8") };
}

/** package.json on the base branch as it is now, and at the pull request's
 * head. The base branch's current copy, not the one the pull request
 * started from: that is what a merge would change. The judge's ruleset
 * merges only branches that are up to date, and there the two are the same
 * commit. On a branch that is behind, the comparison can only see too much
 * (the base branch's own newer changes look like the pull request undoing
 * them), so it refuses wrongly rather than passes wrongly, and updating the
 * branch runs the judge again. The one thing it can't do is re-judge a pull
 * request that has already merged: its changes are then on the base branch
 * too, so it passes. */
export async function readManifests(
  ctx: Context,
  pr: PullRequestRef,
  facts: PullRequestFacts,
): Promise<Read<TextPair>> {
  const base = await readManifestAt(ctx, pr, facts.baseRef);
  if (!base.ok) {
    return base;
  }
  const head = await readManifestAt(ctx, pr, facts.headSha);
  if (!head.ok) {
    return head;
  }
  return { ok: true, value: { base: base.value, head: head.value } };
}

/** A file at the root of the tree at `ref`, or undefined when there is none
 * there. Read through the tree and its blob rather than the contents API,
 * which stops at 1 MB: a large repo's lockfile can be bigger than that, and
 * a lockfile the judge can't read would fail every dependency update. */
async function readRootFileAt(
  ctx: Context,
  pr: PullRequestRef,
  ref: string,
  name: string,
): Promise<Read<string | undefined>> {
  const tree = await getJson(
    ctx,
    `${repoUrl(pr)}/git/trees/${encodeURIComponent(ref)}`,
    pr.token,
  );
  if (!tree.ok) {
    return tree;
  }
  const entries = isRecord(tree.value) ? tree.value.tree : undefined;
  if (!Array.isArray(entries)) {
    return fail(`an unexpected answer for the files at ${ref}`);
  }
  const entry: unknown = entries.find(
    (item: unknown) => isRecord(item) && item.path === name,
  );
  if (entry === undefined) {
    return { ok: true, value: undefined };
  }
  const sha = isRecord(entry) && entry.type === "blob" ? entry.sha : undefined;
  if (typeof sha !== "string") {
    return fail(`an unexpected answer for ${name}`);
  }
  const blob = await getJson(
    ctx,
    `${repoUrl(pr)}/git/blobs/${encodeURIComponent(sha)}`,
    pr.token,
  );
  if (!blob.ok) {
    return blob;
  }
  const { content, encoding } = isRecord(blob.value)
    ? blob.value
    : { content: undefined, encoding: undefined };
  if (typeof content !== "string" || encoding !== "base64") {
    return fail(`an unexpected answer for ${name}`);
  }
  return { ok: true, value: Buffer.from(content, "base64").toString("utf8") };
}

/** The root lockfile on the base branch as it is now, and at the pull
 * request's head, compared on the same terms as package.json (see
 * readManifests). */
export async function readLockfiles(
  ctx: Context,
  pr: PullRequestRef,
  facts: PullRequestFacts,
): Promise<Read<TextPair>> {
  const base = await readRootFileAt(ctx, pr, facts.baseRef, LOCKFILE);
  if (!base.ok) {
    return base;
  }
  const head = await readRootFileAt(ctx, pr, facts.headSha, LOCKFILE);
  if (!head.ok) {
    return head;
  }
  return { ok: true, value: { base: base.value, head: head.value } };
}
