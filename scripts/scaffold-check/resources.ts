import { readFileSync } from "node:fs";
import path from "node:path";
import { packBoth, type Tarballs } from "../../e2e/support/pack.ts";
import { serveTarball } from "../../e2e/support/registry.ts";

export interface Resources {
  readonly tarballs: Tarballs;
  readonly version: string;
  readonly registry: string;
  close(): Promise<void>;
}

export type PrepareResources = (folder: string) => Promise<Resources>;

/** Packing deliberately uses the parent's environment, as the release path does. */
export const prepareResources: PrepareResources = async (folder) => {
  const tarballs = await packBoth(folder);
  const manifest = JSON.parse(
    readFileSync(path.join(folder, "stage/temple-bar/package.json"), "utf8"),
  ) as { name: string; version: string };
  const registry = await serveTarball(manifest, tarballs.templeBar);
  return {
    tarballs,
    version: manifest.version,
    registry: registry.url,
    close: () => registry.close(),
  };
};
