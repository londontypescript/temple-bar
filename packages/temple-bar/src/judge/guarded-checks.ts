// What the judge guards, in words. Kept apart from changes.ts, which decides
// it, because the judge workflow's text needs the words too, and changes.ts
// imports the gate, which imports that workflow: one import more would be a
// cycle. When the list in changes.ts changes, this changes with it.

/** What the judge guards, in words, for every message and help text that
 * names it: one copy instead of one per message. */
export const GUARDED_CHECKS =
  "a workflow, the temple-bar version pinned in package.json or its " +
  "lockfile entries, the scripts the gate runs, pnpm's install settings " +
  "(pnpm-workspace.yaml, a pnpmfile, .npmrc), or temple-bar.config.json";
