// Recorded on 2026-10-09 from create-next-app 16.4.0, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create next-app@16.4.0 next-app --yes --skip-install --disable-git --use-pnpm
// Re-recording replaces these strings wholesale; never edit their content.

export const next = {
  name: "next",
  scaffolder: "create-next-app",
  version: "16.4.0",
  command:
    "pnpm create next-app@16.4.0 next-app --yes --skip-install --disable-git --use-pnpm",
  recordedOn: "2026-10-09",
  rootEntries: [
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "app",
    "eslint.config.mjs",
    "next-env.d.ts",
    "next.config.ts",
    "package.json",
    "pnpm-workspace.yaml",
    "public",
    "tsconfig.json",
  ],
  symlinks: {},
  files: {
    ".gitignore":
      "# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.\n\n# dependencies\n/node_modules\n/.pnp\n.pnp.*\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/versions\n\n# testing\n/coverage\n\n# next.js\n/.next/\n/out/\n\n# production\n/build\n\n# misc\n.DS_Store\n*.pem\n\n# debug\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n.pnpm-debug.log*\n\n# env files (can opt-in for committing if needed)\n.env*\n\n# vercel\n.vercel\n\n# typescript\n*.tsbuildinfo\nnext-env.d.ts\n",
    "AGENTS.md":
      "<!-- BEGIN:nextjs-agent-rules -->\n\n## This is NOT the Next.js you know\n\nThis version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.\n\nThis block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.\n\n<!-- END:nextjs-agent-rules -->\n",
    "README.md":
      "This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).\n\n## Getting Started\n\nFirst, run the development server:\n\n```bash\nnpm run dev\n# or\nyarn dev\n# or\npnpm dev\n# or\nbun dev\n```\n\nOpen [http://localhost:3000](http://localhost:3000) with your browser to see the result.\n\nYou can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.\n\nThis project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.\n\n## Learn More\n\nTo learn more about Next.js, take a look at the following resources:\n\n- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.\n- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.\n\nYou can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!\n\n## Deploy on Vercel\n\nThe easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.\n\nCheck out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.\n",
    "eslint.config.mjs":
      'import { defineConfig, globalIgnores } from "eslint/config";\nimport nextVitals from "eslint-config-next/core-web-vitals";\nimport nextTs from "eslint-config-next/typescript";\n\nconst eslintConfig = defineConfig([\n  ...nextVitals,\n  ...nextTs,\n  // Override default ignores of eslint-config-next.\n  globalIgnores([\n    // Default ignores of eslint-config-next:\n    ".next/**",\n    "out/**",\n    "build/**",\n    "next-env.d.ts",\n  ]),\n]);\n\nexport default eslintConfig;\n',
    "package.json":
      '{\n  "name": "next-app",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build",\n    "start": "next start",\n    "lint": "eslint"\n  },\n  "dependencies": {\n    "next": "16.4.0",\n    "react": "19.3.0",\n    "react-dom": "19.3.0"\n  },\n  "devDependencies": {\n    "@tailwindcss/turbopack": "^4",\n    "@types/node": "^20",\n    "@types/react": "^19",\n    "@types/react-dom": "^19",\n    "eslint": "^9",\n    "eslint-config-next": "16.4.0",\n    "tailwindcss": "^4",\n    "typescript": "^5"\n  },\n  "packageManager": "pnpm@10.34.5"\n}\n',
    "pnpm-workspace.yaml":
      "ignoredBuiltDependencies:\n  - sharp\n  - unrs-resolver\n",
  },
};
