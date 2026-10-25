import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import {
  holdSharedTmp,
  SHARED_TMP_VARIABLE,
  testRunHooks,
} from "./lifecycle.ts";
import {
  exited,
  GIT_SH,
  harness,
  OWN_TEMP,
  signalled,
  type Scenario,
} from "./testing.ts";

/** The hooks over a fake machine, with what they did. */
function hooked(scenario: Scenario = {}) {
  const h = harness(scenario);
  return { ...h, hooks: testRunHooks(h.deps, h.leave) };
}

void test("off Windows the global setup starts nothing and the teardown has nothing to close", async () => {
  for (const platform of ["linux", "darwin"] as const) {
    const h = hooked({ platform });
    await h.hooks.globalSetup();
    await h.hooks.globalTeardown();
    assert.deepEqual(h.started, []);
    assert.deepEqual(h.asked, [], "nothing looks for Git's sh");
    assert.equal(h.deps.env[SHARED_TMP_VARIABLE], undefined);
    assert.equal(h.printed(), "");
    assert.deepEqual(h.left, []);

    const held = await holdSharedTmp(h.deps, () => undefined);
    assert.ok(!("problem" in held));
    assert.equal(held.tmp, null);
  }
});

void test("on Windows the anchor is Git's sh, on the runner's temp folder, ready and checked before any test", async () => {
  const h = hooked({
    // Windows spells variables in any case: every spelling of TEMP and TMP
    // is replaced, not left beside the new one.
    env: { PATH: "C:\\bin", Temp: "C:\\elsewhere", tmp: "C:\\elsewhere" },
  });
  await h.hooks.globalSetup();
  const [anchor] = h.started;
  assert.equal(anchor?.command, GIT_SH);
  assert.deepEqual(anchor.args, ["-c", "echo ready; read _; exit 0"]);
  assert.deepEqual(anchor.env, {
    PATH: "C:\\bin",
    TEMP: OWN_TEMP,
    TMP: OWN_TEMP,
  });
  assert.deepEqual(h.asked.at(-1), `${GIT_SH} -c /usr/bin/cygpath -w /tmp`);
  // What every test file is given, and the runner's own TEMP is kept.
  assert.equal(h.deps.env[SHARED_TMP_VARIABLE], OWN_TEMP);
  assert.equal(h.deps.env.Temp, "C:\\elsewhere");
  // Held for the whole run: nothing closes it until the teardown.
  assert.equal(anchor.proc.stdinClosed, false);

  await h.hooks.globalTeardown();
  assert.equal(anchor.proc.stdinClosed, true);
  assert.deepEqual(anchor.proc.kills, []);
  assert.equal(h.printed(), "");
  assert.deepEqual(h.left, []);
});

void test("an anchor that never says it is ready, or dies first, stops the run before any test", async () => {
  const silent = hooked({ anchor: { ready: false }, expire: [30_000] });
  await silent.hooks.globalSetup();
  assert.match(
    silent.printed(),
    /^run-tests: Git's sh \(C:\\Program Files\\Git\\usr\\bin\\sh\.exe\), started to hold \/tmp for the run, did not say it was ready within 30s/,
  );
  assert.deepEqual(silent.anchor()?.kills, [undefined]);
  assert.deepEqual(silent.left, [1]);
  assert.equal(silent.deps.env[SHARED_TMP_VARIABLE], undefined);

  const dead = hooked({
    anchor: { endsBeforeReady: exited(127), stderr: "sh: broken\n" },
  });
  await dead.hooks.globalSetup();
  assert.match(
    dead.printed(),
    /started to hold \/tmp for the run, exited with code 127\. It said: sh: broken/,
  );
  assert.deepEqual(dead.left, [1]);
});

