// A pnpm workspace shaped like the stacks temple-bar's users build, for the
// unused-code check's tests: a Vite web app, an Ink terminal app, an
// Electron desktop app and a shared package only the apps import. Returned
// as files to write (path relative to the root, then text), so its sources
// exist only in a test's temporary folder and never join this repo's own
// knip graph. Nothing is installed: knip finds every entry from the
// manifests, scripts and index.html alone. Not shipped: the build tsconfig
// excludes every `testing/` folder.

/** A command that runs and passes, so the gate's scripts have work to do. */
const PASSING = 'node -e "process.exit(0)"';

const SCRIPTS: Readonly<Record<string, string>> = {
  typecheck: PASSING,
  lint: PASSING,
  "format:check": PASSING,
  test: PASSING,
};

function manifest(fields: Readonly<Record<string, unknown>>): string {
  const { scripts, ...rest } = fields;
  return `${JSON.stringify(
    {
      private: true,
      type: "module",
      ...rest,
      scripts: { ...SCRIPTS, ...(scripts as Record<string, string>) },
    },
    null,
    2,
  )}\n`;
}

export interface EntriesOptions {
  /** A root `vitest.root.config.ts`, which knip's Vitest plugin doesn't
   * look for under that name: "declared" also names it in the project's
   * knip config. */
  readonly rootVitestConfig?: "undeclared" | "declared";
  /** A second Electron entry, `apps/desktop/src/host.ts`, built by an
   * esbuild script knip doesn't take entries from: "declared" also names
   * it in the project's knip config. */
  readonly hostEntry?: "undeclared" | "declared";
}

/** The project's own knip config, declaring what `options` asks for;
 * undefined when it declares nothing, so there is no config at all. */
function knipConfig(options: EntriesOptions): string | undefined {
  const config: Record<string, unknown> = {};
  if (options.rootVitestConfig === "declared") {
    config.vitest = { config: ["vitest.root.config.ts"] };
  }
  if (options.hostEntry === "declared") {
    config.workspaces = { "apps/desktop": { entry: ["src/host.ts"] } };
  }
  return Object.keys(config).length === 0
    ? undefined
    : `${JSON.stringify(config, null, 2)}\n`;
}

/** The workspace's files, keyed by "/"-separated path from the root. The
 * root's package.json has no temple-bar scripts: setup adds those. */
export function entriesWorkspace(
  options: EntriesOptions = {},
): Record<string, string> {
  const host = options.hostEntry !== undefined;
  const files: Record<string, string> = {
    ".gitignore": "node_modules/\n",
    "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - "packages/*"\n',
    "package.json": manifest({
      name: "entries-root",
      ...(options.rootVitestConfig === undefined
        ? {}
        : { devDependencies: { vitest: "4.0.0" } }),
    }),

    // Entries are named so knip's default entry patterns (src/main.*,
    // src/cli.*, src/index.*) don't match them: each is found only through
    // its tool's own detection.
    //
    // Vite finds src/boot.tsx through index.html.
    "apps/web/package.json": manifest({
      name: "@entries/web",
      scripts: { dev: "vite", build: "vite build" },
      dependencies: {
        "@entries/shared": "workspace:*",
        react: "19.0.0",
        "react-dom": "19.0.0",
      },
      devDependencies: { vite: "7.0.0" },
    }),
    "apps/web/index.html":
      '<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/boot.tsx"></script>\n  </body>\n</html>\n',
    // A plain object, so knip can load it without vite installed.
    "apps/web/vite.config.ts": "export default { server: { port: 5173 } };\n",
    "apps/web/src/boot.tsx":
      'import { greet } from "@entries/shared";\nimport { App } from "./App.tsx";\n\nconsole.log(greet("web"), App);\n',
    "apps/web/src/App.tsx":
      "export function App() {\n  return <p>web</p>;\n}\n",

    // Ink's entry is found through the tsx script that runs it.
    "apps/terminal/package.json": manifest({
      name: "@entries/terminal",
      scripts: { "start:source": "tsx src/app.tsx" },
      dependencies: {
        "@entries/shared": "workspace:*",
        ink: "6.0.0",
        react: "19.0.0",
      },
      devDependencies: { tsx: "4.0.0" },
    }),
    "apps/terminal/src/app.tsx":
      'import type { Theme } from "@entries/shared";\n\nconst theme: Theme = { accent: "green" };\nconsole.log(theme.accent);\n',

    // Electron's main process is the manifest's main.
    "apps/desktop/package.json": manifest({
      name: "@entries/desktop",
      main: "src/electron.ts",
      ...(host
        ? {
            scripts: {
              "build:host":
                "esbuild src/host.ts --bundle --platform=node --outfile=dist/host.js",
            },
          }
        : {}),
      dependencies: { "@entries/shared": "workspace:*" },
      devDependencies: {
        electron: "38.0.0",
        ...(host ? { esbuild: "0.25.0" } : {}),
      },
    }),
    "apps/desktop/src/electron.ts":
      'import { greet } from "@entries/shared";\n\nconsole.log(greet("desktop"));\n',

    // Source-only: its exports point at TypeScript, and only the apps
    // import them.
    "packages/shared/package.json": manifest({
      name: "@entries/shared",
      exports: { ".": "./src/index.ts" },
    }),
    "packages/shared/src/index.ts":
      "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n\nexport interface Theme {\n  readonly accent: string;\n}\n",
  };
  if (options.rootVitestConfig !== undefined) {
    files["vitest.root.config.ts"] =
      'export default { test: { include: ["**/*.test.ts"] } };\n';
  }
  if (host) {
    files["apps/desktop/src/host.ts"] = 'console.log("host");\n';
  }
  const config = knipConfig(options);
  if (config !== undefined) {
    files["knip.json"] = config;
  }
  return files;
}
