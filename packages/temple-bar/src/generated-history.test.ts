import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EARLIER_OUTPUT_HASHES,
  isEarlierOutput,
  outputHash,
} from "./generated-history.ts";
import { INSTALLED_SHIMS } from "./gate/core.ts";
import { CHECKED_WORKFLOWS } from "./init/workflows.ts";
import { JUDGE_WORKFLOW_PATH, judgeWorkflow } from "./judge/workflow.ts";
import {
  PUBLISHED_OUTPUTS,
  PUBLISHED_RELEASES,
  publishedOutput,
} from "./testing/published-output.ts";

const current: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(INSTALLED_SHIMS).map(([name, content]) => [
      `hooks/${name}`,
      content,
    ]),
  ),
  [JUDGE_WORKFLOW_PATH]: judgeWorkflow(),
  ...Object.fromEntries(
    CHECKED_WORKFLOWS.map((workflow) => [workflow.path, workflow.content]),
  ),
};

void test("published output baseline: every distinct released artifact is current or registered for upgrade", () => {
  for (const output of PUBLISHED_OUTPUTS) {
    const content = publishedOutput(output);
    assert.equal(
      outputHash(output.item, content),
      output.sha256,
      `${output.file}: frozen published bytes changed`,
    );
    assert.ok(
      output.releases.every((version) =>
        PUBLISHED_RELEASES.some((release) => release.version === version),
      ),
      "published output has release provenance",
    );
    assert.ok(
      content === current[output.item] || isEarlierOutput(output.item, content),
      `${output.item} from ${output.releases.join(", ")}: published output is neither current nor registered; record the previous published hash before changing a template`,
    );
  }
  for (const [item, hashes] of Object.entries(EARLIER_OUTPUT_HASHES)) {
    assert.equal(
      new Set(hashes).size,
      hashes.length,
      `${item}: deduplicate history`,
    );
    for (const hash of hashes) {
      assert.ok(
        PUBLISHED_OUTPUTS.some(
          (output) => output.item === item && output.sha256 === hash,
        ),
        `${item}: ${hash} has no frozen published provenance`,
      );
    }
  }
});

void test("historical ownership: hooks are byte-exact; workflows normalize only CRLF", () => {
  const hook = PUBLISHED_OUTPUTS.find(
    (output) => output.item === "hooks/pre-commit",
  );
  const workflow = PUBLISHED_OUTPUTS.find(
    (output) => output.item === JUDGE_WORKFLOW_PATH,
  );
  assert.ok(hook && workflow);
  const oldHook = publishedOutput(hook);
  const oldWorkflow = publishedOutput(workflow);
  assert.equal(isEarlierOutput(hook.item, oldHook), true);
  assert.equal(
    isEarlierOutput(hook.item, oldHook.replaceAll("\n", "\r\n")),
    false,
  );
  assert.equal(
    isEarlierOutput(workflow.item, oldWorkflow.replaceAll("\n", "\r\n")),
    true,
  );
  for (const changed of [
    oldWorkflow.slice(0, -1),
    `${oldWorkflow} `,
    oldWorkflow.replaceAll("\n", "\r"),
  ]) {
    assert.equal(
      isEarlierOutput(workflow.item, changed),
      false,
      "whitespace and lone CR do not prove ownership",
    );
  }
});

void test("published output baseline: reachable earlier release tags have fresh frozen provenance", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const git = (args: readonly string[]) =>
    execFileSync("git", [...args], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(
    git(["rev-parse", "--is-shallow-repository"]),
    "false",
    "published output baseline needs full Git history; fetch --unshallow --tags before running the suite",
  );
  const head = git(["rev-parse", "HEAD"]);
  const manifest = JSON.parse(
    readFileSync(path.join(root, "packages/temple-bar/package.json"), "utf8"),
  ) as { version: string };
  const tags = git(["tag", "--list", "v*", "--merged", "HEAD"])
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  assert.ok(
    tags.length > 0,
    "published output baseline needs release tags; fetch the repository's full history before running its suite",
  );
  for (const release of PUBLISHED_RELEASES) {
    assert.ok(
      tags.includes(`v${release.version}`),
      `v${release.version}: published output baseline needs release tags; fetch --tags before running the suite`,
    );
  }
  for (const tag of tags) {
    const commit = git(["rev-parse", `${tag}^{commit}`]);
    // Release CI runs on the newly tagged commit before npm publishes it.
    // Later commits must freeze that release too, even when package.json's
    // version has not yet changed: version text alone cannot prove freshness.
    if (
      commit === head &&
      tag === `v${manifest.version}` &&
      process.env.GITHUB_REF === `refs/tags/${tag}`
    )
      continue;
    const release = PUBLISHED_RELEASES.find(
      (release) => release.version === tag.slice(1),
    );
    assert.ok(
      release,
      `${tag}: refresh the frozen published-output baseline from its integrity-verified npm package before changing templates`,
    );
    assert.equal(
      release.tagCommit,
      commit,
      `${tag}: frozen tag provenance must name the tagged release commit`,
    );
    assert.ok(
      release.artifacts.length > 0,
      `${tag}: record the published artifact inventory`,
    );
    for (const item of release.artifacts) {
      assert.ok(
        PUBLISHED_OUTPUTS.some(
          (output) =>
            output.item === item && output.releases.includes(release.version),
        ),
        `${tag} ${item}: refresh the frozen published artifact, not only its release metadata`,
      );
    }
  }
});
