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

/** The command that starts the runner. cmd is the SSH server's shell, and
 * both arguments are hex the local side built, so nothing a person typed
 * reaches it. */
export function runnerCommand(runId: string, sha: string): string[] {
  const entry = `${stagingForCmd(runId)}\\${REMOTE_DIR.replaceAll("/", "\\")}\\main.ts`;
  return ["node", entry, runId, sha];
}
