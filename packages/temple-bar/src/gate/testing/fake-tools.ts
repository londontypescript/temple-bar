// Stand-ins for the npm tools the gate runs, for tests that are about
// something else (the scripts, the length cap, the ruleset): each tool
// passes and records what it was asked to check. The tools' own checks have
// their own tests, which run the real tools. Not shipped: the build
// tsconfig excludes every `testing/` folder.

import type { CommandEntry } from "../../registry.ts";
import { createGateCommand } from "../command.ts";
import type { GateTools } from "../tools.ts";

export interface FakeTools extends GateTools {
  /** The file lists markdownlint was given, one per run. */
  readonly linted: (readonly string[])[];
}

export function createFakeTools(
  exitCodes: { readonly markdownlint?: number } = {},
): FakeTools {
  const linted: (readonly string[])[] = [];
  return {
    linted,
    markdownlint(_ctx, files) {
      linted.push(files);
      return Promise.resolve(exitCodes.markdownlint ?? 0);
    },
  };
}

/** The gate with every npm tool passing. */
export const testGateCommand: CommandEntry =
  createGateCommand(createFakeTools());
