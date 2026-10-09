// Frozen published output, independent of the live templates and their catalog.
// Never refresh these files from the working tree. Add a release only from its
// integrity-verified published tarball, retaining its metadata and older bytes.

import { readFileSync } from "node:fs";

export interface PublishedOutput {
  readonly item: string;
  readonly releases: readonly string[];
  readonly sha256: string;
  readonly file: string;
}

export interface PublishedRelease {
  readonly version: string;
  readonly tarball: string;
  readonly integrity: string;
  readonly gitHead: string;
  readonly tagCommit: string;
  readonly artifacts: readonly string[];
}

const here = new URL("./published-output/", import.meta.url);

export const PUBLISHED_OUTPUTS = JSON.parse(
  readFileSync(new URL("outputs.json", here), "utf8"),
) as readonly PublishedOutput[];

export const PUBLISHED_RELEASES = JSON.parse(
  readFileSync(new URL("releases.json", here), "utf8"),
) as readonly PublishedRelease[];

export function publishedOutput(output: PublishedOutput): string {
  return readFileSync(new URL(output.file, here), "utf8");
}

export function outputFromRelease(item: string, version: string): string {
  const output = PUBLISHED_OUTPUTS.find(
    (output) => output.item === item && output.releases.includes(version),
  );
  if (output === undefined)
    throw new Error(`${version} did not publish ${item}`);
  return publishedOutput(output);
}
