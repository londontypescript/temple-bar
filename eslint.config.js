// @ts-check
import path from "node:path";
import { includeIgnoreFile } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Skip whatever git ignores, so a worktree inside the repo (a whole
  // checkout of another branch) is never linted as part of this one.
  includeIgnoreFile(path.join(import.meta.dirname, ".gitignore"), {
    gitignoreResolution: true,
  }),
  {
    ignores: ["**/dist/", "**/node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // eslint.config.js itself is tooling config, not part of any tsconfig
    // project, so it cannot carry type-aware linting.
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  eslintConfigPrettier,
);
