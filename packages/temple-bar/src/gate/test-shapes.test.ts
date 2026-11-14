// The test-shapes check as a gate outcome: which files it reads, what it
// says, and that every way it can fail comes back as its own failed
// outcome. Test file contents are strings in a fake filesystem.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import type { Inventory } from "./packages.ts";
import { buildPlan, expectedOutcomes } from "./plan.ts";
import {
  loadParsers,
  runTestShapesCheck,
  TEST_SHAPES_CHECK,
  testFileKind,
} from "./test-shapes.ts";

const INVENTORY: Inventory = {
  packages: [{ relative: "packages/app", folder: "/repo/packages/app" }],
  outcome: { name: "workspace packages", status: "passed" },
};

function project(files: Record<string, string>) {
  const fs = createFakeFs(
    Object.fromEntries(
      Object.entries(files).map(([file, text]) => [`/repo/${file}`, text]),
    ),
  );
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ fs, stderr, cwd: "/repo" });
  return { ctx, fs, stderr, listed: Object.keys(files) };
}

void test("test files: the fixed convention, every JS and TS extension, and the formats it can't read", () => {
  const cases: [string, ReturnType<typeof testFileKind>][] = [
    ["src/a.test.ts", "code"],
    ["src/a.spec.cjs", "code"],
    ["src/__tests__/helpers.ts", "code"],
    ["packages/app/src/testing/x.mts", "code"],
    ["e2e/home.tsx", "code"],
    ["e2e/deep/er/x.d.ts", "code"],
    ["a.test.jsx", "code"],
    ["__tests__/Harness.svelte", "unsupported"],
    ["src/Card.test.vue", "unsupported"],
    ["e2e/page.astro", "unsupported"],
    ["testing/notes.mdx", "unsupported"],
    ["test/helpers.ts", undefined],
    ["src/a.ts", undefined],
    ["e2e/fixtures/page.html", undefined],
    ["__tests__/x.snap", undefined],
    ["src/E2E/a.ts", undefined],
    ["src/Testing/a.ts", undefined],
  ];
  for (const [file, kind] of cases)
    assert.equal(testFileKind(file), kind, file);
});

void test("outcome: no test files passes, saying so", async () => {
  const { ctx, listed } = project({ "src/a.ts": "new RegExp(x)" });
  assert.deepEqual(await runTestShapesCheck(ctx, listed, INVENTORY), {
    name: TEST_SHAPES_CHECK,
    status: "passed",
    detail: "no test files",
  });
});

void test("outcome: clean test files pass with the count read", async () => {
  const { ctx, listed, stderr } = project({
    "src/a.test.ts": "expect(html).toMatch(/<h1>/);",
    "packages/app/e2e/b.ts": "new RegExp(RegExp.escape(name));",
    "src/a.ts": "html.replace(/<[^>]+>/g, '')",
  });
  const outcome = await runTestShapesCheck(ctx, listed, INVENTORY);
  assert.deepEqual(outcome, {
    name: TEST_SHAPES_CHECK,
    status: "passed",
    detail: "2 test file(s) read",
  });
  assert.equal(stderr.lines.join(""), "");
});

void test("message: names the package, file and line, then only the remedies for what was found", async () => {
  const { ctx, listed, stderr } = project({
    "packages/app/src/Header.test.tsx":
      "const a = 1;\nconst t = html.replace(/<[^>]+>/g, '');\n",
    "e2e/home.spec.ts": "new RegExp(`^${name}$`);\n",
  });
  const outcome = await runTestShapesCheck(ctx, listed, INVENTORY);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "2 finding(s) in 2 test file(s)");
  assert.equal(
    stderr.lines.join(""),
    [
      "gate: regex shapes in tests: 2 finding(s) in 2 test file(s)",
      "  packages/app: src/Header.test.tsx:2: a regular expression deletes markup tags",
      "  the root: e2e/home.spec.ts:1: a RegExp is built from a value the check can't prove is a regex or escaped text",
      "To check rendered markup:",
      '  - for an accessible name, query by role and name (getByRole("heading", { name: "…" }));',
      "  - for document text, parse the markup and read its text;",
      "  - for fixed markup, compare the exact output.",
      "To build a RegExp: write a regex literal, wrap each piece of text in RegExp.escape (the original text, not a hand-escaped copy), or compare the exact text instead.",
      "A wrong refusal is fixed in temple-bar's check: there are no exemptions.",
      "",
    ].join("\n"),
  );
});

void test("reports: unparseable, unsupported, linked, binary and missing files fail the check", async () => {
  const { ctx, fs, listed, stderr } = project({
    "src/broken.test.ts": "const x = ;",
    "__tests__/Harness.svelte": "<script>let a;</script>",
    "src/bin.test.js": "a\0b",
    "src/gone.test.ts": "",
  });
  fs.files.delete(path.join("/repo", "src/gone.test.ts"));
  fs.symlinks.add("/repo/e2e/linked.ts");
  const outcome = await runTestShapesCheck(
    ctx,
    [...listed, "e2e/linked.ts", "nested-worktree/"],
    INVENTORY,
  );
  assert.equal(outcome.status, "failed");
  const text = stderr.lines.join("");
  assert.match(
    text,
    /the root: src\/broken\.test\.ts:1: the file can't be read \(/,
  );
  assert.match(
    text,
    /the root: __tests__\/Harness\.svelte: a format the check can't read/,
  );
  assert.match(
    text,
    /the root: src\/bin\.test\.js: the file can't be read as text/,
  );
  assert.match(text, /the root: src\/gone\.test\.ts: not a regular file/);
  assert.match(text, /the root: e2e\/linked\.ts: not a regular file/);
  assert.match(
    text,
    /The check fails rather than pass a test file it can't read\./,
  );
  assert.doesNotMatch(text, /nested-worktree/);
});

