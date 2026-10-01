import assert from "node:assert/strict";
import test from "node:test";

import { fetchHeadUrlForm, parseFetchHead } from "./fetch-head.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

void test("FETCH_HEAD: parses branch lines, for merge or not, and skips tags", () => {
  const text =
    `${SHA_A}\t\tbranch 'main' of github.com:org/repo\n` +
    `${SHA_B}\tnot-for-merge\tbranch 'feature/x' of github.com:org/repo\n` +
    `${SHA_C}\tnot-for-merge\ttag 'v1.0.0' of github.com:org/repo\n`;

  assert.deepEqual(parseFetchHead(text), [
    { sha: SHA_A, branch: "main", url: "github.com:org/repo" },
    { sha: SHA_B, branch: "feature/x", url: "github.com:org/repo" },
  ]);
});

void test("FETCH_HEAD: a remote URL is put in the form git writes there", () => {
  // Trailing slashes and `.git` go.
  assert.equal(
    fetchHeadUrlForm("https://github.com/org/repo.git"),
    "https://github.com/org/repo",
  );
  assert.equal(
    fetchHeadUrlForm("https://github.com/org/repo/"),
    "https://github.com/org/repo",
  );
  assert.equal(fetchHeadUrlForm("/tmp/x/origin.git\n"), "/tmp/x/origin");
  // Credentials go, for scheme URLs and scp-like ones.
  assert.equal(
    fetchHeadUrlForm("https://user:token@github.com/org/repo.git"),
    "https://github.com/org/repo",
  );
  assert.equal(
    fetchHeadUrlForm("git@github.com:org/repo.git"),
    "github.com:org/repo",
  );
  // An `@` in a local path or a URL's path is not a credential.
  assert.equal(fetchHeadUrlForm("/tmp/a@b/repo.git"), "/tmp/a@b/repo");
  assert.equal(
    fetchHeadUrlForm("https://host/org/a@b.git"),
    "https://host/org/a@b",
  );
});
