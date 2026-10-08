export interface Recipe {
  readonly package: string;
  readonly args: readonly string[];
  readonly project: string;
  readonly exportName: string;
}

const VERSION = "{version}";

/** Arguments are data, so the resolved version never needs shell interpolation. */
export const recipes: Readonly<Record<string, Recipe>> = {
  vite: {
    package: "create-vite",
    args: [
      "create",
      `vite@${VERSION}`,
      "vite-app",
      "--template",
      "react-ts",
      "--no-interactive",
    ],
    project: "vite-app",
    exportName: "vite",
  },
  next: {
    package: "create-next-app",
    args: [
      "create",
      `next-app@${VERSION}`,
      "next-app",
      "--yes",
      "--skip-install",
      "--disable-git",
      "--use-pnpm",
    ],
    project: "next-app",
    exportName: "next",
  },
  astro: {
    package: "create-astro",
    args: [
      "create",
      `astro@${VERSION}`,
      "astro-app",
      "--template",
      "minimal",
      "--no-install",
      "--no-git",
      "--yes",
    ],
    project: "astro-app",
    exportName: "astro",
  },
  sveltekit: {
    package: "sv",
    args: [
      "dlx",
      `sv@${VERSION}`,
      "create",
      "svelte-app",
      "--template",
      "minimal",
      "--types",
      "ts",
      "--no-add-ons",
      "--no-install",
    ],
    project: "svelte-app",
    exportName: "sveltekit",
  },
  "react-router": {
    package: "create-react-router",
    args: [
      "create",
      `react-router@${VERSION}`,
      "rr-app",
      "--yes",
      "--no-install",
      "--no-git-init",
    ],
    project: "rr-app",
    exportName: "reactRouter",
  },
  nuxt: {
    package: "create-nuxt",
    args: [
      "create",
      `nuxt@${VERSION}`,
      "nuxt-app",
      "--template",
      "minimal",
      "--no-install",
      "--gitInit=false",
      "--packageManager",
      "pnpm",
      "--no-modules",
    ],
    project: "nuxt-app",
    exportName: "nuxt",
  },
  angular: {
    package: "@angular/cli",
    args: [
      "dlx",
      `@angular/cli@${VERSION}`,
      "new",
      "ng-app",
      "--defaults",
      "--skip-install",
      "--skip-git",
    ],
    project: "ng-app",
    exportName: "angular",
  },
};

export function scaffoldArgs(recipe: Recipe, version: string): string[] {
  return recipe.args.map((arg) => arg.replace(VERSION, version));
}

/** Printed commands are for the report and recording, never executed as strings. */
export function commandText(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((arg) => (/^[\w@./=:+-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ");
}
