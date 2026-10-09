// Capture only what the public reporter exposes; keep native diagnostics.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Context } from "../context.ts";
import { reportedFilePaths } from "./unused-evidence.ts";
import { isCommentOnlyFile } from "./unused-read.ts";
import { unusedReporterPath } from "./unused-reporter.ts";

export interface KnipResult {
  readonly code: number;
  readonly commentOnlyFiles?: readonly string[];
}

export async function runKnip(
  ctx: Context,
  args: readonly string[],
  bin: string,
): Promise<KnipResult> {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "temple-bar-knip-"));
  const outputPath = path.join(folder, "report.json");
  try {
    const code = await ctx.proc.run(
      process.execPath,
      [
        bin,
        ...args,
        "--reporter",
        unusedReporterPath(),
        "--reporter",
        "symbols",
        "--reporter-options",
        JSON.stringify({ outputPath }),
      ],
      {
        cwd: ctx.cwd,
        env: { ...ctx.env, CI: "true" },
        stdout: ctx.stdout,
        stderr: ctx.stderr,
      },
    );
    if (code !== 1) return { code };
    try {
      if ((await fs.stat(outputPath)).size > 8_388_608) return { code };
      const evidence: unknown = JSON.parse(
        await fs.readFile(outputPath, "utf8"),
      );
      const files = reportedFilePaths(evidence);
      if (files !== undefined) {
        for (const file of files) {
          const eligible = await isCommentOnlyFile(ctx.cwd, file);
          if (!eligible) return { code };
        }
        return { code, commentOnlyFiles: files };
      }
    } catch {
      // A missing, unreadable or malformed report cannot turn failure to pass.
    }
    return { code };
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}
