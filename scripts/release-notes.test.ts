import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReleaseNotes } from "./release-notes.ts";

void test("groups features, fixes and other changes, keeping each scope", () => {
  const notes = buildReleaseNotes(
    [
      "fix(gate): report a missing config file (#31)",
      "feat(create): --help shows help and sets nothing up (#22)",
      "docs(plan): mark the mini plan done (#26)",
      "feat: list every check the gate ran (#21)",
    ],
    "v0.0.4",
  );
  assert.ok(
    notes.startsWith(
      [
        "## Features",
        "",
        "- **create:** --help shows help and sets nothing up (#22)",
        "- list every check the gate ran (#21)",
        "",
        "## Fixes",
        "",
        "- **gate:** report a missing config file (#31)",
        "",
        "## Other changes",
        "",
        "- **plan:** mark the mini plan done (#26)",
        "",
      ].join("\n"),
    ),
    notes,
  );
});

void test("puts breaking changes first, whatever their type", () => {
  const notes = buildReleaseNotes(
    ["feat(gate): list checks", "feat(gate)!: require format:check"],
    "v0.0.4",
  );
  assert.ok(
    notes.startsWith(
      "## Breaking changes\n\n- **gate:** require format:check\n\n## Features",
    ),
    notes,
  );
});

void test("leaves out version bumps and keeps non-conventional subjects as they are", () => {
  const notes = buildReleaseNotes(
    [
      "chore(release): bump both packages to 0.0.4 (#40)",
      "Merge pull request #17 from londontypescript/docs/phase1-close",
    ],
    "v0.0.4",
  );
  assert.doesNotMatch(notes, /bump both packages/);
  assert.match(
    notes,
    /## Other changes\n\n- Merge pull request #17 from londontypescript\/docs\/phase1-close\n/,
  );
});

void test("says so when there is nothing to release", () => {
  const notes = buildReleaseNotes(
    ["chore(release): bump to 0.0.4", ""],
    "v0.0.4",
  );
  assert.ok(
    notes.startsWith("No changes since the previous release.\n"),
    notes,
  );
});

void test("ends with the upgrade command, a placeholder, Incidents fixed and a hidden reminder", () => {
  assert.ok(
    buildReleaseNotes(["fix: x"], "v0.0.8").endsWith(
      [
        "",
        "## Upgrading",
        "",
        "```bash",
        "pnpm add -D --save-exact @londontypescript/temple-bar@0.0.8",
        "```",
        "",
        '<!-- Extra upgrade steps, or "No other steps." -->',
        "",
        "## Incidents fixed",
        "",
        "<!-- Draft from conventional commits. Add upgrade notes and the incidents this release fixes before publishing. -->",
        "",
      ].join("\n"),
    ),
  );
  assert.match(
    buildReleaseNotes([], "v0.0.8"),
    /^No changes since the previous release\.\n\n## Upgrading\n/,
  );
});
