// Shuts the whole test suite off from the machine's own git configuration, so
// no developer's or CI runner's global or system config can make a test pass
// or fail (a global `commit.gpgsign=true` once hung local runs on a pinentry
// prompt while CI passed).
//
// Loaded with `node --import ./scripts/isolate-git-config.ts --test`. `node --test`
// runs each test file in its own subprocess and hands that subprocess the same
// `--import`; this file also sets environment variables, which every subprocess
// and grandchild (hooks, the packed CLI) inherits unless a spawn drops them.
// Nothing in the repo does: the only explicit `env` values spread
// `process.env`, and the one filter removes only `npm_*`.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Set by the first process to load this file (each test file's process; the
 * outer `node --test` runner never loads it), so its subprocesses reuse the file. */
const MARKER = "TEMPLE_BAR_TEST_ISOLATED";

// Variables git reads that redirect it or add config outside the files above.
// A git hook running `pnpm check` sets several of them.
const REDIRECTS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
];

if (process.env[MARKER] === undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-git-config-"));
  const file = path.join(dir, "gitconfig");
  // After a commit, a fetch or a push, git starts its automatic maintenance
  // in the background, and it can outlive the command. A test that deletes
  // its repository straight away then races it: git recreates the folders
  // it writes to, and the temp-folder check fails the file for the leftover.
  writeFileSync(file, "[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n");
  process.on("exit", () => {
    rmSync(dir, { recursive: true, force: true });
  });
  process.env[MARKER] = "1";
  process.env.GIT_CONFIG_GLOBAL = file;
}
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const name of REDIRECTS) {
  Reflect.deleteProperty(process.env, name);
}
