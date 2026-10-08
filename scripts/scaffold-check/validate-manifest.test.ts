import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { expectation, manifest, object, shippedFiles } from "./expectation.ts";
import { validateManifest } from "./validate-manifest.ts";
import { install, minimalFiles, tempProject } from "./testing.ts";

const scenarios: {
  name: string;
  original?: Record<string, unknown>;
  edit: (pkg: Record<string, unknown>) => void;
  finding: RegExp;
}[] = [
  {
    name: "field",
    edit: (pkg) => {
      pkg.custom = {};
    },
    finding: /preserved field custom changed/,
  },
  {
    name: "script",
    edit: (pkg) => {
      pkg.scripts = { ...object(pkg.scripts), lint: "replaced" };
    },
    finding: /preserved script lint changed/,
  },
  {
    name: "devDependency",
    original: { devDependencies: { tool: "1.2.3" } },
    edit: (pkg) => {
      pkg.devDependencies = { ...object(pkg.devDependencies), tool: "^1.2.3" };
    },
    finding: /preserved devDependency tool changed/,
  },
  {
    name: "gate",
    edit: (pkg) => {
      pkg.scripts = { ...object(pkg.scripts), gate: "other" };
    },
    finding: /scripts.gate must be/,
  },
  {
    name: "packed dependency",
    edit: (pkg) => {
      pkg.devDependencies = { "@londontypescript/temple-bar": "^0.0.9" };
    },
    finding: /must be exactly 0\.0\.9/,
  },
  {
    name: "running pnpm",
    edit: (pkg) => {
      pkg.packageManager = "pnpm@9.0.0";
    },
    finding: /must name running pnpm@10\.34\.5/,
  },
  {
    name: "new prepare",
    edit: (pkg) => {
      pkg.scripts = { ...object(pkg.scripts), prepare: "other" };
    },
    finding: /new scripts.prepare must be/,
  },
  {
    name: "already installed prepare",
    original: { scripts: { prepare: " temple-bar hook install " } },
    edit: (pkg) => {
      pkg.scripts = {
        ...object(pkg.scripts),
        prepare: "temple-bar hook install",
      };
    },
    finding: /existing temple-bar scripts.prepare changed/,
  },
  {
    name: "already chained prepare",
    original: { scripts: { prepare: "sync && temple-bar hook install" } },
    edit: (pkg) => {
      pkg.scripts = {
        ...object(pkg.scripts),
        prepare: "other && temple-bar hook install",
      };
    },
    finding: /existing temple-bar scripts.prepare changed/,
  },
  {
    name: "chained prepare prefix",
    original: { scripts: { prepare: " sync || echo '' " } },
    edit: (pkg) => {
      pkg.scripts = {
        ...object(pkg.scripts),
        prepare: "other && temple-bar hook install",
      };
    },
    finding: /must preserve its command and chain/,
  },
  {
    name: "chained prepare acceptance",
    original: { scripts: { prepare: "sync" } },
    edit: (pkg) => {
      pkg.scripts = { ...object(pkg.scripts), prepare: "sync && broken" };
    },
    finding: /must preserve its command and chain/,
  },
];

for (const scenario of scenarios) {
  void test(`manifest validator catches ${scenario.name} with its own finding`, () => {
    const original = {
      ...manifest(minimalFiles["package.json"]),
      ...scenario.original,
    };
    const project = tempProject({
      ...minimalFiles,
      "package.json": JSON.stringify(original),
    });
    try {
      install(project.dir);
      const writtenText = () =>
        readFileSync(path.join(project.dir, "package.json"), "utf8");
      assert.deepEqual(
        validateManifest(project.snapshot, writtenText(), "0.0.9", "10.34.5")
          .findings,
        [],
        "valid install is accepted before mutation",
      );
      const written = manifest(writtenText());
      assert.ok(written);
      scenario.edit(written);
      writeFileSync(
        path.join(project.dir, "package.json"),
        JSON.stringify(written),
      );
      assert.ok(
        validateManifest(
          project.snapshot,
          writtenText(),
          "0.0.9",
          "10.34.5",
        ).findings.some((finding) => scenario.finding.test(finding)),
        `${scenario.name}: missing its own finding ${String(scenario.finding)}`,
      );
    } finally {
      project.close();
    }
  });
}

void test("manifest layout is informational and a named devEngines pnpm needs no new field", () => {
  const project = tempProject({
    "package.json":
      '{\n\t"devEngines":{"packageManager":{"name":"pnpm","version":"10.0.0"}},\n\t"scripts": {}\n}',
    ".gitignore": "node_modules/\n",
  });
  try {
    install(project.dir);
    const written = readFileSync(
      path.join(project.dir, "package.json"),
      "utf8",
    );
    const result = validateManifest(
      project.snapshot,
      written,
      "0.0.9",
      "10.34.5",
    );
    assert.deepEqual(
      result.findings,
      [],
      "named devEngines and changed layout are accepted",
    );
    assert.match(
      result.information.join("\n"),
      /indent="\\t", final newline=false -> indent=" {2}", final newline=true/,
      "layout difference reported as information",
    );
    assert.equal(manifest(written)?.packageManager, undefined);
    assert.match(
      validateManifest(
        project.snapshot,
        "broken",
        "0.0.9",
        "10.34.5",
      ).findings.join("\n"),
      /expected a JSON object after setup/,
      "invalid output gets a finding rather than throwing",
    );
  } finally {
    project.close();
  }
});

for (const value of [
  "",
  42,
  "echo ok # comment",
  "echo a\necho b",
  "echo a\recho b",
  "cmd &",
  "cmd;",
  "cmd |",
  " \n ",
]) {
  void test(`unsafe prepare is no expectation: ${JSON.stringify(value)}`, () => {
    const project = tempProject({
      "package.json": JSON.stringify({ scripts: { prepare: value } }),
    });
    try {
      assert.ok(
        expectation(project.snapshot).unknown.some((finding) =>
          finding.startsWith("scripts.prepare cannot be chained:"),
        ),
        "unsafe prepare needs an explicit expectation",
      );
    } finally {
      project.close();
    }
  });
}

void test("foreign devEngines and foreign CLAUDE links are no expectation, not launcher refusals", () => {
  const project = tempProject(
    {
      "package.json":
        '{"devEngines":{"packageManager":{"name":"npm","version":"11.99.0"}}}',
    },
    { "CLAUDE.md": "elsewhere.md" },
  );
  try {
    const result = expectation(project.snapshot);
    assert.equal(
      result.refusal,
      undefined,
      "devEngines alone does not stop the launcher",
    );
    assert.ok(
      result.unknown.some((finding) =>
        /devEngines.packageManager/.test(finding),
      ),
      "foreign devEngines named",
    );
    assert.ok(
      result.unknown.some((finding) =>
        /CLAUDE.md links to "elsewhere.md"/.test(finding),
      ),
      "foreign CLAUDE link named",
    );
  } finally {
    project.close();
  }
});

for (const file of shippedFiles) {
  void test(`existing ${file.path} is no expectation`, () => {
    const project = tempProject({
      "package.json": "{}",
      [file.path]: "existing\n",
    });
    try {
      assert.ok(
        expectation(project.snapshot).unknown.includes(
          `${file.path} already exists`,
        ),
        "existing companion or workflow needs deliberate expectations",
      );
    } finally {
      project.close();
    }
  });
}