void test("failures: a parser that won't load or throws is the check's own failed outcome", async () => {
  const { ctx, listed, stderr } = project({ "src/a.test.ts": "x();" });
  assert.deepEqual(
    await runTestShapesCheck(ctx, listed, INVENTORY, () =>
      Promise.reject(new Error("no native binding")),
    ),
    {
      name: TEST_SHAPES_CHECK,
      status: "failed",
      detail: "the parser couldn't load",
    },
  );
  assert.match(
    stderr.lines.join(""),
    /the parser couldn't load: no native binding/,
  );

  const throwing = await runTestShapesCheck(
    ctx,
    listed,
    INVENTORY,
    async () => {
      const real = await loadParsers();
      return {
        ...real,
        parseSync: () => {
          throw new Error("parser crashed");
        },
      };
    },
  );
  assert.equal(throwing.status, "failed");
  assert.match(
    stderr.lines.join(""),
    /src\/a\.test\.ts: the parser failed on it \(parser crashed\)/,
  );
});

void test("failures: an error reading the disk is the check's own failed outcome", async () => {
  const { ctx, listed, stderr } = project({ "src/a.test.ts": "x();" });
  ctx.fs.isRegularFile = () => Promise.reject(new Error("EIO"));
  const outcome = await runTestShapesCheck(ctx, listed, INVENTORY);
  assert.deepEqual(outcome, {
    name: TEST_SHAPES_CHECK,
    status: "failed",
    detail: "the check failed",
  });
  assert.match(stderr.lines.join(""), /the check failed: EIO/);
});

void test("plan: the check is one repo-part entry, so the whole gate and --part repo run the same code", async () => {
  const plan = buildPlan(INVENTORY);
  const entries = plan.filter((entry) =>
    entry.outcomes.includes(TEST_SHAPES_CHECK),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.part, "repo");
  assert.ok(expectedOutcomes(plan, "repo").includes(TEST_SHAPES_CHECK));
  const { ctx, listed } = project({
    "src/a.test.ts": "html.replace(/<b>/g, '')",
  });
  const [entry] = entries;
  assert.ok(entry);
  const result = await entry.run(ctx, {
    listed,
    launcher: undefined as never,
    inventory: INVENTORY,
    tools: undefined as never,
    commandFor: () => Promise.resolve(undefined),
  });
  assert.deepEqual(
    result.outcomes.map((outcome) => outcome.status),
    ["failed"],
  );
});

void test("loading: only the check loads the parsers, and only when it runs", () => {
  const root = path.join(import.meta.dirname, "..");
  const offenders: string[] = [];
  const visit = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts"))
        continue;
      const text = readFileSync(full, "utf8");
      // A value import (not `import type`) of either parser, anywhere but
      // the check's own dynamic import, would load it with every command.
      const valueImport =
        /^import\s+(?!type\b)[^;]*from\s+"(?:oxc-parser|@eslint-community\/regexpp)"/m;
      if (valueImport.test(text)) offenders.push(path.relative(root, full));
      if (
        /import\("(?:oxc-parser|@eslint-community\/regexpp)"\)/.test(text) &&
        !full.endsWith(path.join("gate", "test-shapes.ts"))
      ) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  visit(root);
  assert.deepEqual(offenders, []);
});

// Prints a line whenever anything resolves either parser, so a run shows
// whether it loaded one.
const PARSER_WATCH =
  "data:text/javascript," +
  encodeURIComponent(
    [
      'import { registerHooks } from "node:module";',
      "registerHooks({ resolve(specifier, context, next) {",
      '  if (specifier === "oxc-parser" || specifier === "@eslint-community/regexpp")',
      '    process.stderr.write("parser loaded: " + specifier + "\\n");',
      "  return next(specifier, context);",
      "} });",
    ].join("\n"),
  );

void test("loading: a hook, pr-title, help and version run without loading either parser", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "temple-bar-shapes-load-"));
  try {
    const message = path.join(folder, "COMMIT_EDITMSG");
    writeFileSync(message, "feat: add a thing\n");
    const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
    for (const args of [
      ["hook", "commit-msg", message],
      ["pr-title", "feat: add a thing"],
      ["--help"],
      ["--version"],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["--import", PARSER_WATCH, cli, ...args],
        { cwd: folder, encoding: "utf8" },
      );
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /parser loaded/, args.join(" "));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  // The watch does see a load, so its silence above means something.
  const control = spawnSync(
    process.execPath,
    [
      "--import",
      PARSER_WATCH,
      "--input-type=module",
      "-e",
      'await import("oxc-parser");',
    ],
    { cwd: import.meta.dirname, encoding: "utf8" },
  );
  assert.match(control.stderr, /parser loaded: oxc-parser/);
});
