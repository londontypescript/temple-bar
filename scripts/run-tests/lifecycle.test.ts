import assert from "node:assert/strict";
import { test } from "node:test";

import { runTests, SHARED_TMP_VARIABLE } from "./lifecycle.ts";
import {
  EXEC_PATH,
  exited,
  GIT_SH,
  harness,
  OWN_TEMP,
  signalled,
} from "./testing.ts";

// As `pnpm test` gives them: the root script's flags, then what was typed.
const ARGS = [
  "--import",
  "./scripts/isolate-git-config.ts",
  "--import",
  "./scripts/isolate-temp-folder.ts",
  "--test",
  "--test-name-pattern",
  "a name with spaces",
  "packages/a folder/x.test.ts",
];

void test("off Windows the runner gets every argument exactly as given, and no shell starts", async () => {
  for (const platform of ["linux", "darwin"] as const) {
    const h = harness({ platform });
    assert.equal(await runTests(h.deps, ARGS), 0);
    assert.equal(h.started.length, 1);
    const [runner] = h.started;
    assert.equal(runner?.command, EXEC_PATH);
    assert.deepEqual(runner.args, ARGS);
    assert.equal(runner.env, h.deps.env);
    assert.equal(runner.piped, false);
    assert.deepEqual(h.asked, [], "nothing looks for Git's sh");
    assert.equal(h.printed(), "");
  }
});

void test("the runner's exit code is the run's; a runner with none fails the run, saying why", async () => {
  for (const platform of ["linux", "win32"] as const) {
    const failed = harness({ platform, runner: exited(3) });
    assert.equal(await runTests(failed.deps, []), 3);

    const killed = harness({ platform, runner: signalled("SIGKILL") });
    assert.equal(await runTests(killed.deps, []), 1);
    assert.match(killed.printed(), /the test runner was stopped by SIGKILL/);

    const unstartable = harness({
      platform,
      runner: { kind: "error", message: "spawn node ENOENT" },
    });
    assert.equal(await runTests(unstartable.deps, []), 1);
    assert.match(
      unstartable.printed(),
      /the test runner could not start \(spawn node ENOENT\)/,
    );
  }
});

void test("off Windows Ctrl+C and SIGTERM are passed on to the runner", async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const h = harness({ platform: "linux", runner: "until-killed" });
    const run = runTests(h.deps, []);
    h.signals.get(signal)?.();
    assert.equal(await run, 1);
    assert.deepEqual(h.runner()?.kills, [signal]);
  }
});

void test("on Windows the anchor is Git's sh, on this process's temp folder, ready before the runner starts", async () => {
  const h = harness({
    // Windows spells variables in any case: every spelling of TEMP and TMP
    // is replaced, not left beside the new one.
    env: { PATH: "C:\\bin", Temp: "C:\\elsewhere", tmp: "C:\\elsewhere" },
    runner: exited(4),
  });
  assert.equal(await runTests(h.deps, ARGS), 4);
  const [anchor, runner] = h.started;
  assert.equal(anchor?.command, GIT_SH);
  assert.deepEqual(anchor.args, ["-c", "echo ready; read _; exit 0"]);
  assert.equal(anchor.piped, true);
  assert.deepEqual(anchor.env, {
    PATH: "C:\\bin",
    TEMP: OWN_TEMP,
    TMP: OWN_TEMP,
  });
  assert.deepEqual(h.asked.at(-1), `${GIT_SH} -c /usr/bin/cygpath -w /tmp`);

  assert.deepEqual(runner?.args, ARGS);
  assert.equal(runner.env[SHARED_TMP_VARIABLE], OWN_TEMP);
  assert.equal(runner.env.Temp, "C:\\elsewhere", "the runner's own is kept");
  // Ctrl+C reaches the runner from the terminal; the wrapper only waits.
  assert.deepEqual([...h.signals.keys()], ["SIGINT"]);
  h.signals.get("SIGINT")?.();
  assert.deepEqual(runner.proc.kills, []);
  // Closed once the runner ended, and it left as expected.
  assert.equal(anchor.proc.stdinClosed, true);
  assert.deepEqual(anchor.proc.kills, []);
  assert.equal(h.printed(), "");
});

void test("an anchor that never says it is ready, or dies first, stops the run before any test", async () => {
  const silent = harness({ anchor: { ready: false }, expire: [30_000] });
  assert.equal(await runTests(silent.deps, []), 1);
  assert.match(
    silent.printed(),
    /Git's sh \(C:\\Program Files\\Git\\usr\\bin\\sh\.exe\), started to hold \/tmp for the run, did not say it was ready within 30s/,
  );
  assert.deepEqual(silent.anchor()?.kills, [undefined]);
  assert.equal(silent.runner(), undefined);

  const dead = harness({
    anchor: { endsBeforeReady: exited(127), stderr: "sh: broken\n" },
  });
  assert.equal(await runTests(dead.deps, []), 1);
  assert.match(
    dead.printed(),
    /started to hold \/tmp for the run, exited with code 127\. It said: sh: broken/,
  );
  assert.equal(dead.runner(), undefined);
});

