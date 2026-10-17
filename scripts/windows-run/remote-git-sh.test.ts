import assert from "node:assert/strict";
import { test } from "node:test";

import { findGitSh, type GitShDeps } from "./remote/git-sh.ts";

const EXEC_PATH = "C:\\Program Files\\Git\\mingw64\\libexec\\git-core";
const GIT_SH = "C:\\Program Files\\Git\\usr\\bin\\sh.exe";

function deps(
  options: {
    execPath?: { code: number; stdout: string };
    shAt?: string | null;
    shComAt?: string | null;
  } = {},
): GitShDeps {
  return {
    git: (args) => {
      assert.deepEqual(args, ["--exec-path"]);
      return Promise.resolve(
        options.execPath ?? { code: 0, stdout: `${EXEC_PATH}\n` },
      );
    },
    where: (command) =>
      Promise.resolve(
        command === "sh.exe"
          ? options.shAt === undefined
            ? GIT_SH
            : options.shAt
          : command === "sh.com"
            ? (options.shComAt ?? null)
            : null,
      ),
  };
}

void test("Git's own sh is found from its exec path, whichever case PATH uses", async () => {
  assert.deepEqual(await findGitSh(deps()), { sh: GIT_SH });
  const shouting = "C:\\PROGRAM FILES\\GIT\\USR\\BIN\\SH.EXE";
  assert.deepEqual(await findGitSh(deps({ shAt: shouting })), {
    sh: shouting,
  });
  // A 32-bit Git keeps its exec path under mingw32; usr\bin is the same.
  const mingw32 = await findGitSh(
    deps({
      execPath: {
        code: 0,
        stdout: "C:\\Git32\\mingw32\\libexec\\git-core\r\n",
      },
      shAt: "C:\\Git32\\usr\\bin\\sh.exe",
    }),
  );
  assert.deepEqual(mingw32, { sh: "C:\\Git32\\usr\\bin\\sh.exe" });
});

void test("any other sh, or none, is refused saying what was found", async () => {
  const cases: [Parameters<typeof deps>[0], RegExp][] = [
    [
      { execPath: { code: 1, stdout: "" } },
      /^git --exec-path failed, so Git's own sh can't be found$/,
    ],
    [{ execPath: { code: 0, stdout: "  \n" } }, /^git --exec-path failed/],
    [
      { shAt: null },
      /^no sh on PATH: add C:\\Program Files\\Git\\usr\\bin to this account's PATH$/,
    ],
    [
      { shAt: "C:\\msys64\\usr\\bin\\sh.exe" },
      /^sh on PATH is C:\\msys64\\usr\\bin\\sh\.exe, not Git's \(C:\\Program Files\\Git\\usr\\bin\\sh\.exe\)$/,
    ],
    [
      { shComAt: "C:\\tools\\sh.com" },
      /^C:\\tools\\sh\.com is on PATH, and Node could run it instead of Git's sh$/,
    ],
  ];
  for (const [options, message] of cases) {
    const found = await findGitSh(deps(options));
    assert.ok("problem" in found, `refused: ${JSON.stringify(options)}`);
    assert.match(found.problem, message);
  }
});
