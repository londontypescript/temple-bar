// Unit tests for pinned-version.ts through the fakes: which pins are
// compared, how, and what a refusal says.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { FsSeam } from "./seams/fs.ts";
import { createFakeContext, createFakeFs } from "./testing/fakes.ts";
import { checkPinnedVersion, pinnedTempleBar } from "./pinned-version.ts";

const CHECKOUT = "/the repo";
const MANIFEST = path.join(CHECKOUT, "package.json");
const NAME = "@londontypescript/temple-bar";

function manifest(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

function devPin(version: string): string {
  return manifest({ devDependencies: { [NAME]: version } });
}

async function check(text: string | undefined, running: string) {
  const fs = createFakeFs(text === undefined ? {} : { [MANIFEST]: text });
  return checkPinnedVersion(
    createFakeContext({ fs }),
    CHECKOUT,
    "no check ran",
    () => running,
  );
}

void test("pinned-version: an exact pin equal to the running version goes ahead silently", async () => {
  assert.deepEqual(await check(devPin("0.2.1"), "0.2.1"), { kind: "go" });
  assert.deepEqual(
    await check(manifest({ dependencies: { [NAME]: "0.2.1" } }), "0.2.1"),
    { kind: "go" },
  );
});

void test("pinned-version: an older or newer exact pin refuses, naming both versions, the file and the install", async () => {
  for (const pinned of ["0.2.0", "0.3.0"]) {
    const result = await check(devPin(pinned), "0.2.1");
    assert.deepEqual(result, {
      kind: "refused",
      lines: [
        `temple-bar 0.2.1 is running, but ${MANIFEST} pins ${pinned}, so no check ran.`,
        `Fix: run \`pnpm install --frozen-lockfile\` in ${CHECKOUT}, then run this again.`,
      ],
    });
  }
});

void test("pinned-version: prerelease and build metadata are compared as exact strings", async () => {
  assert.deepEqual(await check(devPin("0.3.0-rc.1"), "0.3.0-rc.1"), {
    kind: "go",
  });
  assert.equal(
    (await check(devPin("0.3.0-rc.1"), "0.3.0-rc.2")).kind,
    "refused",
  );
  assert.equal((await check(devPin("0.3.0-rc.1"), "0.3.0")).kind, "refused");
  assert.equal(
    (await check(devPin("0.3.0+build.1"), "0.3.0+build.2")).kind,
    "refused",
  );
  assert.equal((await check(devPin("0.3.0+build.1"), "0.3.0")).kind, "refused");
  assert.deepEqual(await check(devPin("0.3.0+build.1"), "0.3.0+build.1"), {
    kind: "go",
  });
});

void test("pinned-version: a pin that isn't one exact version goes ahead with a line saying it wasn't checked", async () => {
  for (const declared of [
    "^0.2.0",
    "workspace:*",
    `npm:${NAME}@0.2.0`,
    "latest",
    "v0.2.0",
    "file:../temple-bar",
  ]) {
    assert.deepEqual(await check(devPin(declared), "0.2.1"), {
      kind: "go",
      note: `${MANIFEST} asks for temple-bar ${declared}, not an exact version, so which temple-bar runs wasn't checked`,
    });
  }
});

void test("pinned-version: no pin, or no package.json, goes ahead silently", async () => {
  assert.deepEqual(await check(manifest({ name: "x" }), "0.2.1"), {
    kind: "go",
  });
  assert.deepEqual(
    await check(manifest({ devDependencies: { other: "1.0.0" } }), "0.2.1"),
    { kind: "go" },
  );
  assert.deepEqual(await check(undefined, "0.2.1"), { kind: "go" });
});

void test("pinned-version: the running version isn't read when nothing pins temple-bar exactly", async () => {
  const fs = createFakeFs({ [MANIFEST]: devPin("^0.2.0") });
  const result = await checkPinnedVersion(
    createFakeContext({ fs }),
    CHECKOUT,
    "no check ran",
    () => {
      throw new Error("read the running version");
    },
  );
  assert.equal(result.kind, "go");
});

void test("pinned-version: exact pins in both fields that agree are compared; ones that disagree refuse, naming each", async () => {
  const both = (dependency: string, dev: string) =>
    manifest({
      dependencies: { [NAME]: dependency },
      devDependencies: { [NAME]: dev },
    });
  assert.deepEqual(await check(both("0.2.1", "0.2.1"), "0.2.1"), {
    kind: "go",
  });
  assert.equal((await check(both("0.2.0", "0.2.0"), "0.2.1")).kind, "refused");
  assert.deepEqual(await check(both("0.2.1", "0.2.0"), "0.2.1"), {
    kind: "refused",
    lines: [
      `${MANIFEST} pins more than one temple-bar, so no check ran:`,
      `  "dependencies" pins ${NAME} 0.2.1`,
      `  "devDependencies" pins ${NAME} 0.2.0`,
      `Fix: keep one pin, run \`pnpm install --frozen-lockfile\` in ${CHECKOUT}, then run this again.`,
    ],
  });
  // An exact pin wins over a range beside it, as for pnpm's own pin.
  assert.equal((await check(both("^0.2.0", "0.2.0"), "0.2.1")).kind, "refused");
  assert.deepEqual(await check(both("^0.2.0", "0.2.1"), "0.2.1"), {
    kind: "go",
  });
});

void test("pinned-version: a field of the wrong shape is ignored, and the other field's pin still compared", async () => {
  assert.equal(
    (
      await check(
        manifest({ dependencies: null, devDependencies: { [NAME]: "0.2.0" } }),
        "0.2.1",
      )
    ).kind,
    "refused",
  );
  assert.equal(
    (
      await check(
        manifest({
          dependencies: [NAME],
          devDependencies: { [NAME]: "0.2.0" },
        }),
        "0.2.1",
      )
    ).kind,
    "refused",
  );
  assert.deepEqual(
    await check(manifest({ devDependencies: { [NAME]: 2 } }), "0.2.1"),
    { kind: "go" },
  );
});

void test("pinned-version: a file that isn't a JSON object refuses", async () => {
  for (const text of ["{ not json", "null", "[]", '"0.2.1"']) {
    assert.deepEqual(await check(text, "0.2.1"), {
      kind: "refused",
      lines: [
        `${MANIFEST} isn't a JSON object, so which temple-bar it pins is unknown, and no check ran.`,
        `Fix: repair it, run \`pnpm install --frozen-lockfile\` in ${CHECKOUT}, then run this again.`,
      ],
    });
  }
});

void test("pinned-version: a read that fails for another reason refuses, never throws", async () => {
  const fs: FsSeam = {
    ...createFakeFs(),
    readText: () =>
      Promise.reject(new Error("EACCES: permission denied, open")),
  };
  assert.deepEqual(
    await checkPinnedVersion(
      createFakeContext({ fs }),
      CHECKOUT,
      "no check ran",
      () => "0.2.1",
    ),
    {
      kind: "refused",
      lines: [
        `${MANIFEST} could not be read (EACCES: permission denied, open), so which temple-bar it pins is unknown, and no check ran.`,
        "Fix: make it readable, then run this again.",
      ],
    },
  );
});

void test("pinned-version: a running version that can't be read refuses, never throws", async () => {
  const fs = createFakeFs({ [MANIFEST]: devPin("0.2.1") });
  const result = await checkPinnedVersion(
    createFakeContext({ fs }),
    CHECKOUT,
    "no check ran",
    () => {
      throw new Error("no version field");
    },
  );
  assert.deepEqual(result, {
    kind: "refused",
    lines: [
      "the running temple-bar could not read its own version (no version field), so no check ran.",
      `Fix: run \`pnpm install --frozen-lockfile\` in ${CHECKOUT}, then run this again.`,
    ],
  });
});

void test("pinned-version: the default running version is this package's own", async () => {
  const fs = createFakeFs({ [MANIFEST]: devPin("0.0.0-never-released") });
  const result = await checkPinnedVersion(
    createFakeContext({ fs }),
    CHECKOUT,
    "no check ran",
  );
  assert.equal(result.kind, "refused");
});

void test("pinnedTempleBar: reads each kind of manifest", () => {
  assert.deepEqual(pinnedTempleBar("{}"), { kind: "none" });
  assert.deepEqual(pinnedTempleBar(devPin("1.2.3")), {
    kind: "exact",
    version: "1.2.3",
  });
  assert.deepEqual(pinnedTempleBar(devPin("~1.2.3")), {
    kind: "inexact",
    declared: "~1.2.3",
  });
  assert.deepEqual(pinnedTempleBar("nope"), { kind: "unreadable" });
});
