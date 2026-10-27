// A leg's part reports, made by running every part of a fake workspace for
// real (through the gate's own --part), for the verifier's tests to accept
// or spoil. Not shipped: the build tsconfig excludes every `testing/`
// folder.

import path from "node:path";

import {
  ACTIONS_ENV,
  createFakePartFiles,
  partArgs,
  REPORTS,
  reportFile,
  runGate,
  withHead,
  type FakePartFiles,
} from "./parts-fixture.ts";
import { workspace, type WorkspaceOptions } from "./workspace-fixture.ts";
import type { FakeWriter } from "../../testing/fakes.ts";

/** The parts of the default fake workspace. */
export const PARTS = ["repo", "root", "packages/a", "packages/b"];

export interface Verifying {
  readonly files: FakePartFiles;
  /** Runs `gate --verify-parts` over the reports, in a fresh copy of the
   * workspace. */
  readonly verify: (
    leg?: string,
  ) => Promise<{ code: number; stdout: FakeWriter; stderr: FakeWriter }>;
}

/** Every part run to its report, each in its own fresh copy of the
 * workspace, as CI's separate jobs would. */
export async function everyPartReported(
  options: WorkspaceOptions = {},
): Promise<Verifying> {
  const files = createFakePartFiles();
  const fresh = () => {
    const made = workspace({ env: ACTIONS_ENV, ...options });
    return { ...made, ctx: withHead(made.ctx) };
  };
  for (const part of PARTS) {
    const code = await runGate(
      fresh().ctx,
      files,
      partArgs(part, reportFile(part)),
    );
    if (code !== 0) {
      throw new Error(`part ${part} exited ${String(code)}`);
    }
  }
  return {
    files,
    async verify(leg = "windows") {
      const { ctx, stdout, stderr } = fresh();
      const code = await runGate(ctx, files, [
        "--verify-parts",
        REPORTS,
        "--leg",
        leg,
      ]);
      return { code, stdout, stderr };
    },
  };
}

/** The report at `file` in the reports' folder, parsed for editing. */
export function readJson(
  files: FakePartFiles,
  file: string,
): Record<string, unknown> {
  const text = files.entries.get(path.join(REPORTS, file));
  if (typeof text !== "string") {
    throw new Error(`no report at ${file}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Replaces the report at `file` with `report`. */
export function writeJson(
  files: FakePartFiles,
  file: string,
  report: unknown,
): void {
  files.entries.set(path.join(REPORTS, file), JSON.stringify(report));
}

/** Edits the report at `file` in place. */
export function edit(
  files: FakePartFiles,
  file: string,
  change: (report: Record<string, unknown>) => void,
): void {
  const report = readJson(files, file);
  change(report);
  writeJson(files, file, report);
}
