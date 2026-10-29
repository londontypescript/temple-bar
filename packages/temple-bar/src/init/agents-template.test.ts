// Unit tests for agents-template.ts: what a new AGENTS.md holds, and how
// temple-bar's marked block goes into a file that already exists.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import test from "node:test";

import { measureAgentsFile } from "../gate/agents-size.ts";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  blockHash,
  EARLIER_BLOCK_SHA256,
  freshAgentsMd,
  isCurrentBlock,
  locateTempleBarBlock,
  templeBarBlock,
  withTempleBarBlock,
} from "./agents-template.ts";
import { COMPANION_FILES } from "./companion-docs.ts";
import { AGENTS_BLOCK_0_2_1 } from "./testing/agents-block-0-2-1.ts";
import { AGENTS_MD_0_1_0 } from "./testing/agents-md-0-1-0.ts";

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

/** A text with its line breaks flattened, so rewrapping is not a failure. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function companion(path: string): string {
  const file = COMPANION_FILES.find((candidate) => candidate.path === path);
  assert.ok(file, `${path} is not written`);
  return file.content;
}

void test("the rules carry what every project needs from them", () => {
  const block = flat(templeBarBlock());
  for (const required of [
    "ask the user what we're building",
    "`typecheck`, `lint`, `format:check` and `test`",
    "never no-ops",
    "Two strikes, then stop",
    "post it only after the user has seen the exact text and said yes",
    "Commit at every point where the checks pass",
    "`One concern:`",
    "Check every premise against the ADRs and git history",
    "placing issues in a milestone",
    "One GitHub reference per line",
    "Never run `git worktree add`",
    "**mechanical**, **routine**, **involved**, **delicate** or **critical**",
    "any step that can't be undone",
    "`docs/plans/<version>.md`",
    "`gh pr create --milestone <name>`",
  ]) {
    assert.ok(block.includes(required), required);
  }
});

void test("the update before work stops keeps its fields in the guide the block sends agents to", () => {
  const block = flat(templeBarBlock());
  assert.ok(block.includes("read [docs/phase-boundaries.md]"));
  const guide = flat(companion("docs/phase-boundaries.md"));
  for (const required of [
    "the base commit (SHA) and the branch",
    "the exact command that reproduces the problem",
    "what has been ruled out, with the reason for each",
    "the next action",
  ]) {
    assert.ok(guide.includes(required), required);
  }
});

void test("every doc the rules link to is one setup writes", () => {
  const written = new Set(COMPANION_FILES.map((file) => file.path));
  const links = [...templeBarBlock().matchAll(/\]\((docs\/[^)]+)\)/g)].map(
    (match) => match[1] ?? "",
  );
  for (const guide of [
    "docs/planning.md",
    "docs/phase-boundaries.md",
    "docs/pull-requests.md",
    "docs/delegation.md",
    "docs/incidents.md",
  ]) {
    assert.ok(links.includes(guide), `the block doesn't link to ${guide}`);
  }
  for (const link of links) {
    assert.ok(written.has(link), `${link} is not written`);
  }
});

void test("every relative link in a doc setup writes points at a file setup writes", () => {
  const written = new Set([
    "AGENTS.md",
    ...COMPANION_FILES.map((file) => file.path),
  ]);
  let checked = 0;
  for (const file of COMPANION_FILES) {
    for (const match of file.content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1] ?? "";
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) {
        continue;
      }
      const resolved = posix.normalize(
        posix.join(posix.dirname(file.path), target.split("#")[0] ?? ""),
      );
      assert.ok(
        written.has(resolved),
        `${file.path} links to ${target}, which setup doesn't write`,
      );
      checked += 1;
    }
  }
  // The rationale links AGENTS.md; the planning and pull request guides
  // link the ADR template and the rationale.
  assert.ok(checked >= 3, `only ${String(checked)} links checked`);
});

void test("nothing setup writes points into temple-bar's own plans or issue numbers", () => {
  const texts = [
    freshAgentsMd(),
    ...COMPANION_FILES.map((file) => file.content),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /#\d+/);
    assert.doesNotMatch(text, /\bdecision \d+/i);
    // Projects keep their own plans in docs/plans/; only temple-bar's is off limits.
    assert.doesNotMatch(text, /docs\/plans\/temple-bar/);
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

const OUR_BEFORE = "# Agent directives\n\nOur rule first.\n\n";
const OUR_AFTER = "\n## Our own section\n\nKept.\n";
const OLDER_BLOCK = `<!-- BEGIN:temple-bar: older wording -->\n\n## Old rules\n\nGone.\n\n${BLOCK_END}\n`;

void test("a block an earlier release wrote is replaced in place, and only the block", () => {
  const outdated = `${OUR_BEFORE}${OLDER_BLOCK}${OUR_AFTER}`;
  const update = withTempleBarBlock(outdated, [blockHash(OLDER_BLOCK)]);
  assert.deepEqual(update, {
    kind: "updated",
    content: `${OUR_BEFORE}${templeBarBlock()}${OUR_AFTER}`,
  });
  assert.equal(update.kind, "updated");
  assert.deepEqual(withTempleBarBlock(update.content), { kind: "unchanged" });
});

void test("a block edited by hand is refused, not overwritten", () => {
  const edited = `${OUR_BEFORE}${templeBarBlock().replace("## Plans", "## Plans\n\nOur extra rule.")}${OUR_AFTER}`;
  const update = withTempleBarBlock(edited, [blockHash(OLDER_BLOCK)]);
  assert.equal(update.kind, "refused");
  assert.match(update.detail, /has been edited/);
  // So is an older-looking block no release is known to have written.
  assert.equal(
    withTempleBarBlock(`${OUR_BEFORE}${OLDER_BLOCK}`).kind,
    "refused",
  );
});

void test("our own AGENTS.md as 0.1.0 left it gets the new block in place, our section above kept byte for byte", () => {
  const location = locateTempleBarBlock(AGENTS_MD_0_1_0);
  assert.equal(location.kind, "found");
  assert.ok(
    EARLIER_BLOCK_SHA256.includes(blockHash(location.block)),
    "the block 0.1.0 wrote is not recorded",
  );
  const update = withTempleBarBlock(AGENTS_MD_0_1_0);
  assert.equal(update.kind, "updated");
  const ours = AGENTS_MD_0_1_0.slice(0, AGENTS_MD_0_1_0.indexOf("<!-- BEGIN"));
  assert.ok(ours.includes("## This repo"));
  assert.equal(update.content, `${ours}${templeBarBlock()}${location.after}`);
  assert.deepEqual(withTempleBarBlock(update.content), { kind: "unchanged" });
});

void test("an AGENTS.md holding the 0.2.1 block gets today's block in place, the project's text above and below kept byte for byte", () => {
  const above = "# Agent directives\n\nOur rule first.\n\n";
  const below = "\n## Our own section\n\nKept, with a trailing space. \n";
  const upgrade = withTempleBarBlock(`${above}${AGENTS_BLOCK_0_2_1}${below}`);
  assert.notEqual(
    upgrade.kind,
    "refused",
    upgrade.kind === "refused" ? upgrade.detail : "",
  );
  assert.deepEqual(upgrade, {
    kind: "updated",
    content: `${above}${templeBarBlock()}${below}`,
  });
  assert.deepEqual(withTempleBarBlock(upgrade.content), { kind: "unchanged" });
});

// The gate requires this exact block in every repo from the next pin bump,
// so a change to it must be deliberate and update this hash.
const APPROVED_BLOCK_SHA256 =
  "331e45e7615e041c520013de3f2a27d4a367d42864e8499e7d6a93a32db074ae";

void test("the block is exactly the approved text", () => {
  assert.equal(
    blockHash(templeBarBlock()),
    APPROVED_BLOCK_SHA256,
    "the block differs from the approved text: if the change is deliberate, update APPROVED_BLOCK_SHA256",
  );
});

// Setup writes these texts into every repo and the block links to them, so
// a change to one must be deliberate and update its hash here.
const APPROVED_COMPANION_SHA256: Readonly<Record<string, string>> = {
  "docs/agents-rationale.md":
    "4697729f3858e1e1b908e3ef68387d57423ed68ab3ab0f9e8c30f67d99b1d520",
  "docs/phase-boundaries.md":
    "caf57ee44818ca76eee2fc6a7a93e813742820c5f6c14ea6a318fd3563bb549e",
  "docs/planning.md":
    "664be6f35c101086696802793f5b7c57923385144f518044a8d7a54a7edb1b5f",
  "docs/pull-requests.md":
    "b45f68f91355519ef1821406ff8fd211d1a4a9abb19bdb94b3adb4f45cd833e0",
  "docs/delegation.md":
    "7009360c6ea13e60e3d0c1a55fb4085cb05fa7c9b5f95a82b98ef4da8bcb327b",
  "docs/incidents.md":
    "074c3b80e20eb0281ae76c17ff83b45ff49fd4e2afa3e7756015918ae9501467",
};

for (const [docPath, approved] of Object.entries(APPROVED_COMPANION_SHA256)) {
  void test(`${docPath} is exactly the approved text`, () => {
    const sha = createHash("sha256")
      .update(companion(docPath), "utf8")
      .digest("hex");
    assert.equal(
      sha,
      approved,
      `${docPath} differs from the approved text: if the change is deliberate, update its hash in APPROVED_COMPANION_SHA256`,
    );
  });
}

void test("the earlier releases' hashes never include today's block", () => {
  assert.equal(
    EARLIER_BLOCK_SHA256.includes(blockHash(templeBarBlock())),
    false,
  );
});

void test("a block still counts as current after git turns its line endings into CRLF", () => {
  const crlf = freshAgentsMd().replace(/\n/g, "\r\n");
  const location = locateTempleBarBlock(crlf);
  assert.equal(location.kind, "found");
  assert.equal(isCurrentBlock(location.block), true);
  assert.deepEqual(withTempleBarBlock(crlf), { kind: "unchanged" });
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
    assert.equal(update.kind, "refused", content);
    assert.match(update.detail, detail);
  }
});
