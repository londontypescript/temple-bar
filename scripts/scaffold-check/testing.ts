import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  freshAgentsMd,
  templeBarBlock,
} from "../../packages/temple-bar/src/init/agents-template.ts";
import { COMPANION_FILES } from "../../packages/temple-bar/src/init/companion-docs.ts";
import { INSTALLED_SHIMS } from "../../packages/temple-bar/src/gate/core.ts";
import type { ScaffoldFixture } from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import { expectation, manifest, object, shippedFiles } from "./expectation.ts";
import { recipes } from "./recipes.ts";
import type { PrepareResources } from "./resources.ts";
import type { Command, Runner, RunResult } from "./runner.ts";
import { capture, type Snapshot } from "./snapshot.ts";

export const ok = (output = ""): RunResult => ({
  code: 0,
  output,
  stdout: output,
  timedOut: false,
});

export function writeProject(
  dir: string,
  files: Readonly<Record<string, string>>,
  links: Readonly<Record<string, string>> = {},
): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  for (const [name, target] of Object.entries(links)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    symlinkSync(target, path.join(dir, name));
  }
}

function gitFiles(dir: string): void {
  mkdirSync(path.join(dir, ".git/hooks"), { recursive: true });
  writeFileSync(path.join(dir, ".git/config"), "initial config\n");
}

export const FAKE_REGISTRY = "http://registry.invalid/";

/** Fake output is built independently of the validator's predictions. The
 * lockfile names the packed tarball, as a real install from the local
 * registry does. */
export function install(dir: string, registry = FAKE_REGISTRY): void {
  const pkg =
    manifest(readFileSync(path.join(dir, "package.json"), "utf8")) ?? {};
  const scripts = object(pkg.scripts) ?? {};
  const prepare = scripts.prepare;
  const already =
    typeof prepare === "string" &&
    prepare.trim().endsWith("temple-bar hook install");
  pkg.scripts = {
    ...scripts,
    prepare: already
      ? prepare
      : typeof prepare === "string"
        ? `${prepare.trim()} && temple-bar hook install`
        : "temple-bar hook install",
    gate: "temple-bar gate",
  };
  pkg.devDependencies = {
    ...object(pkg.devDependencies),
    "@londontypescript/temple-bar": "0.0.9",
  };
  if (
    pkg.packageManager === undefined &&
    object(pkg.devEngines)?.packageManager === undefined
  )
    pkg.packageManager = "pnpm@10.34.5";
  const agents = (() => {
    try {
      return readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    } catch {
      return undefined;
    }
  })();
  writeProject(dir, {
    "pnpm-lock.yaml": `importers:\n\n  .:\n    devDependencies:\n      '@londontypescript/temple-bar':\n        specifier: 0.0.9\n        version: 0.0.9\n\npackages:\n\n  '@londontypescript/temple-bar@0.0.9':\n    resolution: {integrity: sha512-fake, tarball: ${registry}tarball.tgz}\n`,
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "AGENTS.md":
      agents === undefined
        ? freshAgentsMd()
        : `${agents}${agents.endsWith("\n") ? "\n" : "\n\n"}${templeBarBlock()}`,
    ...Object.fromEntries(
      shippedFiles.map((file) => [file.path, file.content]),
    ),
    ...Object.fromEntries(
      Object.entries(INSTALLED_SHIMS).map(([name, text]) => [
        `.git/hooks/${name}`,
        text,
      ]),
    ),
  });
  const originalClaude = capture(dir);
  if (!("CLAUDE.md" in originalClaude.symlinks)) {
    const content = originalClaude.files["CLAUDE.md"];
    writeFileSync(
      path.join(dir, "CLAUDE.md"),
      content === undefined
        ? (COMPANION_FILES.find((file) => file.path === "CLAUDE.md")?.content ??
            "")
        : `${content.startsWith("#") ? "" : "# Claude Code\n\n"}${content}${content.endsWith("\n") ? "\n" : "\n\n"}@AGENTS.md\n`,
    );
  }
}

