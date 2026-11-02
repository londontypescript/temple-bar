// The release marker: a session's word that its worktree holds nothing that
// isn't on GitHub or disposable. It is a per-worktree ref, which git keeps
// private to its worktree and deletes with it, pointing at a blob of JSON
// that records the branch, HEAD and the path and checksum (never the
// contents) of every ignored file worth watching. ADR 0022 has the story.
//
// Two refs, never both at once: `released` (the session let go) and
// `removing` (a `--remove` run claimed it). Every change is one
// `update-ref --stdin` transaction, which git applies whole or not at all,
// with --no-deref so no transaction can reach a branch through a symbolic
// ref, and each asserts the other state's ref is absent.

import type { Context } from "../context.ts";

export const RELEASED = "refs/worktree/temple-bar/released";
export const REMOVING = "refs/worktree/temple-bar/removing";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface Marker {
  readonly head: string;
  /** Full ref name, `refs/heads/<name>`. */
  readonly branch: string;
  /** Path to `file:<id>` or `link:<id>`. */
  readonly files: ReadonlyMap<string, string>;
}

/** A per-worktree ref as `for-each-ref` reads it. */
interface WorktreeRef {
  readonly name: string;
  readonly oid: string;
  readonly symref: string;
  readonly type: string;
}

export type MarkerRefs =
  | {
      readonly kind: "read";
      readonly released: string | undefined;
      readonly removing: string | undefined;
      /** Other per-worktree refs: an operation's (bisect) or another
       * tool's state, which nothing here may delete. */
      readonly others: readonly string[];
    }
  | { readonly kind: "unreadable"; readonly why: string };

/** The worktree's own refs: temple-bar's two, and any others. A symbolic
 * marker ref is refused outright: a transaction on it could otherwise be
 * steered at whatever it points to. */
export async function readMarkerRefs(
  ctx: Context,
  worktree: string,
): Promise<MarkerRefs> {
  const result = await ctx.git.run(
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(symref)%00%(objecttype)",
      "refs/worktree/",
      "refs/bisect/",
    ],
    worktree,
  );
  if (result.code !== 0 || result.stderr !== "") {
    return { kind: "unreadable", why: "git couldn't list its own refs" };
  }
  const refs: WorktreeRef[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line === "") {
      continue;
    }
    const [name = "", oid = "", symref = "", type = ""] = line.split("\0");
    refs.push({ name, oid, symref, type });
  }
  let released: string | undefined;
  let removing: string | undefined;
  const others: string[] = [];
  for (const ref of refs) {
    if (ref.name !== RELEASED && ref.name !== REMOVING) {
      others.push(ref.name);
      continue;
    }
    if (ref.symref !== "") {
      return {
        kind: "unreadable",
        why: `${ref.name} is a symbolic ref, pointing at ${ref.symref}`,
      };
    }
    if (ref.type !== "blob" || !OBJECT_ID.test(ref.oid)) {
      return { kind: "unreadable", why: `${ref.name} doesn't hold a marker` };
    }
    if (ref.name === RELEASED) {
      released = ref.oid;
    } else {
      removing = ref.oid;
    }
  }
  return { kind: "read", released, removing, others };
}

/** The marker a blob holds, or undefined when it isn't one. Read with
 * replacement objects off, so a replacement can't change what it says. */
export async function readMarker(
  ctx: Context,
  worktree: string,
  oid: string,
): Promise<Marker | undefined> {
  const result = await ctx.git.run(
    ["--no-replace-objects", "cat-file", "blob", oid],
    worktree,
  );
  if (result.code !== 0) {
    return undefined;
  }
  return parseMarker(result.stdout);
}

function parseMarker(text: string): Marker | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const { version, head, branch, files } = raw as Record<string, unknown>;
  if (
    version !== 1 ||
    typeof head !== "string" ||
    !OBJECT_ID.test(head) ||
    typeof branch !== "string" ||
    !branch.startsWith("refs/heads/") ||
    typeof files !== "object" ||
    files === null ||
    Array.isArray(files)
  ) {
    return undefined;
  }
  const entries = Object.entries(files);
  if (entries.some(([, id]) => typeof id !== "string")) {
    return undefined;
  }
  return { head, branch, files: new Map(entries as [string, string][]) };
}

/** The marker as JSON, keys in a fixed order so equal markers are equal
 * blobs. Object.fromEntries defines each path as its own property, so even
 * a file named `__proto__` is recorded as a path. */
function serialiseMarker(marker: Marker): string {
  const files = Object.fromEntries(
    [...marker.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify({
    version: 1,
    head: marker.head,
    branch: marker.branch,
    files,
  })}\n`;
}

export function sameFiles(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): string[] {
  const changed: string[] = [];
  for (const [file, id] of a) {
    if (b.get(file) !== id) {
      changed.push(file);
    }
  }
  for (const file of b.keys()) {
    if (!a.has(file)) {
      changed.push(file);
    }
  }
  return changed.sort();
}

/** Writes the marker's blob, the one object this command ever writes, and
 * returns its id. */
export async function writeMarkerBlob(
  ctx: Context,
  worktree: string,
  marker: Marker,
): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["hash-object", "-w", "--stdin"],
    worktree,
    serialiseMarker(marker),
  );
  const oid = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : "";
  return result.code === 0 && OBJECT_ID.test(oid) ? oid : undefined;
}

/** The id git uses for "must not exist", in the repository's hash length. */
function zero(oid: string): string {
  return "0".repeat(oid.length);
}

/** One transaction on the worktree's own refs; resolves git's message when
 * it was refused, undefined when it applied. */
async function transact(
  ctx: Context,
  worktree: string,
  lines: readonly string[],
): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["update-ref", "--no-deref", "--stdin"],
    worktree,
    lines.map((line) => `${line}\n`).join(""),
  );
  return result.code === 0
    ? undefined
    : result.stderr.trim() || "git refused the change";
}

/** Writes `released` for a new blob, replacing `old` when re-releasing. */
export function release(
  ctx: Context,
  worktree: string,
  blob: string,
  old: string | undefined,
): Promise<string | undefined> {
  return transact(ctx, worktree, [
    `verify ${REMOVING} ${zero(blob)}`,
    old === undefined
      ? `create ${RELEASED} ${blob}`
      : `update ${RELEASED} ${blob} ${old}`,
  ]);
}

export function unrelease(
  ctx: Context,
  worktree: string,
  old: string,
): Promise<string | undefined> {
  return transact(ctx, worktree, [
    `verify ${REMOVING} ${zero(old)}`,
    `delete ${RELEASED} ${old}`,
  ]);
}

/** Turns `released` into `removing` in one step: of a racing `--unrelease`
 * and this claim, exactly one succeeds. */
export function claim(
  ctx: Context,
  worktree: string,
  blob: string,
): Promise<string | undefined> {
  return transact(ctx, worktree, [
    `delete ${RELEASED} ${blob}`,
    `create ${REMOVING} ${blob}`,
  ]);
}

/** Drops a claim this run made, when the worktree is kept after all. The
 * session must release it again: a claim is never turned back. */
export function dropClaim(
  ctx: Context,
  worktree: string,
  blob: string,
): Promise<string | undefined> {
  return transact(ctx, worktree, [`delete ${REMOVING} ${blob}`]);
}