void test("Git's sh must be Git's own before anything starts", async () => {
  const h = harness({ shAt: "C:\\msys64\\usr\\bin\\sh.exe" });
  assert.equal(await runTests(h.deps, []), 1);
  assert.match(h.printed(), /run-tests: sh on PATH is C:\\msys64.*not Git's/);
  assert.deepEqual(h.started, []);
});

void test("the shared /tmp must exist and be outside this run's temp folder", async () => {
  const refusals: [Parameters<typeof harness>[0], RegExp][] = [
    [
      { cygpath: { code: 1, stdout: "", stderr: "cygpath: no\n" } },
      /Git's sh could not say where \/tmp is \(cygpath exited with code 1\)\. It said: cygpath: no/,
    ],
    [
      { cygpath: { code: 0, stdout: "C:\\gone\n", stderr: "" } },
      /Git's shared \/tmp is C:\\gone, which does not exist: a Git shell started with a temp folder since deleted still holds it\. To free it, close every Git Bash and sh/,
    ],
    [
      {
        cygpath: { code: 0, stdout: `${OWN_TEMP}\\tb-t-abc\r\n`, stderr: "" },
        dirs: {
          [OWN_TEMP]: OWN_TEMP,
          [`${OWN_TEMP}\\tb-t-abc`]: `${OWN_TEMP}\\tb-t-abc`,
        },
      },
      /Git's shared \/tmp is C:\\Users\\dev\\AppData\\Local\\Temp\\tb-t-abc, inside this run's temp folder C:\\Users\\dev\\AppData\\Local\\Temp, where the suite makes and deletes its own folders/,
    ],
    [
      // Spelled another way (a short name, another case), still inside.
      {
        cygpath: { code: 0, stdout: "C:\\Users\\DEV~1\\x\n", stderr: "" },
        dirs: {
          [OWN_TEMP]: OWN_TEMP,
          "C:\\Users\\DEV~1\\x": "C:\\USERS\\DEV\\APPDATA\\LOCAL\\TEMP\\X",
        },
      },
      /inside this run's temp folder/,
    ],
  ];
  for (const [scenario, message] of refusals) {
    const h = harness(scenario);
    assert.equal(await runTests(h.deps, []), 1);
    assert.match(h.printed(), message);
    assert.equal(h.runner(), undefined, "no test ran");
    assert.equal(h.anchor()?.stdinClosed, true, "the anchor was closed");
  }

  // A shell already running when the run began may hold /tmp elsewhere,
  // such as CI's own temp folder: that is fine, and it is what the tests are
  // told. A neighbour whose name only starts the same isn't inside.
  for (const elsewhere of ["D:\\a\\_temp", `${OWN_TEMP}2`]) {
    const h = harness({
      cygpath: { code: 0, stdout: `${elsewhere}\n`, stderr: "" },
      dirs: { [OWN_TEMP]: OWN_TEMP, [elsewhere]: elsewhere },
    });
    assert.equal(await runTests(h.deps, []), 0);
    assert.equal(h.started[1]?.env[SHARED_TMP_VARIABLE], elsewhere);
  }
});

void test("an anchor that dies while /tmp is checked stops the run before any test", async () => {
  const h = harness({ anchor: { endsDuringCheck: signalled("SIGTERM") } });
  assert.equal(await runTests(h.deps, []), 1);
  assert.match(
    h.printed(),
    /Git's sh holding \/tmp was stopped by SIGTERM before the tests started/,
  );
  assert.equal(h.runner(), undefined);
});

void test("an anchor that dies during the run stops the runner and fails the run", async () => {
  const h = harness({
    runner: "until-killed",
    anchor: { endsDuringRun: exited(1), stderr: "sh: gone\n" },
  });
  assert.equal(await runTests(h.deps, []), 1);
  assert.match(
    h.printed(),
    /Git's sh holding \/tmp exited with code 1 before the tests finished, so \/tmp may have moved to a folder the suite deletes\. The tests were stopped\. It said: sh: gone/,
  );
  assert.deepEqual(h.runner()?.kills, [undefined]);
});

void test("at the end the anchor is closed, and a slow or odd exit is reported without changing the result", async () => {
  const hangs = harness({ anchor: { onClose: "hangs" }, expire: [10_000] });
  assert.equal(await runTests(hangs.deps, []), 0);
  assert.equal(hangs.anchor()?.stdinClosed, true);
  assert.deepEqual(hangs.anchor()?.kills, [undefined]);
  assert.match(
    hangs.printed(),
    /Git's sh holding \/tmp did not exit within 10s of its input closing, so it was stopped/,
  );

  const odd = harness({ anchor: { onClose: exited(2) }, runner: exited(5) });
  assert.equal(await runTests(odd.deps, []), 5);
  assert.match(
    odd.printed(),
    /Git's sh holding \/tmp exited with code 2 when the run ended, where 0 was expected/,
  );
});
