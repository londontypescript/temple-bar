// A refusal says what to do instead, and never how to get around it: naming
// `--no-verify` or an override variable invites an agent to use it.
//
// Rather than a hand-kept list of messages, which would miss the next one
// added, this parses every shipped source file of every package and checks
// each piece of text a message can be built from: string literals, template
// literals, and `+` chains joined back together, so a bypass split across
// pieces is still caught. Comments are not text a user sees, so a comment
// explaining why a hook exists may still name the bypass it guards against.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

interface Bypass {
  readonly name: string;
  readonly pattern: RegExp;
}

const SKIP_WORDS = "SKIP|OVERRIDE|BYPASS|DISABLE|DISABLED|NO_VERIFY|NOVERIFY";

const BYPASSES: readonly Bypass[] = [
  { name: "--no-verify", pattern: /--no-verify\b/ },
  // `git commit -n` is `--no-verify`, alone or in a cluster such as `-nm`.
  {
    name: "commit -n",
    pattern: /\bcommit\b[^\n]*?\s-[a-zA-Z]*n[a-zA-Z]*(?![\w-])/,
  },
  { name: "--admin", pattern: /--admin\b/ },
  { name: "HUSKY", pattern: /\bHUSKY\w*/ },
  { name: "LEFTHOOK", pattern: /\bLEFTHOOK\w*/ },
  // Pointing git at another hooks folder turns every hook off. Naming the
  // key to unset it is a fix; setting it to something is the bypass.
  {
    name: "setting core.hooksPath",
    pattern:
      /core\.hooksPath\s*=|config\s+(?:--\S+\s+)*core\.hooksPath\s+[^\s-]/i,
  },
  { name: "--no-gpg-sign", pattern: /--no-gpg-sign\b/ },
  { name: "gpgsign=false", pattern: /gpgsign\s*=\s*false/i },
  // Skips the install script that puts the hooks in place.
  { name: "--ignore-scripts", pattern: /--ignore-scripts\b/ },
  // An environment variable that switches a check off: SKIP=..., or any
  // UPPER_CASE name with a skip or override word in it.
  {
    name: "skip or override variable",
    pattern: new RegExp(
      `\\bSKIP=|\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:${SKIP_WORDS})(?:_[A-Z0-9]+)*\\b|\\b(?:${SKIP_WORDS})(?:_[A-Z0-9]+)+\\b`,
    ),
  },
];

interface Hit {
  readonly where: string;
  readonly bypass: string;
  readonly text: string;
}

const PLACEHOLDER = "${...}";

function isPlus(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  );
}

/** The text a node contributes to a message: literal text as written, and a
 * placeholder wherever a value is filled in at run time. */
function textOf(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join("")
    );
  }
  if (ts.isParenthesizedExpression(node)) {
    return textOf(node.expression);
  }
  if (isPlus(node)) {
    return textOf(node.left) + textOf(node.right);
  }
  return PLACEHOLDER;
}

/** Every piece of text in a source file a message could be built from. */
function messageTexts(
  fileName: string,
  source: string,
): { readonly line: number; readonly text: string }[] {
  // Parent links are needed to tell the outermost `+` of a chain.
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const texts: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node);
    // A `+` chain is read whole once, from its outermost `+`.
    const isChain = isPlus(node) && !isPlus(node.parent);
    if (isText || isChain) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      texts.push({ line: line + 1, text: textOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return texts;
}

function findBypasses(fileName: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const { line, text } of messageTexts(fileName, source)) {
    for (const bypass of BYPASSES) {
      if (bypass.pattern.test(text)) {
        hits.push({
          where: `${fileName}:${String(line)}`,
          bypass: bypass.name,
          text,
        });
      }
    }
  }
  return hits;
}

const PACKAGES = path.resolve(import.meta.dirname, "..", "..");

/** The files that ship: the same ones the build compiles. Tests and their
 * helpers drive git with bypass flags on purpose, to prove the hooks hold. */
