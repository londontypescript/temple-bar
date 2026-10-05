import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReleaseNotes } from "./release-notes.ts";
import {
  publishWhenDownloadable,
  RETRY_MS,
  tarballUrl,
  WAIT_MS,
  type PublishDeps,
} from "./release-publish.ts";

const NAMES = [
  "@londontypescript/temple-bar",
  "@londontypescript/create-temple-bar",
];
const TB =
  "https://registry.npmjs.org/@londontypescript/temple-bar/-/temple-bar-0.0.7.tgz";
const CTB =
  "https://registry.npmjs.org/@londontypescript/create-temple-bar/-/create-temple-bar-0.0.7.tgz";

/** Notes the maintainer has finished: both hand-written sections filled in
 * and the reminder deleted. */
const FINISHED = [
  "## Fixes",
  "",
  "- **gate:** report a missing config file (#31)",
  "",
  "## Upgrading",
  "",
  "None",
  "",
  "## Incidents",
  "",
  "- A Release was published with its notes unfinished (#223)",
  "",
].join("\n");

/** A fake world: a clock that moves only when the script sleeps, a registry
 * whose answers the test chooses, and a GitHub that holds one Release (or
 * none) and records publishes. */
function fakes(
  statusAt: (url: string, elapsedMs: number) => number,
  draft: boolean | undefined,
  body: string = FINISHED,
) {
  let clock = 0;
  const published: string[] = [];
  const downloads: string[] = [];
  const lines: string[] = [];
  const deps: PublishDeps = {
    download: (url) => {
      downloads.push(url);
      return Promise.resolve(statusAt(url, clock));
    },
    viewRelease: () =>
      draft === undefined ? undefined : { isDraft: draft, body },
    publishRelease: (tag) => {
      published.push(tag);
    },
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    log: (line) => {
      lines.push(line);
    },
  };
  return { deps, published, downloads, lines, elapsed: () => clock };
}

const options = { tag: "v0.0.7", packageNames: NAMES, dryRun: false };

void test("builds the package file address from the name and version", () => {
  assert.equal(tarballUrl(NAMES[0] ?? "", "0.0.7"), TB);
  assert.equal(
    tarballUrl("plain", "1.2.3"),
    "https://registry.npmjs.org/plain/-/plain-1.2.3.tgz",
  );
});

void test("publishes the draft once both package files download", async () => {
  const world = fakes(() => 200, true);
  assert.equal(await publishWhenDownloadable(options, world.deps), 0);
  assert.deepEqual(world.published, ["v0.0.7"]);
  assert.deepEqual(world.downloads, [TB, CTB]);
});

void test("waits while one file is missing, then publishes when it appears", async () => {
  // The second package's file appears two minutes in, as npm's did for 0.0.4.
  const world = fakes(
    (url, elapsed) => (url === CTB && elapsed < 2 * 60 * 1000 ? 404 : 200),
    true,
  );
  assert.equal(await publishWhenDownloadable(options, world.deps), 0);
  assert.equal(
    world.elapsed(),
    2 * 60 * 1000,
    "it must keep asking until the missing file downloads, not publish at once",
  );
  assert.deepEqual(world.published, ["v0.0.7"]);
  assert.match(
    world.lines[0] ?? "",
    /Waiting for npm to serve: .*create-temple-bar-0\.0\.7\.tgz \(HTTP 404\)/,
  );
});

void test("waits a few minutes, then refuses and leaves the draft alone", async () => {
  const world = fakes((url) => (url === TB ? 200 : 404), true);
  const code = await publishWhenDownloadable(options, world.deps);
  assert.deepEqual(
    world.published,
    [],
    "the Release must stay a draft while a package file doesn't download",
  );
  assert.equal(code, 1, "a missing package file must end in a refusal");
  assert.ok(world.elapsed() >= WAIT_MS, "it gave npm the full wait");
  assert.ok(world.elapsed() < WAIT_MS + RETRY_MS, "and no longer");
  const refusal = world.lines.at(-1) ?? "";
  assert.match(
    refusal,
    /^Not published: npm still doesn't serve these files after 5 minutes:/,
  );
  assert.match(refusal, /create-temple-bar-0\.0\.7\.tgz \(HTTP 404\)/);
  assert.doesNotMatch(refusal, /\/temple-bar-0\.0\.7\.tgz/);
  assert.match(
    refusal,
    /approved on npm .* then run this again for v0\.0\.7\.$/,
  );
});

void test("treats a failed request like a missing file", async () => {
  const world = fakes(() => 0, true);
  assert.equal(
    await publishWhenDownloadable(options, world.deps),
    1,
    "a request that fails must count as a file that isn't there",
  );
  assert.match(world.lines.at(-1) ?? "", /\(no response\)/);
});