export function tempProject(
  files: Readonly<Record<string, string>>,
  links: Readonly<Record<string, string>> = {},
): { dir: string; snapshot: Snapshot; close(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), "scaffold-check-test-"));
  writeProject(dir, files, links);
  const snapshot = capture(dir);
  gitFiles(dir);
  return {
    dir,
    snapshot,
    close: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const minimalFiles = {
  "package.json":
    '{\n\t"name": "app",\n\t"scripts": {"lint": "lint-tool"},\n\t"custom": {"value": [1, "kept"]}\n}\n',
  ".gitignore": "node_modules/\n",
  ".npmrc": "engine-strict=true\n",
};

export function fixture(
  name = "vite",
  files: Readonly<Record<string, string>> = minimalFiles,
  links: Readonly<Record<string, string>> = {},
): ScaffoldFixture {
  return {
    name,
    scaffolder: recipes[name]?.package ?? "",
    version: "1.0.0",
    command: "recorded",
    recordedOn: "2026-10-07",
    files,
    symlinks: links,
    rootEntries: [
      ...new Set(
        [...Object.keys(files), ...Object.keys(links)].map(
          (file) => file.split("/")[0] ?? "",
        ),
      ),
    ].sort(),
  };
}

export interface World {
  readonly calls: Command[];
  readonly root: string;
  readonly fixtures: readonly ScaffoldFixture[];
  readonly runner: Runner;
  readonly resources: PrepareResources;
  packed: number;
  closed: number;
  override?: (command: Command) => RunResult | Promise<RunResult> | undefined;
  close(): void;
}

export function world(
  fixtures: readonly ScaffoldFixture[] = [fixture()],
): World {
  const root = mkdtempSync(path.join(tmpdir(), "scaffold-check-world-"));
  const calls: Command[] = [];
  const snapshots = new Map<string, Snapshot>();
  const state: World = {
    root,
    calls,
    fixtures,
    packed: 0,
    closed: 0,
    resources: (folder) => {
      state.packed++;
      return Promise.resolve({
        version: "0.0.9",
        registry: FAKE_REGISTRY,
        tarballs: {
          templeBar: path.join(folder, "temple-bar.tgz"),
          createTempleBar: path.join(folder, "create-temple-bar.tgz"),
        },
        close: () => {
          state.closed++;
          return Promise.resolve();
        },
      });
    },
    runner: async (command) => {
      calls.push(command);
      const overridden = await state.override?.(command);
      if (overridden !== undefined) return overridden;
      if (command.args[0] === "--version") return ok("10.34.5\n");
      if (command.args[0] === "view") return ok("1.0.0\n");
      if (
        command.command === "pnpm" &&
        ["create", "dlx"].includes(command.args[0] ?? "")
      ) {
        const data = fixtures.find(
          (entry) => path.basename(command.cwd) === entry.name,
        );
        if (data === undefined)
          throw new Error("fake: missing scaffold fixture");
        const project = path.join(
          command.cwd,
          recipes[data.name]?.project ?? "",
        );
        writeProject(project, data.files, data.symlinks);
        snapshots.set(project, capture(project));
        return ok();
      }
      if (command.command === "git") {
        if (command.args[0] === "init") gitFiles(command.cwd);
        if (
          command.args[0] === "commit" &&
          command.args.includes("--allow-empty")
        )
          return {
            code: 1,
            output: "refusing to commit directly to main\n",
            stdout: "",
            timedOut: false,
          };
        return ok();
      }
      if (command.args.includes("create-temple-bar")) {
        const snapshot = snapshots.get(command.cwd);
        if (snapshot === undefined)
          throw new Error("fake: no original snapshot");
        const expected = expectation(snapshot);
        if (expected.refusal !== undefined)
          return {
            code: 1,
            output: `${expected.refusal}\n`,
            stdout: "",
            timedOut: false,
          };
        if (expected.unknown.length > 0)
          return { code: 1, output: "conflict\n", stdout: "", timedOut: false };
        install(command.cwd);
        return ok("setup passed\n");
      }
      if (command.args[0] === "run" && command.args[1] === "gate") {
        const scripts =
          object(
            manifest(snapshots.get(command.cwd)?.files["package.json"])
              ?.scripts,
          ) ?? {};
        const missing = ["typecheck", "lint", "format:check", "test"].filter(
          (name) => !(name in scripts),
        );
        return {
          code: missing.length > 0 ? 2 : 1,
          output: `${missing.length > 0 ? `gate: repo missing script(s): ${missing.join(", ")}\n` : ""}framework's own lint failed\n`,
          stdout: "",
          timedOut: false,
        };
      }
      if (command.args[0] === "exec" && command.args[1] === "prettier")
        return ok();
      throw new Error(
        `fake: unexpected command ${command.command} ${command.args.join(" ")}`,
      );
    },
    close: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
  return state;
}
