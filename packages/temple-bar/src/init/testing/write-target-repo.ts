// Real disk and index, with only GitHub and the remote default-branch lookup
// faked. The outside target is outside the test repo, inside its temp folder.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRealContext } from "../../context.ts";
import { installHooks } from "../../hooks/install.ts";
import { createGitSeam } from "../../seams/git.ts";
import { createFakeGh, createFakeWriter } from "../../testing/fakes.ts";
import { initTestRepo } from "../../testing/git-repo.ts";
import { createInitCommand } from "../command.ts";
import { defaultGhScript, PNPM_USER_AGENT } from "./command-fixture.ts";

export function writeTargetRepo() {
  const base = mkdtempSync(path.join(tmpdir(), "temple-bar-write-target-"));
  const root = path.join(base, "repo");
  const outside = path.join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  initTestRepo(root);
  const git = (args: readonly string[], input?: string) =>
    execFileSync("git", [...args], {
      cwd: root,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  git(["remote", "add", "origin", "git@github.com:acme/widgets.git"]);
  const realGit = createGitSeam();
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = {
    ...createRealContext(),
    cwd: root,
    stdout,
    stderr,
    env: { ...process.env, npm_config_user_agent: PNPM_USER_AGENT },
    gh: createFakeGh(defaultGhScript),
    git: {
      run: (args: readonly string[], cwd: string) =>
        args[0] === "remote" && args[1] === "set-head"
          ? Promise.resolve({
              code: 1,
              stdout: "",
              stderr: "remote lookup disabled in test",
            })
          : realGit.run(args, cwd),
    },
  };
  return {
    base,
    root,
    outside,
    ctx,
    git,
    stdout,
    stderr,
    run: () => createInitCommand({ installHooks }).run([], ctx),
    cleanup: () => {
      rmSync(base, { recursive: true, force: true });
    },
    stageLink(relative: string, target: string) {
      git(["config", "core.symlinks", "false"]);
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, target);
      const oid = git(["hash-object", "-w", "--stdin"], target).trim();
      git([
        "update-index",
        "--add",
        "--cacheinfo",
        `120000,${oid},${relative}`,
      ]);
      return oid;
    },
  };
}

export function realLink(target: string, file: string, folder = false): void {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    symlinkSync(
      target,
      file,
      folder ? (process.platform === "win32" ? "junction" : "dir") : "file",
    );
  } catch (cause) {
    throw new Error(
      `Real ${folder ? "folder" : "file"} symlink required for target-preservation proof; the OS refused ${file}`,
      { cause },
    );
  }
}
