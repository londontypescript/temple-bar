// Recorded on 2026-10-07 from create-next-app 16.4.0, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create next-app@latest next-app --yes --skip-install --disable-git --use-pnpm
// Re-recording replaces these strings wholesale; never edit their content.

export const next = {
  name: "next",
  scaffolder: "create-next-app",
  version: "16.4.0",
  command:
    "pnpm create next-app@latest next-app --yes --skip-install --disable-git --use-pnpm",
  recordedOn: "2026-10-07",
  symlinks: {},
  files: {
    ".gitignore":
      "# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.\n\n# dependencies\n/node_modules\n/.pnp\n.pnp.*\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/versions\n\n# testing\n/coverage\n\n# next.js\n/.next/\n/out/\n\n# production\n/build\n\n# misc\n.DS_Store\n*.pem\n\n# debug\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n.pnpm-debug.log*\n\n# env files (can opt-in for committing if needed)\n.env*\n\n# vercel\n.vercel\n\n# typescript\n*.tsbuildinfo\nnext-env.d.ts\n",
    "AGENTS.md":
      "<!-- BEGIN:nextjs-agent-rules -->\n\n## This is NOT the Next.js you know\n\nThis version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.\n\nThis block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.\n\n<!-- END:nextjs-agent-rules -->\n",
    "eslint.config.mjs":
      'import { defineConfig, globalIgnores } from "eslint/config";\nimport nextVitals from "eslint-config-next/core-web-vitals";\nimport nextTs from "eslint-config-next/typescript";\n\nconst eslintConfig = defineConfig([\n  ...nextVitals,\n  ...nextTs,\n  // Override default ignores of eslint-config-next.\n  globalIgnores([\n    // Default ignores of eslint-config-next:\n    ".next/**",\n    "out/**",\n    "build/**",\n    "next-env.d.ts",\n  ]),\n]);\n\nexport default eslintConfig;\n',
    "package.json":
      '{\n  "name": "next-app",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build",\n    "start": "next start",\n    "lint": "eslint"\n  },\n  "dependencies": {\n    "next": "16.4.0",\n    "react": "19.3.0",\n    "react-dom": "19.3.0"\n  },\n  "devDependencies": {\n    "@tailwindcss/turbopack": "^4",\n    "@types/node": "^20",\n    "@types/react": "^19",\n    "@types/react-dom": "^19",\n    "eslint": "^9",\n    "eslint-config-next": "16.4.0",\n    "tailwindcss": "^4",\n    "typescript": "^5"\n  },\n  "packageManager": "pnpm@10.34.5"\n}\n',
    "pnpm-workspace.yaml":
      "ignoredBuiltDependencies:\n  - sharp\n  - unrs-resolver\n",
  },
};
