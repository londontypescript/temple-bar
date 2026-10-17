import assert from "node:assert/strict";
import test from "node:test";

import { ensurePrettierIgnore } from "./prettier-ignore.ts";
import { setupWriteTargets } from "./write-target.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

const IGNORE = "/repo/.prettierignore";

/** Runs setup's step once against `fs` and returns whether it wrote. */
async function ensure(fs: ReturnType<typeof createFakeFs>): Promise<boolean> {
  const ctx = createFakeContext({ fs });
  return ensurePrettierIgnore(setupWriteTargets(ctx, "/repo"));
}

void test("prettierignore: creates the file holding the lockfile line when there is none", async () => {
  const fs = createFakeFs();
  assert.equal(await ensure(fs), true);
  assert.equal(fs.files.get(IGNORE), "pnpm-lock.yaml\n");
});

void test("prettierignore: appends the line to a file without it, keeping every existing line in order", async () => {
  const original = "dist/\n# generated\ncoverage/\n";
  const fs = createFakeFs({ [IGNORE]: original });
  assert.equal(await ensure(fs), true);
  assert.equal(fs.files.get(IGNORE), `${original}pnpm-lock.yaml\n`);
});

void test("prettierignore: a file without a trailing newline gets one before the line and after it", async () => {
  const fs = createFakeFs({ [IGNORE]: "dist/" });
  assert.equal(await ensure(fs), true);
  assert.equal(fs.files.get(IGNORE), "dist/\npnpm-lock.yaml\n");
});

void test("prettierignore: a file with Windows line endings keeps them", async () => {
  const fs = createFakeFs({ [IGNORE]: "dist/\r\ncoverage/" });
  assert.equal(await ensure(fs), true);
  assert.equal(
    fs.files.get(IGNORE),
    "dist/\r\ncoverage/\r\npnpm-lock.yaml\r\n",
  );
});

for (const line of ["pnpm-lock.yaml", "/pnpm-lock.yaml", "pnpm-lock.yaml  "]) {
  void test(`prettierignore: a file already holding ${JSON.stringify(line)} is left alone`, async () => {
    const original = `dist/\r\n${line}\r\n`;
    const fs = createFakeFs({ [IGNORE]: original });
    assert.equal(await ensure(fs), false);
    assert.equal(fs.files.get(IGNORE), original);
    assert.equal(fs.writes.length, 0);
  });
}

void test("prettierignore: a broader pattern doesn't count, so the exact line is still added", async () => {
  // Matching gitignore rules in full is more than setup should take on, and
  // an extra exact line beside `*.yaml` changes nothing for Prettier.
  const fs = createFakeFs({ [IGNORE]: "*.yaml\n" });
  assert.equal(await ensure(fs), true);
  assert.equal(fs.files.get(IGNORE), "*.yaml\npnpm-lock.yaml\n");
});

void test("prettierignore: a commented-out or negated lockfile line doesn't count", async () => {
  const fs = createFakeFs({ [IGNORE]: "# pnpm-lock.yaml\n!pnpm-lock.yaml\n" });
  assert.equal(await ensure(fs), true);
  assert.equal(
    fs.files.get(IGNORE),
    "# pnpm-lock.yaml\n!pnpm-lock.yaml\npnpm-lock.yaml\n",
  );
});

void test("prettierignore: a negation after the lockfile line gets the line again after it", async () => {
  // `!*.yaml` brings the lockfile back, since a later rule wins; setup
  // doesn't try to work out which negations match, and adds the line last.
  const fs = createFakeFs({ [IGNORE]: "pnpm-lock.yaml\n!*.yaml\n" });
  assert.equal(await ensure(fs), true);
  assert.equal(
    fs.files.get(IGNORE),
    "pnpm-lock.yaml\n!*.yaml\npnpm-lock.yaml\n",
  );
  assert.equal(await ensure(fs), false);
});

void test("prettierignore: a negation before the lockfile line leaves it alone", async () => {
  const original = "!*.yaml\npnpm-lock.yaml\n";
  const fs = createFakeFs({ [IGNORE]: original });
  assert.equal(await ensure(fs), false);
  assert.equal(fs.files.get(IGNORE), original);
});

void test("prettierignore: a second run writes nothing, from an absent file or an existing one", async () => {
  for (const fs of [createFakeFs(), createFakeFs({ [IGNORE]: "dist/" })]) {
    assert.equal(await ensure(fs), true);
    const written = fs.files.get(IGNORE);
    const writes = fs.writes.length;
    assert.equal(await ensure(fs), false);
    assert.equal(fs.files.get(IGNORE), written);
    assert.equal(fs.writes.length, writes);
  }
});

void test("prettierignore: a symlinked .prettierignore is refused and not written through", async () => {
  const fs = createFakeFs();
  fs.linkTargets.set(IGNORE, "elsewhere");
  const ctx = createFakeContext({ fs });
  const targets = setupWriteTargets(ctx, "/repo");
  assert.equal(await ensurePrettierIgnore(targets), false);
  assert.ok(targets.refusals.has(".prettierignore"));
  assert.equal(fs.writes.length, 0);
});
