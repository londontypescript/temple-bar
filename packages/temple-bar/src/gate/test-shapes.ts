// The gate's check on test files (#512): no replace that deletes markup
// tags with a regular expression, and no RegExp built from a value the
// check can't prove is escaped text or a regex. CodeQL flags both only
// after a push; this finds them in the gate first. Its promise is narrow:
// these shapes aren't in the tests. CodeQL on GitHub stays the wider check.
// The full record is decision 103 in docs/adr/0007-what-the-gate-checks.md.
//
// Test files are a fixed convention, wider than `isTestPath` in
// pr/diff.ts on purpose: that one sizes pull requests and leaves shared
// test helpers in `testing/` out, while this one covers every file only
// tests run. A file the check can't read fails it, never passes.

import path from "node:path";
import type { Context } from "../context.ts";
import type { Inventory } from "./packages.ts";
import type { CheckOutcome } from "./report.ts";
import {
  findShapes,
  type CodeFinding,
  type CodeParsers,
} from "./test-shapes-code.ts";

export const TEST_SHAPES_CHECK = "regex shapes in tests";

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
// Formats that carry script the parser doesn't read: never passed unread.
const UNSUPPORTED_EXTENSIONS = new Set([".vue", ".svelte", ".astro", ".mdx"]);
const TEST_FOLDERS = new Set(["__tests__", "testing", "e2e"]);
const TEST_NAME = /\.(?:test|spec)\./;

/** How the check treats a listed path: read as code, reported as a
 * format it can't read, or not a test file's code at all. */
export function testFileKind(file: string): "code" | "unsupported" | undefined {
  const name = path.posix.basename(file);
  const isTest =
    TEST_NAME.test(name) ||
    path.posix
      .dirname(file)
      .split("/")
      .some((folder) => TEST_FOLDERS.has(folder));
  if (!isTest) return undefined;
  const extension = path.posix.extname(name);
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (UNSUPPORTED_EXTENSIONS.has(extension)) return "unsupported";
  return undefined;
}

/** Loads the two parsers only when the check runs, so hooks and other
 * commands never load oxc's native binding. */
export type ParserLoader = () => Promise<CodeParsers>;

export const loadParsers: ParserLoader = async () => {
  const [oxc, regexpp] = await Promise.all([
    import("oxc-parser"),
    import("@eslint-community/regexpp"),
  ]);
  return {
    parseSync: oxc.parseSync,
    createPatternParser: () => new regexpp.RegExpParser({ ecmaVersion: 2025 }),
  };
};

type FileFinding =
  | CodeFinding
  | { readonly kind: "unsupported" }
  | { readonly kind: "not-regular" }
  | { readonly kind: "not-text" }
  | { readonly kind: "parser-failed"; readonly reason: string };

interface Located {
  readonly where: string;
  readonly finding: FileFinding;
}

/** "packages/app: src/a.test.ts", or "the root: e2e/a.spec.ts". */
function locate(file: string, inventory: Inventory): string {
  const owner = inventory.packages
    .map((member) => member.relative)
    .filter((relative) => file.startsWith(`${relative}/`))
    .sort((a, b) => b.length - a.length)[0];
  return owner === undefined
    ? `the root: ${file}`
    : `${owner}: ${file.slice(owner.length + 1)}`;
}

function describe(finding: FileFinding): string {
  switch (finding.kind) {
    case "deletes-tags":
      return "a regular expression deletes markup tags";
    case "unescaped-regexp":
      return "a RegExp is built from a value the check can't prove is a regex or escaped text";
    case "unreadable-pattern":
      return "a replace's regular expression can't be read";
    case "too-complex":
      return "a value here is too complex for the check to read";
    case "unparseable":
      return `the file can't be read (${finding.reason})`;
    case "unsupported":
      return "a format the check can't read (Vue, Svelte, Astro or MDX) in a test path";
    case "not-regular":
      return "not a regular file (a link, or gone since it was listed)";
    case "not-text":
      return "the file can't be read as text";
    case "parser-failed":
      return `the parser failed on it (${finding.reason})`;
  }
}

