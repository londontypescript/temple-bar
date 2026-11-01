// The one exception to guarding pnpm-workspace.yaml as a whole file: a
// change to the root file that only changes versions in its default
// catalog, or adds entries there, passes. Dependabot's catalog bumps move
// the project's own dependencies, never the checks; everything else about
// the file still needs the maintainer. The grammar is strict text, read
// without a YAML library, and anything it can't read is refused, naming the
// first rule that fails. See decision 66 and "The catalog grammar" in
// docs/adr/0015-every-package-checked-and-guarded.md.
//
// Pure: the readers hand over both sides' text and the head's facts.

import {
  duplicateProblem,
  readBody,
  templeBarProblem,
  walk,
} from "./catalog-body.ts";
import { inertProblem } from "./catalog-facts.ts";
import {
  characterProblem,
  fail,
  keywordProblem,
  lineShapeProblem,
  outsideProblem,
  splitRegions,
  type Checked,
} from "./catalog-lines.ts";
import {
  modeFindings,
  textOf,
  unreadableFindings,
  type CatalogContext,
  type PathChange,
} from "./file-state.ts";

/** What a catalog-only change did. */
export interface CatalogCounts {
  readonly changed: number;
  readonly added: number;
}

/** The first problem among checks run in order, or undefined. */
function firstOf(
  checks: readonly (() => string | undefined)[],
): string | undefined {
  for (const check of checks) {
    const problem = check();
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

/**
 * Both sides' text under the grammar, checked in a fixed order so a
 * refusal always names the same rule: characters, one marker, the text
 * outside the catalog unchanged, its line shapes, its words, the body's
 * lines, duplicate keys, the walk, temple-bar's own entry, and last the
 * head's facts.
 */
export function compareCatalog(
  before: string,
  after: string,
  context: CatalogContext | undefined,
): Checked<CatalogCounts> {
  const characters = firstOf([
    () => characterProblem(before, "on the base branch"),
    () => characterProblem(after, "here"),
  ]);
  if (characters !== undefined) {
    return fail(characters);
  }
  const base = splitRegions(before.split("\n"), "on the base branch");
  if (!base.ok) {
    return base;
  }
  const head = splitRegions(after.split("\n"), "here");
  if (!head.ok) {
    return head;
  }
  const outside = firstOf([
    () => outsideProblem(base.value, head.value),
    () => lineShapeProblem(base.value, "on the base branch"),
    () => lineShapeProblem(head.value, "here"),
    () => keywordProblem(head.value),
  ]);
  if (outside !== undefined) {
    return fail(outside);
  }
  const was = readBody(
    base.value.body,
    base.value.bodyStart,
    "on the base branch",
  );
  if (!was.ok) {
    return was;
  }
  const now = readBody(head.value.body, head.value.bodyStart, "here");
  if (!now.ok) {
    return now;
  }
  const duplicate = firstOf([
    () => duplicateProblem(was.value, "on the base branch"),
    () => duplicateProblem(now.value, "here"),
  ]);
  if (duplicate !== undefined) {
    return fail(duplicate);
  }
  const edits = walk(was.value, now.value);
  if (!edits.ok) {
    return edits;
  }
  const last = templeBarProblem(edits.value) ?? inertProblem(context);
  if (last !== undefined) {
    return fail(last);
  }
  const count = (how: string) =>
    edits.value.filter((edit) => edit.how === how).length;
  return {
    ok: true,
    value: { changed: count("changed"), added: count("added") },
  };
}

/** The grammar's verdict on the root workspace file's change, or
 * undefined when the file's own state decides first: unreadable, added,
 * removed, not a regular file, or its mode changed. */
export function catalogVerdict(
  change: PathChange,
): Checked<CatalogCounts> | undefined {
  const { path: file, base, head } = change;
  if (
    base.kind !== "regular" ||
    head.kind !== "regular" ||
    base.mode !== head.mode
  ) {
    return undefined;
  }
  return compareCatalog(
    textOf(file, base),
    textOf(file, head),
    change.catalogContext,
  );
}

/** The findings for the root pnpm-workspace.yaml: what happened to the
 * file, as for every guarded file, else at most one line naming the first
 * rule of the grammar the change breaks. */
export function workspaceFindings(change: PathChange): string[] {
  const { path: file, base, head } = change;
  if (base.kind === "unreadable" || head.kind === "unreadable") {
    return unreadableFindings(file, base, head);
  }
  if (head.kind !== "special") {
    if (base.kind === "absent") {
      return head.kind === "absent" ? [] : [`${file} (added)`];
    }
    if (head.kind === "absent") {
      return [`${file} (removed)`];
    }
  }
  const verdict = catalogVerdict(change);
  if (verdict === undefined) {
    return modeFindings(file, base, head);
  }
  return verdict.ok
    ? []
    : [`${file} (not a catalog-only change: ${verdict.reason})`];
}
