import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
  type FakeGit,
} from "../testing/fakes.ts";
import type { GitResult } from "../seams/git.ts";
import { setupWriteTargets, WriteTargets } from "./write-target.ts";

const ENDED = /used after their batch ended/;

const indexReads = (git: FakeGit): number =>
  git.calls.filter((call) => call.args[0] === "ls-files").length;

void test("setup batch: inspections through a batch's view share one index read; outside a batch each reads", async () => {
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  await targets.batch(async (batched) => {
    await batched.inspect("AGENTS.md");
    await batched.writeText("docs/conventions.md", "rules\n");
    await batched.readText(".gitignore");
  });
  assert.equal(indexReads(git), 1);
  await targets.inspect("AGENTS.md");
  await targets.inspect("AGENTS.md");
  assert.equal(indexReads(git), 3);
});

void test("setup batch: inspections racing through one view share the read in flight", async () => {
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  await targets.batch((batched) =>
    Promise.all([
      batched.inspect("AGENTS.md"),
      batched.inspect(".gitignore"),
      batched.writeText("docs/conventions.md", "rules\n"),
    ]),
  );
  assert.equal(indexReads(git), 1);
});

void test("setup batch: a batch that throws after reading drops its read, and the next batch reads again", async () => {
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  const views: WriteTargets[] = [];
  await assert.rejects(
    targets.batch(async (batched) => {
      views.push(batched);
      await batched.inspect("AGENTS.md");
      throw new Error("stopped mid-batch");
    }),
    /stopped mid-batch/,
  );
  assert.equal(indexReads(git), 1);
  const [view] = views;
  assert.ok(view);
  await assert.rejects(view.inspect("AGENTS.md"), ENDED);
  await targets.batch(async (batched) => {
    await batched.inspect("AGENTS.md");
    await batched.inspect(".gitignore");
  });
  assert.equal(indexReads(git), 2);
});

void test("setup batch: a failed index read is not kept, so the view's next inspection reads again", async () => {
  let fail = true;
  const git = createFakeGit((): GitResult => {
    if (!fail) return { code: 0, stdout: "", stderr: "" };
    fail = false;
    return { code: 128, stdout: "", stderr: "index.lock exists" };
  });
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  await targets.batch(async (batched) => {
    await assert.rejects(batched.inspect("AGENTS.md"), /index\.lock exists/);
    assert.equal((await batched.inspect("AGENTS.md")).kind, "missing");
    await batched.inspect(".gitignore");
  });
  assert.equal(indexReads(git), 2);
});

void test("setup batch: a view refuses every use once its batch has ended", async () => {
  const fs = createFakeFs({ "/repo/.gitignore": "keep\n" });
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ fs, git }), "/repo");
  const views: WriteTargets[] = [];
  await targets.batch((batched) => {
    views.push(batched);
    return Promise.resolve();
  });
  const [view] = views;
  assert.ok(view);
  await assert.rejects(view.inspect(".gitignore"), ENDED);
  await assert.rejects(view.readText(".gitignore"), ENDED);
  await assert.rejects(view.writeText(".gitignore", "changed\n"), ENDED);
  await assert.rejects(view.chmod(".gitignore", 0o644), ENDED);
  await assert.rejects(
    view.batch(() => Promise.resolve()),
    ENDED,
  );
  assert.equal(indexReads(git), 0);
  assert.deepEqual(fs.writes, []);
});

