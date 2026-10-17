import assert from "node:assert/strict";
import { test } from "node:test";

import { findGitSh, type GitShDeps } from "./remote/git-sh.ts";

const EXEC_PATH = "C:\\Program Files\\Git\\mingw64\\libexec\\git-core";
const GIT_SH = "C:\\Program Files\\Git\\usr\\bin\\sh.exe";
const LAUNCHER = "C:\\Program Files\\Git\\bin\\sh.exe";

function deps(
  options: {
    execPath?: { code: number; stdout: string };
    shAt?: string | null;
    shComAt?: string | null;
    /** Canonical paths by path; a path not listed can't be read. */
    real?: Record<string, string>;
  } = {},
): GitShDeps {
  return {
    git: (args) => {
      assert.deepEqual(args, ["--exec-path"]);
      return Promise.resolve(
        options.execPath ?? { code: 0, stdout: `${EXEC_PATH}\n` },
      );
    },
    realpath: (file) =>
      Promise.resolve(
        options.real === undefined ? file : (options.real[file] ?? null),
      ),
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
  assert.deepEqual(await findGitSh(deps()), { sh: GIT_SH, onPath: GIT_SH });
  const shouting = "C:\\PROGRAM FILES\\GIT\\USR\\BIN\\SH.EXE";
  assert.deepEqual(await findGitSh(deps({ shAt: shouting })), {
    sh: GIT_SH,
    onPath: shouting,
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
  assert.deepEqual(mingw32, {
    sh: "C:\\Git32\\usr\\bin\\sh.exe",
    onPath: "C:\\Git32\\usr\\bin\\sh.exe",
  });
});

// GitHub's Windows runners put <Git>\bin first on PATH, whose sh.exe starts
// <Git>\usr\bin\sh.exe: the same shell, so the same shared /tmp.
void test("Git's launcher on PATH is accepted, and the shell it starts is what is run directly", async () => {
  assert.deepEqual(await findGitSh(deps({ shAt: LAUNCHER })), {
    sh: GIT_SH,
    onPath: LAUNCHER,
  });
  const linked = "C:\\Git-link\\bin\\sh.exe";
  assert.deepEqual(
    await findGitSh(
      deps({
        shAt: linked,
        real: { [linked]: LAUNCHER, [LAUNCHER]: LAUNCHER, [GIT_SH]: GIT_SH },
      }),
    ),
    { sh: GIT_SH, onPath: linked },
  );
  // The launcher alone, without the shell it starts, is refused.
  const missing = await findGitSh(
    deps({ shAt: LAUNCHER, real: { [LAUNCHER]: LAUNCHER } }),
  );
  assert.ok("problem" in missing);
  assert.equal(
    missing.problem,
    `Git's shell ${GIT_SH} is missing, though git --exec-path names that install`,
  );
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
      /^sh on PATH is C:\\msys64\\usr\\bin\\sh\.exe, not Git's \(C:\\Program Files\\Git\\usr\\bin\\sh\.exe, or its launcher C:\\Program Files\\Git\\bin\\sh\.exe\)$/,
    ],
    [
      // Another install's launcher is not this install's.
      { shAt: "D:\\OtherGit\\bin\\sh.exe" },
      /^sh on PATH is D:\\OtherGit\\bin\\sh\.exe, not Git's/,
    ],
    [
      // Neither is another folder of this install.
      { shAt: "C:\\Program Files\\Git\\mingw64\\bin\\sh.exe" },
      /^sh on PATH is C:\\Program Files\\Git\\mingw64\\bin\\sh\.exe, not Git's/,
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

void test("one install spelled two ways is one sh, by its canonical path", async () => {
  const short = "C:\\PROGRA~1\\Git\\usr\\bin\\sh.exe";
  const junction = "C:\\Git-link\\usr\\bin\\sh.exe";
  for (const shAt of [short, junction]) {
    const found = await findGitSh(
      deps({ shAt, real: { [shAt]: GIT_SH, [GIT_SH]: GIT_SH } }),
    );
    assert.deepEqual(found, { sh: GIT_SH, onPath: shAt }, shAt);
  }
  // Without canonical paths, the spelling is all there is to compare.
  const unreadable = await findGitSh(
    deps({ shAt: short, real: { [GIT_SH]: GIT_SH } }),
  );
  assert.ok("problem" in unreadable);
  assert.match(unreadable.problem, /^sh on PATH is C:\\PROGRA~1.*not Git's/);
  assert.deepEqual(await findGitSh(deps({ real: { [GIT_SH]: GIT_SH } })), {
    sh: GIT_SH,
    onPath: GIT_SH,
  });
  // A different install stays different, however it is reached.
  const other = await findGitSh(
    deps({
      shAt: junction,
      real: { [junction]: "C:\\msys64\\usr\\bin\\sh.exe", [GIT_SH]: GIT_SH },
    }),
  );
  assert.ok("problem" in other);
});
