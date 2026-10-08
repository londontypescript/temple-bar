// Recorded on 2026-10-08 from create-react-router 8.4.0, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm create react-router@8.4.0 rr-app --yes --no-install --no-git-init
// Re-recording replaces these strings wholesale; never edit their content.

export const reactRouter = {
  name: "react-router",
  scaffolder: "create-react-router",
  version: "8.4.0",
  command:
    "pnpm create react-router@8.4.0 rr-app --yes --no-install --no-git-init",
  recordedOn: "2026-10-08",
  rootEntries: [
    ".agents",
    ".dockerignore",
    ".gitignore",
    "Dockerfile",
    "README.md",
    "app",
    "package.json",
    "public",
    "react-router.config.ts",
    "tsconfig.json",
    "vite.config.ts",
  ],
  symlinks: {},
  files: {
    ".gitignore":
      ".DS_Store\n.env\n/node_modules/\n\n# React Router\n/.react-router/\n/build/\n",
    "package.json":
      '{\n  "name": "rr-app",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "build": "react-router build",\n    "dev": "react-router dev",\n    "start": "react-router-serve ./build/server/index.js",\n    "typecheck": "react-router typegen && tsc"\n  },\n  "dependencies": {\n    "@react-router/node": "^8.4.0",\n    "@react-router/serve": "^8.4.0",\n    "isbot": "^5.1.36",\n    "react": "^19.2.8",\n    "react-dom": "^19.2.8",\n    "react-router": "^8.4.0"\n  },\n  "devDependencies": {\n    "@react-router/dev": "^8.4.0",\n    "@tailwindcss/vite": "^4.2.2",\n    "@types/node": "^22",\n    "@types/react": "^19.2.18",\n    "@types/react-dom": "^19.2.7",\n    "tailwindcss": "^4.2.2",\n    "typescript": "^5.9.3",\n    "vite": "^8.0.3"\n  }\n}',
  },
};
