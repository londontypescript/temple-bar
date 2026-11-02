// Which remote URLs name a repository on github.com: only those, in the
// forms git and gh write, ever let `--remove` delete anything.

import assert from "node:assert/strict";
import test from "node:test";

import { gitHubRepositoryOf, withoutCredentials } from "./repository.ts";

void test("github.com URLs in the forms git and gh write name their repository, in lower case", () => {
  for (const url of [
    "https://github.com/O/r.git",
    "https://github.com/o/r",
    "https://x-access-token:abc@github.com/o/r.git",
    "git@github.com:o/r.git",
    "ssh://git@github.com/o/r.git",
    "ssh://git@github.com:22/o/r",
  ]) {
    assert.equal(gitHubRepositoryOf(url), "o/r", url);
  }
});

void test("anything else names no repository: another host, a local path, a lookalike", () => {
  for (const url of [
    "/tmp/github.com/o/r.git",
    "file:///srv/o/r.git",
    "https://github.com.evil.example/o/r.git",
    "https://gitlab.com/o/r.git",
    "http://github.com/o/r.git",
    "https://github.com/o/r/extra",
    "git@github.com:o/r.git\nhttps://github.com/x/y",
    "",
  ]) {
    assert.equal(gitHubRepositoryOf(url), undefined, url);
  }
});

void test("a URL's user-info is hidden, malformed or not; an scp-like user is left as it is", () => {
  for (const [url, shown] of [
    [
      "https://x-access-token:SECRET@github.com/o/r.git",
      "https://***@github.com/o/r.git",
    ],
    ["https://SECRET@github.com/o/r.git", "https://***@github.com/o/r.git"],
    ["https://a@b:SECRET@example.com/o/r", "https://***@example.com/o/r"],
    [
      "ssh://git:SECRET@github.com:22/o/r.git",
      "ssh://***@github.com:22/o/r.git",
    ],
    ["https://SECRET@host", "https://***@host"],
    ["https://github.com/o/r@v1", "https://github.com/o/r@v1"],
    ["git@github.com:o/r.git", "git@github.com:o/r.git"],
    ["/srv/o/r.git", "/srv/o/r.git"],
  ] as const) {
    assert.equal(withoutCredentials(url), shown, url);
  }
});
