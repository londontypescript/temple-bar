// Recorded on 2026-10-09 from create-nuxt 4.0.0, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create nuxt@4.0.0 nuxt-app --template minimal --no-install --gitInit=false --packageManager pnpm --no-modules
// Re-recording replaces these strings wholesale; never edit their content.

export const nuxt = {
  name: "nuxt",
  scaffolder: "create-nuxt",
  version: "4.0.0",
  command:
    "pnpm create nuxt@4.0.0 nuxt-app --template minimal --no-install --gitInit=false --packageManager pnpm --no-modules",
  recordedOn: "2026-10-09",
  rootEntries: [
    ".gitignore",
    "README.md",
    "app",
    "nuxt.config.ts",
    "package.json",
    "public",
    "tsconfig.json",
  ],
  symlinks: {},
  files: {
    ".gitignore":
      "# Nuxt dev/build outputs\n.output\n.data\n.nuxt\n.nitro\n.cache\ndist\n\n# Node dependencies\nnode_modules\n\n# Logs\nlogs\n*.log\n\n# Misc\n.DS_Store\n.fleet\n.idea\n\n# Local env files\n.env\n.env.*\n!.env.example\n",
    "README.md":
      "# Nuxt Minimal Starter\n\nLook at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.\n\n## Setup\n\nMake sure to install dependencies:\n\n```bash\n# npm\nnpm install\n\n# pnpm\npnpm install\n\n# yarn\nyarn install\n\n# bun\nbun install\n```\n\n## Development Server\n\nStart the development server on `http://localhost:3000`:\n\n```bash\n# npm\nnpm run dev\n\n# pnpm\npnpm dev\n\n# yarn\nyarn dev\n\n# bun\nbun run dev\n```\n\n## Production\n\nBuild the application for production:\n\n```bash\n# npm\nnpm run build\n\n# pnpm\npnpm build\n\n# yarn\nyarn build\n\n# bun\nbun run build\n```\n\nLocally preview production build:\n\n```bash\n# npm\nnpm run preview\n\n# pnpm\npnpm preview\n\n# yarn\nyarn preview\n\n# bun\nbun run preview\n```\n\nCheck out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.\n",
    "package.json":
      '{\n  "name": "nuxt-app",\n  "type": "module",\n  "private": true,\n  "scripts": {\n    "build": "nuxt build",\n    "dev": "nuxt dev",\n    "generate": "nuxt generate",\n    "preview": "nuxt preview",\n    "postinstall": "nuxt prepare"\n  },\n  "dependencies": {\n    "nuxt": "^4.6.0",\n    "vue": "^3.5.43",\n    "vue-router": "^5.3.1"\n  }\n}\n',
  },
};
