import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serveTarball } from "./registry.ts";

void test("a truncated public-registry body returns 502 without crashing the packed-install registry", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "registry-body-test-"));
  const tarball = path.join(directory, "package.tgz");
  writeFileSync(tarball, "packed fixture");
  const fetchLocal = globalThis.fetch;
  let called = false;
  t.mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith("https://registry.npmjs.org/")) {
        called = true;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("truncated upstream body"));
              },
            }),
            { status: 200 },
          ),
        );
      }
      return fetchLocal(input, init);
    },
  );
  const registry = await serveTarball(
    { name: "@example/local", version: "1.0.0" },
    tarball,
  );
  try {
    const failed = await fetchLocal(`${registry.url}other-package`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(failed.status, 502);
    assert.match(await failed.text(), /public registry could not be reached/);
    assert.equal(called, true);
    const packed = await fetchLocal(`${registry.url}tarball.tgz`);
    assert.equal(packed.status, 200);
    assert.equal(
      await packed.text(),
      "packed fixture",
      "registry remains alive for delivery",
    );
  } finally {
    await registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
