// Recorded on 2026-10-09 from create-vite 9.2.1, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create vite@9.2.1 vite-app --template react-ts --no-interactive
// Re-recording replaces these strings wholesale; never edit their content.

export const vite = {
  name: "vite",
  scaffolder: "create-vite",
  version: "9.2.1",
  command:
    "pnpm create vite@9.2.1 vite-app --template react-ts --no-interactive",
  recordedOn: "2026-10-09",
  rootEntries: [
    ".gitignore",
    ".oxlintrc.json",
    "README.md",
    "index.html",
    "package.json",
    "public",
    "src",
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts",
  ],
  symlinks: {},
  files: {
    ".gitignore":
      "# Logs\nlogs\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\nlerna-debug.log*\n\nnode_modules\ndist\ndist-ssr\n*.local\n\n# Editor directories and files\n.vscode/*\n!.vscode/extensions.json\n.idea\n.DS_Store\n*.suo\n*.ntvs*\n*.njsproj\n*.sln\n*.sw?\n",
    ".oxlintrc.json":
      '{\n  "$schema": "./node_modules/oxlint/configuration_schema.json",\n  "plugins": ["react", "typescript", "oxc"],\n  "rules": {\n    "react/rules-of-hooks": "error",\n    "react/only-export-components": ["warn", { "allowConstantExport": true }]\n  }\n}\n',
    "README.md":
      '# React + TypeScript + Vite\n\nThis template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.\n\nCurrently, two official plugins are available:\n\n- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)\n- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)\n\n## React Compiler\n\nThe React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).\n\n## Expanding the Oxlint configuration\n\nIf you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:\n\n```json\n{\n  "$schema": "./node_modules/oxlint/configuration_schema.json",\n  "plugins": ["react", "typescript", "oxc"],\n  "options": {\n    "typeAware": true\n  },\n  "rules": {\n    "react/rules-of-hooks": "error",\n    "react/only-export-components": ["warn", { "allowConstantExport": true }]\n  }\n}\n```\n\nSee the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.\n',
    "package.json":
      '{\n  "name": "vite-app",\n  "private": true,\n  "version": "0.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc -b && vite build",\n    "lint": "oxlint",\n    "preview": "vite preview"\n  },\n  "dependencies": {\n    "react": "^19.2.8",\n    "react-dom": "^19.2.8"\n  },\n  "devDependencies": {\n    "@types/node": "^24.13.3",\n    "@types/react": "^19.2.18",\n    "@types/react-dom": "^19.2.7",\n    "@vitejs/plugin-react": "^6.1.1",\n    "oxlint": "^1.81.0",\n    "typescript": "~6.0.2",\n    "vite": "^8.3.0"\n  }\n}\n',
  },
};
