// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
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
