import assert from "node:assert/strict";
import test from "node:test";

import { declaredPnpm } from "./pnpm-pin.ts";

function manifest(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

void test("pnpm-pin: an exact packageManager pin is the declared version", () => {
  assert.deepEqual(declaredPnpm(manifest({ packageManager: "pnpm@9.15.0" })), {
    kind: "exact",
    version: "9.15.0",
  });
});

void test("pnpm-pin: a +sha512 suffix is removed", () => {
  assert.deepEqual(
    declaredPnpm(manifest({ packageManager: "pnpm@10.34.5+sha512.abc123" })),
    { kind: "exact", version: "10.34.5" },
  );
});

void test("pnpm-pin: an exact devEngines version is the declared version", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        devEngines: { packageManager: { name: "pnpm", version: "10.1.0" } },
      }),
    ),
    { kind: "exact", version: "10.1.0" },
  );
});

void test("pnpm-pin: a devEngines range is a range, not compared", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        devEngines: { packageManager: { name: "pnpm", version: "^10.0.0" } },
      }),
    ),
    { kind: "range", declared: "^10.0.0" },
  );
});

void test("pnpm-pin: an exact packageManager wins over a devEngines range", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        packageManager: "pnpm@9.15.0",
        devEngines: { packageManager: { name: "pnpm", version: ">=9" } },
      }),
    ),
    { kind: "exact", version: "9.15.0" },
  );
});

void test("pnpm-pin: two different exact versions contradict each other", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        packageManager: "pnpm@9.15.0",
        devEngines: { packageManager: { name: "pnpm", version: "10.1.0" } },
      }),
    ),
    {
      kind: "conflict",
      pins: [
        { field: "devEngines.packageManager", version: "10.1.0" },
        { field: "packageManager", version: "9.15.0" },
      ],
    },
  );
});

void test("pnpm-pin: a later exact devEngines entry still counts, after a range", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        packageManager: "pnpm@10.1.0",
        devEngines: {
          packageManager: [
            { name: "pnpm", version: ">=9" },
            { name: "pnpm", version: "9.15.0" },
          ],
        },
      }),
    ),
    {
      kind: "conflict",
      pins: [
        { field: "devEngines.packageManager", version: "9.15.0" },
        { field: "packageManager", version: "10.1.0" },
      ],
    },
  );
});

void test("pnpm-pin: two equal exact versions agree", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        packageManager: "pnpm@9.15.0+sha512.x",
        devEngines: { packageManager: { name: "pnpm", version: "9.15.0" } },
      }),
    ),
    { kind: "exact", version: "9.15.0" },
  );
});

void test("pnpm-pin: devEngines may list several managers; the pnpm one counts", () => {
  assert.deepEqual(
    declaredPnpm(
      manifest({
        devEngines: {
          packageManager: [
            { name: "yarn", version: "4.0.0" },
            { name: "pnpm", version: "9.0.0" },
          ],
        },
      }),
    ),
    { kind: "exact", version: "9.0.0" },
  );
});

void test("pnpm-pin: no pin, another manager, or unreadable JSON declares nothing", () => {
  assert.deepEqual(declaredPnpm("{}"), { kind: "none" });
  assert.deepEqual(declaredPnpm(manifest({ packageManager: "yarn@4.0.0" })), {
    kind: "none",
  });
  assert.deepEqual(declaredPnpm("{ not json"), { kind: "none" });
  assert.deepEqual(declaredPnpm("[]"), { kind: "none" });
});

void test("pnpm-pin: packageManager pnpm@latest is not an exact version", () => {
  assert.deepEqual(declaredPnpm(manifest({ packageManager: "pnpm@latest" })), {
    kind: "range",
    declared: "latest",
  });
});
