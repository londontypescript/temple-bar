// The five packages of the stack in stack.ts, as files to write: the apps
// and the shared package, each with its own manifest, tsconfig, sources and
// one small real test, and a sixth app for the tests that add a target.
// JSON is written the way Prettier formats it, since every package's
// format:check reads it.

/** The four scripts the gate requires, as every package runs them. Vitest
 * runs from the package with the root's shared config. */
export const PACKAGE_SCRIPTS: Readonly<Record<string, string>> = {
  typecheck: "tsc --noEmit -p tsconfig.json",
  lint: "eslint .",
  "format:check": "prettier --check .",
  test: "vitest run --root . --config ../../vitest.config.ts",
};

/** JSON as package.json is written: Prettier formats it the same way. */
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** JSON as Prettier writes any other .json file: a short list of strings
 * kept on one line. */
export function jsonConfig(value: unknown): string {
  return json(value).replace(
    /\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s*\]/g,
    (_list, items: string) => `[${items.split(/,\n\s+/).join(", ")}]`,
  );
}

/** A package's manifest: private, ESM, the four scripts plus `extra`. */
function manifest(
  name: string,
  fields: Readonly<Record<string, unknown>>,
  extra: Readonly<Record<string, string>> = {},
): string {
  return json({
    name,
    private: true,
    type: "module",
    ...fields,
    scripts: { ...PACKAGE_SCRIPTS, ...extra },
  });
}

/** Every package compiles against TypeScript and Node's types itself. */
const TYPESCRIPT = { "@types/node": "24.19.0", typescript: "catalog:" };

const TSCONFIG = jsonConfig({
  extends: "../../tsconfig.base.json",
  include: ["src/**/*.ts", "src/**/*.tsx", "*.config.ts"],
});

function indexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

const VITE_CONFIG = `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react()], base: "./" });
`;

const REACT_MAIN = `import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(<App />);
`;

function web(): Record<string, string> {
  return {
    "apps/web/package.json": manifest(
      "@stack/web",
      {
        dependencies: {
          "@stack/shared": "workspace:*",
          react: "catalog:",
          "react-dom": "catalog:",
        },
        devDependencies: {
          ...TYPESCRIPT,
          "@types/react": "catalog:",
          "@types/react-dom": "catalog:",
          "@vitejs/plugin-react": "catalog:",
          vite: "catalog:",
        },
      },
      { dev: "vite", build: "vite build" },
    ),
    "apps/web/tsconfig.json": TSCONFIG,
    "apps/web/index.html": indexHtml("Web"),
    "apps/web/vite.config.ts": VITE_CONFIG,
    "apps/web/src/main.tsx": REACT_MAIN,
    "apps/web/src/App.tsx": `import { stackValue } from "@stack/shared";

export function App() {
  return <h1>{stackValue().label}</h1>;
}
`,
    "apps/web/src/App.test.tsx": `import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { App } from "./App";

test("the web app renders the shared label", () => {
  expect(renderToStaticMarkup(<App />)).toBe("<h1>Shared TypeScript</h1>");
});
`,
  };
}

function scene(): Record<string, string> {
  return {
    "apps/scene/package.json": manifest(
      "@stack/scene",
      {
        dependencies: {
          "@react-three/fiber": "catalog:",
          "@stack/shared": "workspace:*",
          react: "catalog:",
          "react-dom": "catalog:",
          three: "catalog:",
        },
        devDependencies: {
          ...TYPESCRIPT,
          "@types/react": "catalog:",
          "@types/react-dom": "catalog:",
          "@types/three": "catalog:",
          "@vitejs/plugin-react": "catalog:",
          vite: "catalog:",
        },
      },
      { dev: "vite", build: "vite build" },
    ),
    "apps/scene/tsconfig.json": TSCONFIG,
    "apps/scene/index.html": indexHtml("Scene"),
    "apps/scene/vite.config.ts": VITE_CONFIG,
    "apps/scene/src/main.tsx": REACT_MAIN,
    "apps/scene/src/App.tsx": `import { Canvas } from "@react-three/fiber";
import { dimensions } from "./geometry";

export function App() {
  return (
    <Canvas>
      <mesh>
        <boxGeometry args={dimensions()} />
        <meshBasicMaterial color="orange" />
      </mesh>
    </Canvas>
  );
}
`,
    "apps/scene/src/geometry.ts": `import { stackValue } from "@stack/shared";

export function dimensions(): [number, number, number] {
  const { side } = stackValue();
  return [side, side, side];
}
`,
    "apps/scene/src/geometry.test.ts": `import { BoxGeometry } from "three";
import { expect, test } from "vitest";
import { dimensions } from "./geometry";

test("the shared side reaches a real Three.js box", () => {
  const box = new BoxGeometry(...dimensions());
  expect(box.parameters.width).toBe(1.5);
  box.dispose();
});
`,
  };
}

