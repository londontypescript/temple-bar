// Recorded on 2026-10-07 from create-nuxt 4.0.0, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create nuxt@latest nuxt-app --template minimal --no-install --gitInit=false --packageManager pnpm --no-modules
// Re-recording replaces these strings wholesale; never edit their content.

export const nuxt = {
  name: "nuxt",
  scaffolder: "create-nuxt",
  version: "4.0.0",
  command:
    "pnpm create nuxt@latest nuxt-app --template minimal --no-install --gitInit=false --packageManager pnpm --no-modules",
  recordedOn: "2026-10-07",
  files: {
    ".gitignore":
      "# Nuxt dev/build outputs\n.output\n.data\n.nuxt\n.nitro\n.cache\ndist\n\n# Node dependencies\nnode_modules\n\n# Logs\nlogs\n*.log\n\n# Misc\n.DS_Store\n.fleet\n.idea\n\n# Local env files\n.env\n.env.*\n!.env.example\n",
    "package.json":
      '{\n  "name": "nuxt-app",\n  "type": "module",\n  "private": true,\n  "scripts": {\n    "build": "nuxt build",\n    "dev": "nuxt dev",\n    "generate": "nuxt generate",\n    "preview": "nuxt preview",\n    "postinstall": "nuxt prepare"\n  },\n  "dependencies": {\n    "nuxt": "^4.6.0",\n    "vue": "^3.5.43",\n    "vue-router": "^5.3.1"\n  }\n}\n',
  },
};