/** Lets every pending promise callback run, so a test can tell an operation
 * that is waiting on a fake from one that has finished. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

void test("setup batch: an operation waiting on the index read when the callback settles fails before it touches the disk", async () => {
  const index = Promise.withResolvers<GitResult>();
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs, git: { run: () => index.promise } });
  const targets = setupWriteTargets(ctx, "/repo");
  const escaped: Promise<unknown>[] = [];
  const batch = targets.batch((batched) => {
    escaped.push(batched.writeText("AGENTS.md", "late\n"));
    escaped.push(batched.inspect(".gitignore"));
    return Promise.resolve();
  });
  await settle();
  index.resolve({ code: 0, stdout: "", stderr: "" });
  await batch;
  const [write, inspection] = escaped;
  assert.ok(write && inspection);
  await assert.rejects(write, ENDED);
  await assert.rejects(inspection, ENDED, "no answer from a stale read");
  assert.deepEqual(fs.writes, []);
  assert.deepEqual([...fs.directories], []);
});

void test("setup batch: an inspection paused on the disk when the callback settles finishes before the batch returns", async () => {
  const fs = createFakeFs();
  const probing = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const classify = fs.classify.bind(fs);
  fs.classify = async (file) => {
    probing.resolve(undefined);
    await release.promise;
    return classify(file);
  };
  const targets = setupWriteTargets(createFakeContext({ fs }), "/repo");
  const order: string[] = [];
  const batch = targets
    .batch(async (batched) => {
      void batched
        .inspect("docs/conventions.md")
        .then(() => order.push("inspection"));
      await probing.promise;
    })
    .then(() => order.push("batch"));
  await probing.promise;
  await settle();
  assert.deepEqual(
    order,
    [],
    "the batch returned while an inspection through its view was still running",
  );
  release.resolve(undefined);
  await batch;
  assert.deepEqual(order, ["inspection", "batch"]);
});

void test("setup batch: a write paused on the disk when the callback settles finishes before the batch returns", async () => {
  const fs = createFakeFs();
  const writing = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const write = fs.writeText.bind(fs);
  fs.writeText = async (file, content) => {
    writing.resolve(undefined);
    await release.promise;
    return write(file, content);
  };
  const targets = setupWriteTargets(createFakeContext({ fs }), "/repo");
  const order: string[] = [];
  const batch = targets
    .batch(async (batched) => {
      void batched
        .writeText("AGENTS.md", "rules\n")
        .then(() => order.push("write"));
      await writing.promise;
    })
    .then(() => order.push("batch"));
  await writing.promise;
  await settle();
  assert.deepEqual(
    order,
    [],
    "the batch returned while a write through its view was still running",
  );
  release.resolve(undefined);
  await batch;
  assert.deepEqual(order, ["write", "batch"]);
  assert.equal(fs.files.get("/repo/AGENTS.md"), "rules\n");
});

void test("setup batch: an operation started after the callback settles is refused, even while the batch waits", async () => {
  const fs = createFakeFs({ "/repo/.gitignore": "keep\n" });
  const writing = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const write = fs.writeText.bind(fs);
  fs.writeText = async (file, content) => {
    writing.resolve(undefined);
    await release.promise;
    return write(file, content);
  };
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ fs, git }), "/repo");
  const views: WriteTargets[] = [];
  const batch = targets.batch(async (batched) => {
    views.push(batched);
    void batched.writeText("AGENTS.md", "rules\n");
    await writing.promise;
  });
  await writing.promise;
  await settle();
  const [view] = views;
  assert.ok(view);
  await assert.rejects(
    view.readText(".gitignore"),
    ENDED,
    "an operation started after the callback settled was let through",
  );
  release.resolve(undefined);
  await batch;
  assert.equal(indexReads(git), 1, "the refused operation read nothing");
});

void test("setup batch: overlapping batches on one object each read for themselves", async () => {
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  const both = Promise.withResolvers<undefined>();
  let started = 0;
  const batch = () =>
    targets.batch(async (batched) => {
      await batched.inspect("AGENTS.md");
      // Neither batch ends until both have read, so they overlap.
      if (++started === 2) both.resolve(undefined);
      await both.promise;
      await batched.inspect(".gitignore");
    });
  await Promise.all([batch(), batch()]);
  assert.equal(indexReads(git), 2);
});

void test("setup batch: an inspection on the original object during a batch reads afresh", async () => {
  let link = false;
  const git = createFakeGit((): GitResult => ({
    code: 0,
    stdout: link ? "120000 aaaa 0\tAGENTS.md\0" : "",
    stderr: "",
  }));
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  await targets.batch(async (batched) => {
    assert.equal((await batched.inspect("AGENTS.md")).kind, "missing");
    link = true;
    const fresh = await targets.inspect("AGENTS.md");
    assert.equal(fresh.kind, "refused", "the original read the index again");
    assert.equal(indexReads(git), 2);
  });
});

void test("setup batch: a batch can't start inside another", async () => {
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  await targets.batch(async (batched) => {
    await assert.rejects(
      batched.batch(() => Promise.resolve()),
      /can't start inside another/,
    );
  });
});

void test("setup batch: a refusal found through a view is the original's, and reported once", async () => {
  const fs = createFakeFs();
  fs.linkTargets.set("/repo/AGENTS.md", "elsewhere");
  const stderr = createFakeWriter();
  const targets = setupWriteTargets(createFakeContext({ fs, stderr }), "/repo");
  await targets.batch(async (batched) => {
    assert.equal(await batched.writeText("AGENTS.md", "rules\n"), false);
  });
  assert.equal(targets.refusals.get("AGENTS.md")?.reason, "is a symlink");
  await targets.batch(async (batched) => {
    await batched.inspect("AGENTS.md");
  });
  await targets.inspect("AGENTS.md");
  assert.equal(
    stderr.lines.filter((line) => line.startsWith("AGENTS.md ")).length,
    1,
  );
});

void test("setup batch: the hooks' targets read no index, in a batch or out", async () => {
  const git = createFakeGit();
  const fs = createFakeFs();
  const targets = new WriteTargets(
    createFakeContext({ fs, git }),
    "/repo/.git",
  );
  await targets.batch(async (batched) => {
    assert.equal(
      await batched.writeText("hooks/pre-commit", "#!/bin/sh\n"),
      true,
    );
    assert.equal(await batched.chmod("hooks/pre-commit", 0o755), true);
  });
  assert.equal(await targets.readText("hooks/pre-commit"), "#!/bin/sh\n");
  assert.deepEqual(git.calls, []);
});