void test("Git's sh must be Git's own before anything starts", async () => {
  const h = hooked({ shAt: "C:\\msys64\\usr\\bin\\sh.exe" });
  await h.hooks.globalSetup();
  assert.match(h.printed(), /run-tests: sh on PATH is C:\\msys64.*not Git's/);
  assert.deepEqual(h.started, []);
  assert.deepEqual(h.left, [1]);

  // With Git's launcher first on PATH, as on CI, the shell it starts is
  // the one run directly.
  const launched = hooked({ shAt: "C:\\Program Files\\Git\\bin\\sh.exe" });
  await launched.hooks.globalSetup();
  assert.equal(launched.started[0]?.command, GIT_SH);
  assert.ok(launched.asked.includes(`${GIT_SH} -c /usr/bin/cygpath -w /tmp`));
  await launched.hooks.globalTeardown();
  assert.equal(launched.anchor()?.stdinClosed, true);
  assert.deepEqual(launched.left, []);
});

void test("the shared /tmp must exist and be outside the runner's temp folder", async () => {
  const refusals: [Scenario, RegExp][] = [
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
    const h = hooked(scenario);
    await h.hooks.globalSetup();
    assert.match(h.printed(), message);
    assert.deepEqual(h.left, [1], "no test ran");
    assert.equal(h.anchor()?.stdinClosed, true, "the anchor was closed");
    assert.equal(h.deps.env[SHARED_TMP_VARIABLE], undefined);
  }

  // A shell already running when the run began may hold /tmp elsewhere,
  // such as CI's own temp folder: that is fine, and it is what the tests are
  // told. A neighbour whose name only starts the same isn't inside.
  for (const elsewhere of ["D:\\a\\_temp", `${OWN_TEMP}2`]) {
    const h = hooked({
      cygpath: { code: 0, stdout: `${elsewhere}\n`, stderr: "" },
      dirs: { [OWN_TEMP]: OWN_TEMP, [elsewhere]: elsewhere },
    });
    await h.hooks.globalSetup();
    assert.deepEqual(h.left, []);
    assert.equal(h.deps.env[SHARED_TMP_VARIABLE], elsewhere);
  }
});

void test("an anchor that dies while /tmp is checked stops the run before any test", async () => {
  const h = hooked({ anchor: { endsDuringCheck: signalled("SIGTERM") } });
  await h.hooks.globalSetup();
  assert.match(
    h.printed(),
    /Git's sh holding \/tmp was stopped by SIGTERM before the tests started/,
  );
  assert.deepEqual(h.left, [1]);
  assert.equal(h.deps.env[SHARED_TMP_VARIABLE], undefined);
});

void test("an anchor that dies during the run fails it", async () => {
  const h = hooked({ anchor: { stderr: "sh: gone\n" } });
  await h.hooks.globalSetup();
  assert.deepEqual(h.left, []);
  h.anchor()?.end(exited(1));
  await settled();
  assert.match(
    h.printed(),
    /^run-tests: Git's sh holding \/tmp exited with code 1 before the tests finished, so \/tmp may have moved to a folder the suite deletes\. The tests were stopped\. It said: sh: gone/,
  );
  assert.deepEqual(h.left, [1]);
});

void test("the teardown stops the watch first, so the anchor's own exit fails nothing", async () => {
  // Even an odd exit once its input closes is reported as the end's, not as
  // a loss during the run, and leaves the result as it was.
  for (const onClose of [exited(0), exited(2)]) {
    const h = hooked({ anchor: { onClose } });
    await h.hooks.globalSetup();
    await h.hooks.globalTeardown();
    await settled();
    assert.doesNotMatch(h.printed(), /before the tests finished/);
    assert.deepEqual(h.left, []);
  }
});

void test("at the end the anchor is closed, and a slow or odd exit is reported without changing the result", async () => {
  const hangs = hooked({ anchor: { onClose: "hangs" }, expire: [10_000] });
  await hangs.hooks.globalSetup();
  await hangs.hooks.globalTeardown();
  assert.equal(hangs.anchor()?.stdinClosed, true);
  assert.deepEqual(hangs.anchor()?.kills, [undefined]);
  assert.match(
    hangs.printed(),
    /Git's sh holding \/tmp did not exit within 10s of its input closing, so it was stopped/,
  );
  assert.deepEqual(hangs.left, []);

  const odd = hooked({ anchor: { onClose: exited(2) } });
  await odd.hooks.globalSetup();
  await odd.hooks.globalTeardown();
  assert.match(
    odd.printed(),
    /Git's sh holding \/tmp exited with code 2 when the run ended, where 0 was expected/,
  );
  assert.deepEqual(odd.left, []);
});
