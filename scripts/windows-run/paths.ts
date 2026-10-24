// Where things are on the Windows machine, as the local side addresses them.
// Relative to the account's home, which is where ssh starts.

/** The runner's folder in the repo, sent whole with its layout kept. */
export const REMOTE_DIR = "scripts/windows-run/remote";

const ROOT = "temple-bar-windows-run";

/** The run's staging folder, in the forward-slash form scp takes. */
export function stagingForScp(runId: string): string {
  return `${ROOT}/incoming/${runId}`;
}

/** The same folder in the backslash form cmd takes. */
export function stagingForCmd(runId: string): string {
  return `${ROOT}\\incoming\\${runId}`;
}

/** The command that starts the runner. cmd is the SSH server's shell: the
 * run id and commit are hex the local side built, and a targeted run's test
 * file has passed the path rule (remote/test-target.ts), which allows only
 * characters cmd reads as plain text. */
export function runnerCommand(
  runId: string,
  sha: string,
  file?: string,
): string[] {
  const entry = `${stagingForCmd(runId)}\\${REMOTE_DIR.replaceAll("/", "\\")}\\main.ts`;
  return ["node", entry, runId, sha, ...(file === undefined ? [] : [file])];
}
