// ssh and scp, spawned without a shell, never able to prompt for a password.
// The options make a dead connection noticeable: connecting gives up after 15
// seconds, and a connection that stalls after connecting is dropped within
// about a minute (a probe every 15 seconds, four missed in a row).

import { spawn } from "node:child_process";

import type { Ssh } from "./seams.ts";

const OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=4",
];

/** `--` ends options, so even a host that somehow began with `-` could not be
 * read as one. */
export function sshArgs(host: string, remote: readonly string[]): string[] {
  return [...OPTIONS, "--", host, ...remote];
}

export function scpArgs(
  host: string,
  localPath: string,
  dest: string,
  recursive: boolean,
): string[] {
  return [
    ...OPTIONS,
    ...(recursive ? ["-r"] : []),
    "--",
    localPath,
    `${host}:${dest}`,
  ];
}

function run(
  command: string,
  args: string[],
  onStdout: (chunk: Buffer) => void,
  onStderr: (chunk: Buffer) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", (error) => {
      onStderr(Buffer.from(`${command}: ${error.message}\n`));
      resolve(255);
    });
    child.on("close", (code) => {
      resolve(code ?? 255);
    });
  });
}

export function createSsh(onStderr: (chunk: Buffer) => void): Ssh {
  return {
    exec: (host, remote, onStdout, onErr) =>
      run("ssh", sshArgs(host, remote), onStdout, onErr),
    copy: (host, localPath, dest, recursive) =>
      run(
        "scp",
        scpArgs(host, localPath, dest, recursive),
        () => undefined,
        onStderr,
      ),
  };
}