void test("refuses when there is no draft to publish", async () => {
  const none = fakes(() => 200, undefined);
  assert.equal(await publishWhenDownloadable(options, none.deps), 1);
  assert.match(none.lines[0] ?? "", /^No GitHub Release exists for v0\.0\.7\./);

  const done = fakes(() => 200, false);
  assert.equal(await publishWhenDownloadable(options, done.deps), 1);
  assert.match(done.lines[0] ?? "", /already published/);

  assert.deepEqual([...none.published, ...done.published], []);
  assert.deepEqual([...none.downloads, ...done.downloads], []);
});

void test("a dry run checks the downloads but never publishes", async () => {
  const world = fakes(() => 200, false);
  assert.equal(
    await publishWhenDownloadable({ ...options, dryRun: true }, world.deps),
    0,
  );
  assert.deepEqual(world.published, []);
  assert.deepEqual(world.downloads, [TB, CTB]);
  assert.match(
    world.lines.at(-1) ?? "",
    /Dry run: the GitHub Release was left as it is\.$/,
  );
});

void test("refuses a draft still holding the generated reminder and empty sections", async () => {
  // Exactly what the release workflow drafts, as 0.0.7 was published.
  const world = fakes(() => 200, true, buildReleaseNotes(["fix: x"]));
  assert.equal(
    await publishWhenDownloadable(options, world.deps),
    1,
    "a draft with unfinished notes must be refused",
  );
  assert.deepEqual(world.published, [], "unfinished notes must stay a draft");
  assert.deepEqual(world.downloads, [], "it refuses before waiting on npm");
  const refusal = world.lines.at(-1) ?? "";
  assert.match(
    refusal,
    /^Not published: the draft notes for v0\.0\.7 aren't finished:/,
  );
  assert.match(refusal, /reminder comment is still in the notes/);
  assert.match(refusal, /"## Upgrading" section is empty\. .*"None"/);
  assert.match(refusal, /"## Incidents" section is empty\. .*"None"/);
  assert.match(refusal, /gh release edit v0\.0\.7 .*then run this again\.$/);
});

void test("refuses while only the reminder is left, and names only that", async () => {
  const body = `${FINISHED}\n<!-- Add upgrade notes and the incidents this release fixes before publishing. -->\n`;
  const world = fakes(() => 200, true, body);
  assert.equal(
    await publishWhenDownloadable(options, world.deps),
    1,
    "a draft with unfinished notes must be refused",
  );
  assert.deepEqual(world.published, []);
  const refusal = world.lines.at(-1) ?? "";
  assert.match(refusal, /reminder comment is still in the notes/);
  assert.doesNotMatch(refusal, /section is empty|heading is missing/);
});

void test("refuses a section that is empty or holds only a comment", async () => {
  const body = FINISHED.replace("None", "<!-- todo -->");
  const world = fakes(() => 200, true, body);
  assert.equal(
    await publishWhenDownloadable(options, world.deps),
    1,
    "a draft with unfinished notes must be refused",
  );
  const refusal = world.lines.at(-1) ?? "";
  assert.match(refusal, /"## Upgrading" section is empty/);
  assert.doesNotMatch(refusal, /Incidents|reminder/);
});

void test("refuses a section whose text sits inside an unclosed comment", async () => {
  // GitHub hides everything after an unclosed comment, so this reads as empty.
  const body = FINISHED.replace("None", "<!-- todo\n\nNone");
  const world = fakes(() => 200, true, body);
  assert.equal(
    await publishWhenDownloadable(options, world.deps),
    1,
    "a section hidden by an unclosed comment must be refused",
  );
  assert.match(world.lines.at(-1) ?? "", /"## Upgrading" section is empty/);
});

void test("refuses notes whose heading was deleted", async () => {
  const body = FINISHED.replace("## Incidents\n\n- A Release", "- A Release");
  const world = fakes(() => 200, true, body);
  assert.equal(
    await publishWhenDownloadable(options, world.deps),
    1,
    "a draft with unfinished notes must be refused",
  );
  assert.match(world.lines.at(-1) ?? "", /"## Incidents" heading is missing\./);
});

void test("accepts finished notes saved with Windows line endings", async () => {
  const world = fakes(() => 200, true, FINISHED.replaceAll("\n", "\r\n"));
  assert.equal(await publishWhenDownloadable(options, world.deps), 0);
  assert.deepEqual(world.published, ["v0.0.7"]);
});

void test("keeps subheadings inside their section", async () => {
  const body = FINISHED.replace("None", "### From 0.0.6\n\n- Run setup again.");
  const world = fakes(() => 200, true, body);
  assert.equal(await publishWhenDownloadable(options, world.deps), 0);
});

void test("a dry run also refuses unfinished notes", async () => {
  const world = fakes(() => 200, true, buildReleaseNotes(["fix: x"]));
  assert.equal(
    await publishWhenDownloadable({ ...options, dryRun: true }, world.deps),
    1,
    "a dry run must not call unfinished notes ready",
  );
  assert.match(world.lines.at(-1) ?? "", /^Not published: the draft notes/);
});
