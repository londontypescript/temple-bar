// What the run reports about the machine it ran on. Versions and where each
// tool resolved come from the tools themselves (`node --version`, `where`):
// the account can't use WMI. The paths go to the terminal only; the record
// carries just the versions.

import type { ResultRecord } from "./record.ts";
import type { Sys } from "./sys.ts";

type Versions = ResultRecord["versions"];

function versionIn(output: string | null): string | null {
  const match = output === null ? null : /\d+\.\d+\.\d+/.exec(output);
  return match?.[0] ?? null;
}

export async function reportEnvironment(
  sys: Sys,
  say: (line: string) => void,
): Promise<{ versions: Versions; windows: ResultRecord["windows"] }> {
  const versions: Record<keyof Versions, string | null> = {
    node: null,
    pnpm: null,
    git: null,
  };
  for (const tool of ["node", "pnpm", "git"] as const) {
    const output = await sys.probe(tool, ["--version"]);
    versions[tool] = versionIn(output);
    const where = await sys.where(tool);
    say(
      `windows-run: ${tool} ${versions[tool] ?? "unknown"} at ${where ?? "unknown"}`,
    );
  }
  say(`windows-run: Windows ${sys.osRelease} (${sys.osVersion})`);
  say(`windows-run: temp folder ${sys.tmpdir}`);
  // The record only accepts a plain release and a short plain name.
  const release = /^\d+\.\d+\.\d+$/.test(sys.osRelease) ? sys.osRelease : null;
  const version =
    sys.osVersion.replace(/[^A-Za-z0-9 .()_-]/g, "").slice(0, 60) || "unknown";
  return {
    versions,
    windows: release === null ? null : { release, version },
  };
}
