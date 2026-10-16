// What the judge guards, in words. Kept apart from the comparison
// (changes.ts and guarded-paths.ts, which decide it) so the judge
// workflow's text, which the gate and setup import, takes the words alone.
// When what is guarded changes, this changes with it.

/** What the judge guards, in words, for every message and help text that
 * names it: one copy instead of one per message. */
export const GUARDED_CHECKS =
  "a workflow; any package.json's scripts, its temple-bar version or its " +
  "packageManager and devEngines fields, the root's pnpm field, or a " +
  "package.json added with scripts or removed; temple-bar's entries in " +
  "the root lockfile; pnpm's install settings at any depth " +
  "(pnpm-workspace.yaml, a pnpmfile, .npmrc); or temple-bar.config.json";
