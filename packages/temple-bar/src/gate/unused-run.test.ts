import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createFakeContext } from "../testing/fakes.ts";
import { runKnip } from "./unused-run.ts";

void test("missing or malformed capture keeps the analyzer result and removes the temporary report", async () => {
  for (const code of [0, 1, 2, 127]) {
    for (const body of [undefined, "bad json", "{}"]) {
      let outputPath = "";
      const ctx = createFakeContext();
      const result = await runKnip(
        {
          ...ctx,
          proc: {
            async run(_command, args, options) {
              const parsed: unknown = JSON.parse(args.at(-1) ?? "null");
              assert.ok(
                typeof parsed === "object" &&
                  parsed !== null &&
                  "outputPath" in parsed &&
                  typeof parsed.outputPath === "string",
              );
              outputPath = parsed.outputPath;
              assert.equal(options.stdout, ctx.stdout);
              assert.equal(options.stderr, ctx.stderr);
              assert.equal(options.cwd, ctx.cwd);
              assert.equal(options.env.CI, "true");
              assert.ok(args.includes("symbols"));
              assert.ok(!args.includes("--preprocessor"));
              if (body !== undefined) await fs.writeFile(outputPath, body);
              return code;
            },
          },
        },
        ["--include", "files,exports,types"],
        "/knip.js",
      );
      assert.deepEqual(result, { code });
      await assert.rejects(fs.stat(path.dirname(outputPath)), {
        code: "ENOENT",
      });
    }
  }
});
