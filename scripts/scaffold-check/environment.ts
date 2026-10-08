import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createFakeGh } from "../../e2e/support/fake-gh.ts";

export function environments(
  folder: string,
  inherited: NodeJS.ProcessEnv,
  registry: string,
): {
  readonly scaffolding: NodeJS.ProcessEnv;
  readonly setup: NodeJS.ProcessEnv;
} {
  const base = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !/^(npm_|pnpm_|GIT_|NODE_OPTIONS$)/i.test(key),
    ),
  );
  for (const name of [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    ...(process.platform === "win32"
      ? ["USERPROFILE", "APPDATA", "LOCALAPPDATA"]
      : []),
  ]) {
    const dir = path.join(folder, name.toLowerCase());
    mkdirSync(dir, { recursive: true });
    base[name] = dir;
  }
  const gitConfig = path.join(folder, "gitconfig");
  writeFileSync(gitConfig, "");
  Object.assign(base, {
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Scaffold check",
    GIT_AUTHOR_EMAIL: "scaffold-check@example.invalid",
    GIT_COMMITTER_NAME: "Scaffold check",
    GIT_COMMITTER_EMAIL: "scaffold-check@example.invalid",
  });
  for (const prefix of ["npm_config_", "pnpm_config_"]) {
    base[`${prefix}cache`] = path.join(folder, "npm-cache");
    base[`${prefix}store_dir`] = path.join(folder, "pnpm-store");
    base[`${prefix}cache_dir`] = path.join(folder, "pnpm-cache");
  }
  const scaffolding = {
    ...base,
    npm_config_registry: "https://registry.npmjs.org/",
    pnpm_config_registry: "https://registry.npmjs.org/",
  };
  const setup = {
    ...createFakeGh(folder, base),
    npm_config_registry: registry,
    pnpm_config_registry: registry,
    GIT_SSH_COMMAND: "false",
  };
  return { scaffolding, setup };
}
