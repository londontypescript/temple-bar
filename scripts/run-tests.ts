// Runs the test suite: starts Node with the arguments given, passed on
// exactly. `pnpm test` runs this with the two setup files every test file
// loads and `--test` (see the root package.json), and pnpm adds any files
// named after them.
//
// On Windows it first starts one long-lived shell of Git's own install, and
// keeps it for the whole run. Git for Windows' shells share one `/tmp`, taken
// from the temp folder of the first shell to start and kept while any of them
// (or a program one started) is alive. Each test file gets its own temp
// folder, deleted when the file ends, so without this shell a test's folder
// could become every shell's `/tmp` and then vanish, and each shell started
// after that warns that it can't find `/tmp`. Started first, with this
// process's own temp folder (which the suite never deletes), the shell holds
// `/tmp` there. docs/agents-rationale.md says why this one command is a shell
// and not Node.

// This file is only an entry point: it exports nothing and always runs.
// A check for "was I started directly?" compares paths, and a path through a
// link (macOS's /tmp, a Windows junction) fails it, which would end the run
// with a pass without running a single test.

import process from "node:process";

import { runTests } from "./run-tests/lifecycle.ts";
import { realDeps } from "./run-tests/real.ts";

const code = await runTests(realDeps(), process.argv.slice(2));
// Leave once the output is flushed, even if a runner that was told to stop
// is still running.
process.stderr.write("", () => {
  process.exit(code);
});
