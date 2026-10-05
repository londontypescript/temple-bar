// Unit tests for agents-template.ts: what a new AGENTS.md holds, and how
// temple-bar's marked block goes into a file that already exists.

import assert from "node:assert/strict";
import test from "node:test";

import { measureAgentsFile } from "../gate/agents-size.ts";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  freshAgentsMd,
  templeBarBlock,
  withTempleBarBlock,
} from "./agents-template.ts";
import { COMPANION_FILES } from "./companion-docs.ts";

/** Next.js's own AGENTS.md, in the shape it ships: a marked block of its
 * own, which setup must keep exactly as it is. */
const NEXTJS_AGENTS_MD = `<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Read the docs in node_modules/next/dist/docs/ before writing code.
<!-- END:nextjs-agent-rules -->
`;

void test("a new AGENTS.md fits the gate's size limits, even beside a framework's own file", () => {
  for (const content of [
    freshAgentsMd(),
    `${NEXTJS_AGENTS_MD}\n${templeBarBlock()}`,
  ]) {
    const size = measureAgentsFile(content);
    assert.equal(size.overLines, false, `${String(size.lines)} lines`);
    assert.equal(size.overBytes, false, `${String(size.bytes)} bytes`);
  }
});

void test("a new AGENTS.md starts with a heading and holds temple-bar's rules inside the markers", () => {
  const content = freshAgentsMd();
  assert.match(content, /^# Agent directives\n/);
  const begin = content.indexOf(BLOCK_BEGIN);
  const end = content.indexOf(BLOCK_END);
  assert.ok(begin > 0 && end > begin);
  assert.ok(content.endsWith(`${BLOCK_END}\n`));
});

void test("the rules carry what every project needs from them", () => {
  // Compared with line breaks flattened, so rewrapping the text is not a
  // failure.
  const block = templeBarBlock().replace(/\s+/g, " ");
  for (const required of [
    "ask the user what we're building",
    "`typecheck`, `lint`, `format:check` and `test`",
    "never no-ops",
    "Two strikes, then stop",
    "the base commit (SHA) and the branch",
    "the exact command that reproduces the problem",
    "what has been ruled out, with the reason for each",
    "post it only after their yes",
    "Commit at every point where the checks pass",
    "`One concern:`",
    "every issue's premise",
    "placing issues in a milestone",
  ]) {
    assert.ok(block.includes(required), required);
  }
});

void test("every doc the rules link to is one setup writes", () => {
  const written = new Set(COMPANION_FILES.map((file) => file.path));
  const links = [...templeBarBlock().matchAll(/\]\((docs\/[^)]+)\)/g)].map(
    (match) => match[1],
  );
  assert.ok(links.length >= 4);
  for (const link of links) {
    assert.ok(written.has(link ?? ""), `${link ?? ""} is not written`);
  }
});

void test("nothing setup writes points into temple-bar's own plans or issue numbers", () => {
  const texts = [
    freshAgentsMd(),
    ...COMPANION_FILES.map((file) => file.content),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /#\d+/);
    assert.doesNotMatch(text, /\bdecision \d+/i);
    assert.doesNotMatch(text, /docs\/plans\//);
  }
});

void test("an AGENTS.md without the block gets it added at the end, the rest kept as it was", () => {
  const update = withTempleBarBlock(NEXTJS_AGENTS_MD);
  assert.equal(update.kind, "updated");
  assert.equal(update.content, `${NEXTJS_AGENTS_MD}\n${templeBarBlock()}`);
  assert.deepEqual(withTempleBarBlock(update.content), { kind: "unchanged" });
});

void test("a file with no final newline still gets a blank line before the block", () => {
  const update = withTempleBarBlock("# Rules\n\nOur own.");
  assert.equal(update.kind, "updated");
  assert.equal(update.content, `# Rules\n\nOur own.\n\n${templeBarBlock()}`);
});

void test("an empty AGENTS.md becomes a new one", () => {
  assert.deepEqual(withTempleBarBlock("\n"), {
    kind: "updated",
    content: freshAgentsMd(),
  });
});

void test("an outdated block is replaced in place, and only the block", () => {
  const before = "# Agent directives\n\nOur rule first.\n\n";
  const after = "\n## Our own section\n\nKept.\n";
  const outdated = `${before}<!-- BEGIN:temple-bar: older wording -->\n\n## Old rules\n\nGone.\n\n${BLOCK_END}\n${after}`;
  const update = withTempleBarBlock(outdated);
  assert.equal(update.kind, "updated");
  assert.equal(update.content, `${before}${templeBarBlock()}${after}`);
  assert.deepEqual(withTempleBarBlock(update.content), { kind: "unchanged" });
});

void test("markers that don't pair up leave the file alone", () => {
  const cases: [string, RegExp][] = [
    [`# Rules\n\n${BLOCK_BEGIN}\n\nNo end.\n`, /1 BEGIN and 0 END lines/],
    [`# Rules\n\n${BLOCK_END}\n`, /0 BEGIN and 1 END lines/],
    [`${BLOCK_END}\n\n${BLOCK_BEGIN}\n`, /END line comes first/],
    [`${templeBarBlock()}\n${templeBarBlock()}`, /2 BEGIN and 2 END lines/],
  ];
  for (const [content, detail] of cases) {
    const update = withTempleBarBlock(content);
    assert.equal(update.kind, "malformed", content);
    assert.match(update.detail, detail);
  }
});
