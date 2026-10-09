// Setup inputs and authentic Markdown documents, kept as data so the repo's
// tools cannot rewrite scaffolder output or treat its package.json as a workspace.

import { vite } from "./vite.ts";
import { next } from "./next.ts";
import { astro } from "./astro.ts";
import { sveltekit } from "./sveltekit.ts";
import { reactRouter } from "./react-router.ts";
import { nuxt } from "./nuxt.ts";
import { angular } from "./angular.ts";

export interface ScaffoldFixture {
  readonly name: string;
  readonly scaffolder: string;
  readonly version: string;
  readonly command: string;
  readonly recordedOn: string;
  readonly rootEntries?: readonly string[];
  readonly symlinks: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
}

export const scaffolds: readonly ScaffoldFixture[] = [
  vite,
  next,
  astro,
  sveltekit,
  reactRouter,
  nuxt,
  angular,
];