function formatFindings(found: readonly Located[], files: number): string {
  const lines = [
    `gate: ${TEST_SHAPES_CHECK}: ${String(found.length)} finding(s) in ${String(files)} test file(s)`,
  ];
  for (const { where, finding } of found) {
    const line = "line" in finding ? `:${String(finding.line)}` : "";
    lines.push(`  ${where}${line}: ${describe(finding)}`);
  }
  const kinds = new Set(found.map(({ finding }) => finding.kind));
  if (kinds.has("deletes-tags")) {
    lines.push(
      "To check rendered markup:",
      '  - for an accessible name, query by role and name (getByRole("heading", { name: "…" }));',
      "  - for document text, parse the markup and read its text;",
      "  - for fixed markup, compare the exact output.",
    );
  }
  if (kinds.has("unescaped-regexp")) {
    lines.push(
      "To build a RegExp: write a regex literal, wrap each piece of text in RegExp.escape (the original text, not a hand-escaped copy), or compare the exact text instead.",
    );
  }
  if (
    [...kinds].some(
      (kind) => kind !== "deletes-tags" && kind !== "unescaped-regexp",
    )
  ) {
    lines.push("The check fails rather than pass a test file it can't read.");
  }
  lines.push(
    "A wrong refusal is fixed in temple-bar's check: there are no exemptions.",
  );
  return `${lines.join("\n")}\n`;
}

async function findingsIn(
  ctx: Context,
  file: string,
  parsers: CodeParsers,
): Promise<FileFinding[]> {
  const absolute = path.join(ctx.cwd, file);
  if (!(await ctx.fs.isRegularFile(absolute))) return [{ kind: "not-regular" }];
  const text = await ctx.fs.readText(absolute);
  // A NUL byte only ever appears in binary content.
  if (text === undefined || text.includes("\0")) return [{ kind: "not-text" }];
  try {
    return findShapes(file, text, parsers);
  } catch (error) {
    return [{ kind: "parser-failed", reason: errorText(error) }];
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(ctx: Context, message: string, detail: string): CheckOutcome {
  ctx.stderr.write(message);
  return { name: TEST_SHAPES_CHECK, status: "failed", detail };
}

/** The check's outcome over the listed paths. Every failure, including a
 * parser that won't load, comes back as this outcome: none escapes. */
export async function runTestShapesCheck(
  ctx: Context,
  listed: readonly string[],
  inventory: Inventory,
  load: ParserLoader = loadParsers,
): Promise<CheckOutcome> {
  const selected = listed
    .filter((file) => !file.endsWith("/"))
    .flatMap((file) => {
      const kind = testFileKind(file);
      return kind === undefined ? [] : [{ file, kind }];
    });
  if (selected.length === 0) {
    return {
      name: TEST_SHAPES_CHECK,
      status: "passed",
      detail: "no test files",
    };
  }
  try {
    let parsers: CodeParsers;
    try {
      parsers = await load();
    } catch (error) {
      return failed(
        ctx,
        `gate: ${TEST_SHAPES_CHECK}: the parser couldn't load: ${errorText(error)}\n`,
        "the parser couldn't load",
      );
    }
    const found: Located[] = [];
    const filesWithFindings = new Set<string>();
    for (const { file, kind } of selected) {
      const findings: FileFinding[] =
        kind === "unsupported"
          ? [{ kind: "unsupported" }]
          : await findingsIn(ctx, file, parsers);
      for (const finding of findings) {
        found.push({ where: locate(file, inventory), finding });
        filesWithFindings.add(file);
      }
    }
    if (found.length > 0) {
      return failed(
        ctx,
        formatFindings(found, filesWithFindings.size),
        `${String(found.length)} finding(s) in ${String(filesWithFindings.size)} test file(s)`,
      );
    }
    return {
      name: TEST_SHAPES_CHECK,
      status: "passed",
      detail: `${String(selected.length)} test file(s) read`,
    };
  } catch (error) {
    return failed(
      ctx,
      `gate: ${TEST_SHAPES_CHECK}: the check failed: ${errorText(error)}\n`,
      "the check failed",
    );
  }
}
