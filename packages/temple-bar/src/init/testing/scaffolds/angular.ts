// Recorded on 2026-10-09 from @angular/cli 22.2.2, without installing
// dependencies, under pnpm 10.34.5 and Node 24.21.0:
// pnpm dlx @angular/cli@22.2.2 new ng-app --defaults --skip-install --skip-git
// Re-recording replaces these strings wholesale; never edit their content.

export const angular = {
  name: "angular",
  scaffolder: "@angular/cli",
  version: "22.2.2",
  command:
    "pnpm dlx @angular/cli@22.2.2 new ng-app --defaults --skip-install --skip-git",
  recordedOn: "2026-10-09",
  rootEntries: [
    ".editorconfig",
    ".gitignore",
    ".prettierrc",
    ".vscode",
    "README.md",
    "angular.json",
    "package.json",
    "public",
    "src",
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.spec.json",
  ],
  symlinks: {},
  files: {
    ".editorconfig":
      "# Editor configuration, see https://editorconfig.org\nroot = true\n\n[*]\ncharset = utf-8\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n\n[*.ts]\nquote_type = single\nij_typescript_use_double_quotes = false\n\n[*.md]\nmax_line_length = off\ntrim_trailing_whitespace = false\n",
    ".gitignore":
      "# See https://docs.github.com/get-started/getting-started-with-git/ignoring-files for more about ignoring files.\n\n# Compiled output\n/dist\n/tmp\n/out-tsc\n/bazel-out\n\n# Node\n/node_modules\nnpm-debug.log\nyarn-error.log\n\n# IDEs and editors\n.idea/\n.project\n.classpath\n.c9/\n*.launch\n.settings/\n*.sublime-workspace\n\n# Visual Studio Code\n.vscode/*\n!.vscode/settings.json\n!.vscode/tasks.json\n!.vscode/launch.json\n!.vscode/extensions.json\n!.vscode/mcp.json\n.history/*\n\n# Miscellaneous\n/.angular/cache\n.sass-cache/\n/connect.lock\n/coverage\n/libpeerconnection.log\ntestem.log\n/typings\n__screenshots__/\n\n# System files\n.DS_Store\nThumbs.db\n",
    ".prettierrc":
      '{\n  "printWidth": 100,\n  "singleQuote": true,\n  "overrides": [\n    {\n      "files": "*.html",\n      "options": {\n        "parser": "angular"\n      }\n    }\n  ]\n}\n',
    "README.md":
      "# NgApp\n\nThis project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.2.\n\n## Development server\n\nTo start a local development server, run:\n\n```bash\nng serve\n```\n\nOnce the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.\n\n## Code scaffolding\n\nAngular CLI includes powerful code scaffolding tools. To generate a new component, run:\n\n```bash\nng generate component component-name\n```\n\nFor a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:\n\n```bash\nng generate --help\n```\n\n## Building\n\nTo build the project run:\n\n```bash\nng build\n```\n\nThis will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.\n\n## Running unit tests\n\nTo execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:\n\n```bash\nng test\n```\n\n## Running end-to-end tests\n\nFor end-to-end (e2e) testing, run:\n\n```bash\nng e2e\n```\n\nAngular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.\n\n## Additional Resources\n\nFor more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.\n",
    "package.json":
      '{\n  "name": "ng-app",\n  "version": "0.0.0",\n  "scripts": {\n    "ng": "ng",\n    "start": "ng serve",\n    "build": "ng build",\n    "watch": "ng build --watch --configuration development",\n    "test": "ng test"\n  },\n  "private": true,\n  "packageManager": "npm@11.19.0",\n  "dependencies": {\n    "@angular/common": "^22.2.0",\n    "@angular/compiler": "^22.2.0",\n    "@angular/core": "^22.2.0",\n    "@angular/forms": "^22.2.0",\n    "@angular/platform-browser": "^22.2.0",\n    "@angular/router": "^22.2.0",\n    "rxjs": "~7.8.0",\n    "tslib": "^2.3.0"\n  },\n  "devDependencies": {\n    "@angular/build": "^22.2.2",\n    "@angular/cli": "^22.2.2",\n    "@angular/compiler-cli": "^22.2.0",\n    "jsdom": "^30.0.0",\n    "prettier": "^3.8.1",\n    "typescript": "~6.0.2",\n    "vitest": "^5.0.0"\n  }\n}',
  },
};