function shippedSources(): string[] {
  const files: string[] = [];
  for (const pkg of readdirSync(PACKAGES)) {
    const src = path.join(PACKAGES, pkg, "src");
    let entries: string[];
    try {
      entries = readdirSync(src, { recursive: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const parts = entry.split(path.sep);
      if (
        entry.endsWith(".ts") &&
        !entry.endsWith(".test.ts") &&
        !entry.endsWith(".test-entry.ts") &&
        !parts.includes("testing") &&
        !parts.includes("node_modules")
      ) {
        files.push(path.join(src, entry));
      }
    }
  }
  return files.sort();
}

void test("no message in any shipped source names a way around a refusal", () => {
  const files = shippedSources();
  const hits = files.flatMap((file) =>
    findBypasses(path.relative(PACKAGES, file), readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    hits.map((hit) => `${hit.where} names ${hit.bypass}: ${hit.text}`),
    [],
    "A message names a way around a refusal. Say what to do instead.",
  );
});

void test("the scan reads the real refusal messages, not an empty set", () => {
  const files = shippedSources();
  const all = files.flatMap((file) =>
    messageTexts(file, readFileSync(file, "utf8")).map((entry) => entry.text),
  );
  // One refusal from each kind of stop: a hook, init, the gate and merge.
  for (const expected of [
    /refusing to commit directly to/,
    /refusing to move local/,
    /Not a git repository/,
    /the default branch's ruleset is missing or weakened/,
    /could not read the checks on/,
  ]) {
    assert.ok(
      all.some((text) => expected.test(text)),
      `${String(expected)} not found`,
    );
  }
  assert.ok(
    files.some((file) => file.includes(`create-temple-bar${path.sep}`)),
    "create-temple-bar's sources are scanned too",
  );
});

void test("each bypass is caught, however the message is put together", () => {
  const cases: readonly [string, string][] = [
    ["--no-verify", 'write("retry with git commit --no-verify")'],
    ["commit -n", 'write("or run git commit -n")'],
    ["commit -n", 'write("or run git commit -nm wip")'],
    ["--admin", "write(`run gh pr merge ${n} --admin`)"],
    ["HUSKY", 'write("set HUSKY=0 first")'],
    ["LEFTHOOK", 'write("set LEFTHOOK=0 first")'],
    ["setting core.hooksPath", 'write("git config core.hooksPath /dev/null")'],
    ["setting core.hooksPath", 'write("git -c core.hooksPath=x commit")'],
    ["--no-gpg-sign", 'write("commit with --no-gpg-sign")'],
    ["gpgsign=false", 'write("git -c commit.gpgsign=false commit")'],
    ["--ignore-scripts", 'write("pnpm install --ignore-scripts")'],
    ["skip or override variable", 'write("set TEMPLE_BAR_SKIP=1")'],
    ["skip or override variable", 'write("SKIP_HOOKS=1 git commit")'],
    ["skip or override variable", 'write("SKIP=pre-commit git commit")'],
    // Split across a `+` chain, or around a value filled in at run time.
    ["--no-verify", 'write("git commit --no-" + "verify")'],
    ["commit -n", "write(`git commit ${flag} -n`)"],
  ];
  for (const [bypass, source] of cases) {
    assert.deepEqual(
      findBypasses("case.ts", source).map((hit) => hit.bypass),
      [bypass],
      source,
    );
  }
});

void test("comments, fixes and ordinary text are not bypasses", () => {
  const source = [
    "// `commit --no-verify` skips pre-commit, so this hook refuses too.",
    "/** No `--admin`: a ruleset is never bypassed. */",
    'write("Create a branch first: git switch -c <name>");',
    'write("has no bypass list");',
    'write("git config --local --unset core.hooksPath");',
    'const key = "core.hooksPath";',
    'write("set GH_TOKEN to a GitHub token");',
    'write(`  git commit -m "Initial commit" && git push -u origin HEAD`);',
    'write(`if [ -n "$common" ]; then`);',
    'write("3 checks skipped");',
  ].join("\n");
  assert.deepEqual(findBypasses("case.ts", source), []);
});
