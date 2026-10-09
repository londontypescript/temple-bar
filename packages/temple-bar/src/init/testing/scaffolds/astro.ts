// Recorded on 2026-10-09 from create-astro 5.2.6, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create astro@5.2.6 astro-app --template minimal --no-install --no-git --yes
// Re-recording replaces these strings wholesale; never edit their content.

export const astro = {
  name: "astro",
  scaffolder: "create-astro",
  version: "5.2.6",
  command:
    "pnpm create astro@5.2.6 astro-app --template minimal --no-install --no-git --yes",
  recordedOn: "2026-10-09",
  rootEntries: [
    ".gitignore",
    ".vscode",
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "astro.config.mjs",
    "package.json",
    "public",
    "src",
    "tsconfig.json",
  ],
  symlinks: {
    "CLAUDE.md": "AGENTS.md",
  },
  files: {
    ".gitignore":
      "# build output\ndist/\n# generated types\n.astro/\n\n# dependencies\nnode_modules/\n\n# logs\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n\n\n# environment variables\n.env\n.env.production\n\n# macOS-specific files\n.DS_Store\n\n# jetbrains setting folder\n.idea/\n",
    "AGENTS.md":
      "## Development\n\nWhen starting the dev server, use background mode:\n\n```\nastro dev --background\n```\n\nManage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.\n\n## Documentation\n\nFull documentation: https://docs.astro.build\n\nConsult these guides before working on related tasks:\n\n- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)\n- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)\n- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)\n- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)\n- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)\n- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)\n",
    "README.md":
      "# Astro Starter Kit: Minimal\n\n```sh\npnpm create astro@latest -- --template minimal\n```\n\n> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!\n\n## 🚀 Project Structure\n\nInside of your Astro project, you'll see the following folders and files:\n\n```text\n/\n├── public/\n├── src/\n│   └── pages/\n│       └── index.astro\n└── package.json\n```\n\nAstro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.\n\nThere's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.\n\nAny static assets, like images, can be placed in the `public/` directory.\n\n## 🧞 Commands\n\nAll commands are run from the root of the project, from a terminal:\n\n| Command                   | Action                                           |\n| :------------------------ | :----------------------------------------------- |\n| `pnpm install`             | Installs dependencies                            |\n| `pnpm dev`             | Starts local dev server at `localhost:4321`      |\n| `pnpm build`           | Build your production site to `./dist/`          |\n| `pnpm preview`         | Preview your build locally, before deploying     |\n| `pnpm astro ...`       | Run CLI commands like `astro add`, `astro check` |\n| `pnpm astro -- --help` | Get help using the Astro CLI                     |\n\n## 👀 Want to learn more?\n\nFeel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).\n",
    "package.json":
      '{\n  "name": "astro-app",\n  "type": "module",\n  "version": "0.0.1",\n  "engines": {\n    "node": ">=22.12.0"\n  },\n  "scripts": {\n    "dev": "astro dev",\n    "build": "astro build",\n    "preview": "astro preview",\n    "astro": "astro"\n  },\n  "dependencies": {\n    "astro": "^7.3.8"\n  }\n}',
  },
};
