import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createFakeContext } from "../testing/fakes.ts";
import { createUnusedReport } from "./testing/unused-report.ts";
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

void test("valid capture passes only at exit 1 when every file qualifies", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "temple-bar-knip-positive-")),
  );
  try {
    const file = path.join(root, "empty.ts");
    await fs.writeFile(file, "// placeholder");
    const evidence = createUnusedReport();
    evidence.issues.files = {
      [file]: { [file]: { type: "files", filePath: file } },
    };
    const invoke = (code: number, body: string) =>
      runKnip(
        {
          ...createFakeContext({ cwd: root }),
          proc: {
            async run(_command, args) {
              const parsed = JSON.parse(args.at(-1) ?? "{}") as {
                outputPath: string;
              };
              await fs.writeFile(parsed.outputPath, body);
              return code;
            },
          },
        },
        [],
        "/knip.js",
      );
    for (const code of [0, 1, 2, 127]) {
      assert.deepEqual(
        await invoke(code, JSON.stringify(evidence)),
        code === 1 ? { code, commentOnlyFiles: [file] } : { code },
      );
    }
    assert.deepEqual(
      await invoke(1, JSON.stringify(evidence) + " ".repeat(8_388_609)),
      { code: 1 },
    );
    const other = path.join(root, "code.ts");
    await fs.writeFile(other, "export {};");
    evidence.issues.files[other] = {
      [other]: { type: "files", filePath: other },
    };
    evidence.counters.files = 2;
    assert.deepEqual(await invoke(1, JSON.stringify(evidence)), { code: 1 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
