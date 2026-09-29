// Builds and packs both packages the way a release does: compile each with
// its own tsconfig.build.json, stage the package.json next to dist/, and
// `npm pack` it. The tarballs are what the test installs, so the test sees
// exactly what npm would publish (the `files` list, the bin, dist only).

import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, run } from "./run.ts";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export interface Tarballs {
  readonly templeBar: string;
  readonly createTempleBar: string;
}

async function buildAndPack(
  packageDir: string,
  stageDir: string,
  outDir: string,
): Promise<string> {
  mkdirSync(stageDir, { recursive: true });
  const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const build = await run(
    process.execPath,
    [tsc, "-p", "tsconfig.build.json", "--outDir", path.join(stageDir, "dist")],
    { cwd: packageDir, env: process.env },
  );
  if (build.code !== 0) {
    throw new Error(`build failed in ${packageDir}\n${describe(build)}`);
  }
  cpSync(
    path.join(packageDir, "package.json"),
    path.join(stageDir, "package.json"),
  );

  const pack = await run(
    "npm",
    ["pack", "--json", "--pack-destination", outDir],
    {
      cwd: stageDir,
      env: process.env,
    },
  );
  if (pack.code !== 0) {
    throw new Error(`npm pack failed in ${stageDir}\n${describe(pack)}`);
  }
  const [packed] = JSON.parse(pack.stdout) as { filename: string }[];
  if (!packed) {
    throw new Error(`npm pack reported nothing\n${describe(pack)}`);
  }
  return path.join(outDir, packed.filename);
}

/** Builds and packs both packages under `workDir`; returns the tarballs. */
export async function packBoth(workDir: string): Promise<Tarballs> {
  const outDir = path.join(workDir, "tarballs");
  mkdirSync(outDir, { recursive: true });
  const packages = path.join(repoRoot, "packages");
  return {
    templeBar: await buildAndPack(
      path.join(packages, "temple-bar"),
      path.join(workDir, "stage", "temple-bar"),
      outDir,
    ),
    createTempleBar: await buildAndPack(
      path.join(packages, "create-temple-bar"),
      path.join(workDir, "stage", "create-temple-bar"),
      outDir,
    ),
  };
}
