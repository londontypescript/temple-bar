// Recorded on 2026-10-07 from create-astro 5.2.5, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0.
// Re-recording replaces these strings wholesale; never edit their content.

export const astro = {
  name: "astro",
  scaffolder: "create-astro",
  version: "5.2.5",
  command:
    "pnpm create astro@5.2.5 astro-app --template minimal --no-install --no-git --yes",
  recordedOn: "2026-10-07",
  symlinks: {
    "CLAUDE.md": "AGENTS.md",
  },
  files: {
    ".gitignore":
      "# build output\ndist/\n# generated types\n.astro/\n\n# dependencies\nnode_modules/\n\n# logs\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n\n\n# environment variables\n.env\n.env.production\n\n# macOS-specific files\n.DS_Store\n\n# jetbrains setting folder\n.idea/\n",
    "AGENTS.md":
      "## Development\n\nWhen starting the dev server, use background mode:\n\n```\nastro dev --background\n```\n\nManage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.\n\n## Documentation\n\nFull documentation: https://docs.astro.build\n\nConsult these guides before working on related tasks:\n\n- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)\n- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)\n- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)\n- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)\n- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)\n- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)\n",
    "package.json":
      '{\n  "name": "astro-app",\n  "type": "module",\n  "version": "0.0.1",\n  "engines": {\n    "node": ">=22.12.0"\n  },\n  "scripts": {\n    "dev": "astro dev",\n    "build": "astro build",\n    "preview": "astro preview",\n    "astro": "astro"\n  },\n  "dependencies": {\n    "astro": "^7.3.6"\n  },\n  "allowScripts": {\n    "esbuild": true\n  }\n}',
  },
};
