// Break the content exception through the installed artifact, not source APIs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, run, type RunOptions } from "./run.ts";

export async function probeUnusedFiles(options: RunOptions): Promise<void> {
  const file = path.join(options.cwd, "src/lib/index.ts");
  const route = path.join(options.cwd, "src/routes/+page.svelte");
  const original = readFileSync(file, "utf8");
  const originalRoute = readFileSync(route, "utf8");
  const gate = () => run("pnpm", ["run", "gate"], options);
  const config = path.join(options.cwd, "knip.json");
  const processor = path.join(options.cwd, "processor.mjs");
  try {
    // A caller's configured preprocessor still runs; its native hint stays visible.
    writeFileSync(
      processor,
      `import { writeFileSync } from 'node:fs';
export default data => { writeFileSync('processor-ran', 'yes'); return data; };
`,
    );
    writeFileSync(
      config,
      JSON.stringify({ preprocessor: ["./processor.mjs"] }),
    );
    const configured = await gate();
    assert.ok(
      existsSync(path.join(options.cwd, "processor-ran")),
      describe(configured),
    );
    assert.match(configured.stdout, /accepted 1 comment-only unused file/);
    assert.match(
      configured.stdout + configured.stderr,
      /passed +unused code \(knip\)/,
    );
    assert.match(configured.stderr, /Package entry file not found/);
    rmSync(config);
    rmSync(processor);
    rmSync(path.join(options.cwd, "processor-ran"));
    for (const contents of [
      "export const unused = 1;\n",
      "/** @typedef {string} Name */\n",
      "// @ts-nocheck\n",
      "export {};\n",
      "'/* string */';\n",
      "/// <reference types='node' />\n",
      "/* unterminated",
    ]) {
      writeFileSync(file, contents);
      const result = await gate();
      assert.match(
        result.stderr,
        /failed +unused code \(knip\)/,
        describe(result),
      );
      assert.doesNotMatch(
        result.stdout,
        /accepted .*comment-only/,
        describe(result),
      );
    }
    writeFileSync(file, "export const used = 1;\n");
    writeFileSync(
      path.join(options.cwd, "src/lib/helper.ts"),
      "export const helper = 2;\nexport const unusedHelper = 3;\nexport type UnusedType = string;\n",
    );
    writeFileSync(
      path.join(options.cwd, "src/lib/unreachable.ts"),
      "export const dead = 4;\n",
    );
    writeFileSync(
      route,
      `<script lang="ts">import {used} from '#lib';import {helper} from '#lib/helper.ts';</script>\n<p>{used + helper}</p>\n`,
    );
    writeFileSync(
      path.join(options.cwd, "src/lib/placeholder.ts"),
      "// unrelated empty file\n",
    );
    const negative = await gate();
    assert.match(
      negative.stderr,
      /failed +unused code \(knip\)/,
      describe(negative),
    );
    for (const expected of [/unreachable\.ts/, /unusedHelper/, /UnusedType/])
      assert.match(negative.stdout, expected, describe(negative));
    assert.doesNotMatch(negative.stdout, /accepted .*comment-only/);
    writeFileSync(config, "malformed config");
    const broken = await gate();
    assert.match(broken.stderr, /could not run/, describe(broken));
    assert.doesNotMatch(broken.stdout, /accepted .*comment-only/);
  } finally {
    writeFileSync(file, original);
    writeFileSync(route, originalRoute);
    for (const relative of [
      "src/lib/helper.ts",
      "src/lib/unreachable.ts",
      "src/lib/placeholder.ts",
      "knip.json",
      "processor.mjs",
      "processor-ran",
    ])
      rmSync(path.join(options.cwd, relative), { force: true });
  }
}
