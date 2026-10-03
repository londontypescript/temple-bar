// Reads a pull request from GitHub's API as data: its changed files, and
// package.json on each side when it changed. Nothing here checks out, runs or
// installs anything from the pull request. That is what makes the judge safe
// to run with the default branch's trust: the pull request's content is only
// ever compared, never executed.
//
// Every failure comes back as a reason, never a guess. A judge that can't
// read the pull request must fail rather than pass it unseen.

import type { Context } from "../context.ts";
import type { ChangedFile, ManifestPair } from "./changes.ts";

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
 * started from: that is what a merge would change. */
export async function readManifests(
  ctx: Context,
  pr: PullRequestRef,
  facts: PullRequestFacts,
): Promise<Read<ManifestPair>> {
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