function terminal(): Record<string, string> {
  return {
    "apps/terminal/package.json": manifest(
      "@stack/terminal",
      {
        dependencies: {
          "@stack/shared": "workspace:*",
          ink: "catalog:",
          react: "catalog:",
        },
        devDependencies: { ...TYPESCRIPT, "@types/react": "catalog:" },
      },
      { "start:source": "tsx src/main.tsx" },
    ),
    "apps/terminal/tsconfig.json": TSCONFIG,
    "apps/terminal/src/main.tsx": `import { render, Text, useApp } from "ink";
import { useEffect } from "react";
import { stackValue } from "@stack/shared";

function Terminal() {
  const { exit } = useApp();
  useEffect(() => {
    const timer = setTimeout(exit, 100);
    return () => clearTimeout(timer);
  }, [exit]);
  return <Text>{stackValue().label}</Text>;
}

await render(<Terminal />).waitUntilExit();
`,
    // The real CLI, started the way its start:source script starts it.
    "apps/terminal/src/main.test.ts": `import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const START = ["--import", "tsx", "src/main.tsx"];
const OPTIONS = {
  env: { ...process.env, CI: "true" },
  encoding: "utf8",
  timeout: 60_000,
} as const;

test("the terminal app prints the shared label", { timeout: 60_000 }, () => {
  const result = spawnSync(process.execPath, START, OPTIONS);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Shared TypeScript");
});
`,
  };
}

function desktop(): Record<string, string> {
  return {
    // main names the Electron main process; the preload script is built by
    // its own esbuild script, an entry knip finds only through knip.json.
    "apps/desktop/package.json": manifest(
      "@stack/desktop",
      {
        main: "src/electron.ts",
        dependencies: { "@stack/shared": "workspace:*" },
        devDependencies: { ...TYPESCRIPT, electron: "44.4.4" },
      },
      {
        "build:preload":
          "esbuild src/preload.ts --bundle --platform=node --external:electron --outfile=dist/preload.cjs",
      },
    ),
    "apps/desktop/tsconfig.json": TSCONFIG,
    "apps/desktop/src/electron.ts": `import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { stackValue } from "@stack/shared";
import { windowTitle } from "./title";

void app.whenReady().then(() => {
  const window = new BrowserWindow({
    title: windowTitle(stackValue().label),
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs") },
  });
  void window.loadURL("about:blank");
});
`,
    "apps/desktop/src/preload.ts": `import { contextBridge } from "electron";
import { stackValue } from "@stack/shared";

contextBridge.exposeInMainWorld("stack", { label: stackValue().label });
`,
    "apps/desktop/src/title.ts": `export function windowTitle(label: string): string {
  return \`\${label} (desktop)\`;
}
`,
    "apps/desktop/src/title.test.ts": `import { expect, test } from "vitest";
import { windowTitle } from "./title";

test("the window title names the desktop app", () => {
  expect(windowTitle("Shared TypeScript")).toBe("Shared TypeScript (desktop)");
});
`,
  };
}

function shared(): Record<string, string> {
  return {
    // Source only: its export points at TypeScript, which each app's own
    // tools compile.
    "packages/shared/package.json": manifest("@stack/shared", {
      exports: "./src/index.ts",
      devDependencies: TYPESCRIPT,
    }),
    "packages/shared/tsconfig.json": TSCONFIG,
    "packages/shared/src/index.ts": `export { stackValue, type StackValue } from "./value";
`,
    "packages/shared/src/value.ts": `export interface StackValue {
  readonly label: string;
  readonly side: number;
}

export function stackValue(): StackValue {
  return { label: "Shared TypeScript", side: 1.5 };
}
`,
    "packages/shared/src/value.test.ts": `import { expect, test } from "vitest";
import { stackValue } from "./value";

test("each call returns its own copy of the shared value", () => {
  expect(stackValue()).toEqual({ label: "Shared TypeScript", side: 1.5 });
  expect(stackValue()).not.toBe(stackValue());
});
`,
  };
}

/** The five packages besides the root. */
export function stackPackages(): Record<string, string> {
  return { ...web(), ...scene(), ...terminal(), ...desktop(), ...shared() };
}

/** A sixth app, `apps/extra`, with real code and a test, and `scripts` in
 * its manifest. */
export function extraApp(
  scripts: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    "apps/extra/package.json": json({
      name: "@stack/extra",
      private: true,
      type: "module",
      scripts,
      devDependencies: TYPESCRIPT,
    }),
    "apps/extra/tsconfig.json": TSCONFIG,
    "apps/extra/src/index.ts": `export function extra(): string {
  return "extra";
}
`,
    "apps/extra/src/index.test.ts": `import { expect, test } from "vitest";
import { extra } from "./index";

test("the extra app has real code", () => {
  expect(extra()).toBe("extra");
});
`,
  };
}
