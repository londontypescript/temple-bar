// Reads what git's index records for setup's paths, so that a link git
// checked out as an ordinary file (Windows with core.symlinks=false) still
// counts as a link. write-target.ts decides what each entry means.

import type { Context } from "../context.ts";

export interface IndexEntry {
  readonly mode: string;
  readonly stage: string;
}

export type IndexMap = ReadonlyMap<string, readonly IndexEntry[]>;

/** NUL records keep whitespace and quoted-looking path names literal. */
export async function readIndex(
  ctx: Context,
  root: string,
  paths: readonly string[],
): Promise<Map<string, IndexEntry[]>> {
  const result = await ctx.git.run(
    ["ls-files", "-s", "-z", "--", ...paths],
    root,
  );
  if (result.code !== 0)
    throw new Error(
      `Could not inspect setup's git index: ${result.stderr.trim()}`,
    );
  const entries = new Map<string, IndexEntry[]>();
  for (const record of result.stdout.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) [0-9a-f]+ ([0-3])\t([\s\S]+)$/.exec(record);
    if (match === null)
      throw new Error("Could not parse setup's git index entry");
    const mode = match[1];
    // The regexp has three captures: mode, stage and the literal path.
    const file = match[3];
    if (mode === undefined || file === undefined || match[2] === undefined)
      throw new Error("Incomplete git index entry");
    const list = entries.get(file) ?? [];
    list.push({ mode, stage: match[2] });
    entries.set(file, list);
  }
  return entries;
}
