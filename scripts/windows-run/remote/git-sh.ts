// Finds the `sh` that Git for Windows ships, and refuses any other. Two
// callers share it: `windows-run`'s readiness check on the Windows machine,
// and the test runner (`scripts/run-tests.ts`), which starts a long-lived
// shell of Git's own install before any test. It lives in this folder
// because `windows-run` sends the folder to the Windows machine whole, so the
// readiness check keeps everything it imports.

import path from "node:path";

const win = path.win32;

/** The two things the search needs from the machine, so tests can fake them. */
export interface GitShDeps {
  git(args: readonly string[]): Promise<{ code: number; stdout: string }>;
  /** Where the command resolves on PATH, or null. */
  where(command: string): Promise<string | null>;
  /** The file's canonical path (links followed, short names made long), or
   * null if it can't be read. */
  realpath(file: string): Promise<string | null>;
}

/** Git's own `sh.exe`, or why it can't be used, printable as it stands. */
export type GitSh = { readonly sh: string } | { readonly problem: string };

/** Whether two paths name one file. One install can be spelled several
 * ways (C:\PROGRA~1 for C:\Program Files, a junction to the folder), so
 * each is compared by its canonical path, or as written if that can't be
 * read. */
async function sameFile(
  deps: GitShDeps,
  a: string,
  b: string,
): Promise<boolean> {
  const spelled = async (file: string): Promise<string> =>
    win.normalize((await deps.realpath(file)) ?? file).toLowerCase();
  return (await spelled(a)) === (await spelled(b));
}

/** `sh` must be the one Git for Windows ships, as on CI's runners: other
 * shells named `sh` (Cygwin, MSYS2, WSL) differ in ways the hook shims
 * notice. Git's own install says where its `usr\bin` is, and the `sh.exe`
 * on PATH (the one hooks and tests start) must be that one. */
export async function findGitSh(deps: GitShDeps): Promise<GitSh> {
  const execPath = await deps.git(["--exec-path"]);
  if (execPath.code !== 0 || execPath.stdout.trim() === "") {
    return {
      problem: "git --exec-path failed, so Git's own sh can't be found",
    };
  }
  // The exec path is <Git>\mingw64\libexec\git-core (or mingw32).
  const gitRoot = win.resolve(execPath.stdout.trim(), "..", "..", "..");
  const expected = win.join(gitRoot, "usr", "bin", "sh.exe");
  // Asked for the .exe: Node starts a bare `sh` without a shell, so it never
  // runs a sh.cmd that `where sh` might list first.
  const found = await deps.where("sh.exe");
  if (found === null) {
    return {
      problem: `no sh on PATH: add ${win.dirname(expected)} to this account's PATH`,
    };
  }
  if (!(await sameFile(deps, found, expected))) {
    return { problem: `sh on PATH is ${found}, not Git's (${expected})` };
  }
  // In each folder on PATH Node tries sh.com before sh.exe, so any sh.com
  // could run instead of Git's.
  const com = await deps.where("sh.com");
  if (com !== null) {
    return {
      problem: `${com} is on PATH, and Node could run it instead of Git's sh`,
    };
  }
  return { sh: found };
}
