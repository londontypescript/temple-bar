// Recorded on 2026-10-08 from sv 1.1.1, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm dlx sv@1.1.1 create svelte-app --template minimal --types ts --no-add-ons --no-install
// Re-recording replaces these strings wholesale; never edit their content.

export const sveltekit = {
  name: "sveltekit",
  scaffolder: "sv",
  version: "1.1.1",
  command:
    "pnpm dlx sv@1.1.1 create svelte-app --template minimal --types ts --no-add-ons --no-install",
  recordedOn: "2026-10-08",
  rootEntries: [
    ".gitignore",
    ".npmrc",
    ".vscode",
    "README.md",
    "package.json",
    "src",
    "static",
    "tsconfig.json",
    "vite.config.ts",
  ],
  symlinks: {},
  files: {
    ".gitignore":
      "node_modules\n\n# Output\n.output\n.vercel\n.netlify\n.wrangler\n/.svelte-kit\n/build\n\n# OS\n.DS_Store\nThumbs.db\n\n# Env\n.env\n.env.*\n!.env.example\n!.env.test\n\n# Vite\nvite.config.js.timestamp-*\nvite.config.ts.timestamp-*\n",
    ".npmrc": "engine-strict=true\n",
    "package.json":
      '{\n\t"name": "svelte-app",\n\t"private": true,\n\t"version": "0.0.1",\n\t"type": "module",\n\t"scripts": {\n\t\t"dev": "vite dev",\n\t\t"build": "vite build",\n\t\t"preview": "vite preview",\n\t\t"prepare": "svelte-kit sync || echo \'\'",\n\t\t"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",\n\t\t"check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch"\n\t},\n\t"devDependencies": {\n\t\t"@sveltejs/adapter-auto": "^8.0.0",\n\t\t"@sveltejs/kit": "^3.0.0",\n\t\t"@sveltejs/vite-plugin-svelte": "^7.2.0",\n\t\t"svelte": "^5.57.1",\n\t\t"svelte-check": "^4.6.0",\n\t\t"typescript": "^6.0.3",\n\t\t"vite": "^8.3.0"\n\t},\n\t"imports": {\n\t\t"#lib": "./src/lib/index.js",\n\t\t"#lib/*": "./src/lib/*"\n\t}\n}\n',
  },
};
