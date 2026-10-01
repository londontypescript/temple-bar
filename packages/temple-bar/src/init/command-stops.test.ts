// `init`'s hard stops: every missing requirement, and every declined or
// impossible repo creation, ends the run before anything is written.

import assert from "node:assert/strict";
import test from "node:test";

import { createFakeFs, createFakeGh, createFakeGit } from "../testing/fakes.ts";
import { makeFixture, runInitFor } from "./testing/command-fixture.ts";

void test("init: a new empty repo with no commits stops safely, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 128, stdout: "", stderr: "unknown revision" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs }, "yes");
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.equal(fixture.hookCalls.calls, 0);
});

void test("init: not a git repo stops with the exact fix, writing nothing", async () => {
  const git = createFakeGit(() => ({
    code: 128,
    stdout: "",
    stderr: "not a repo",
  }));
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /git init/);
  // temple-bar isn't on PATH, so the rerun command must say pnpm exec.
  assert.match(
    fixture.stderr.lines.join(""),
    /`pnpm exec temple-bar init` again/,
  );
});

void test("init: gh not installed stops with the exact fix, writing nothing", async () => {
  const gh = createFakeGh((args) =>
    args[0] === "--version"
      ? { code: null, stdout: "", stderr: "", notFound: true }
      : { code: 0, stdout: "", stderr: "", notFound: false },
  );
  const fs = createFakeFs();
  const fixture = makeFixture({ gh, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /cli\.github\.com/);
});

void test("init: gh not signed in stops with the exact fix, writing nothing", async () => {
  const gh = createFakeGh((args) => {
    if (args[0] === "--version")
      return { code: 0, stdout: "", stderr: "", notFound: false };
    if (args[0] === "auth")
      return { code: 1, stdout: "", stderr: "not logged in", notFound: false };
    return { code: 0, stdout: "", stderr: "", notFound: false };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ gh, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /gh auth login/);
});

void test("init: origin pointing at a non-GitHub host stops with the exact fix, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return {
        code: 0,
        stdout: "https://gitlab.com/acme/widgets\n",
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /doesn't point at GitHub/);
});

void test("init: repo creation declined with 'no' stops, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs }, "no");
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
});

void test("init: repo creation declined because there's no terminal stops, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs }, "no-terminal");
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
});
