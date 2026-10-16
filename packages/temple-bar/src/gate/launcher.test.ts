// Which package manager the gate starts again, and how, for every shape
// npm_execpath can take. Windows' rules are checked on every platform, by
// passing the platform in.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createFakeContext, createFakeFs } from "../testing/fakes.ts";
import { launch, resolveLauncher, type Launcher } from "./launcher.ts";

/** npm_execpath as a path both rule sets read as absolute: forward
 * slashes, so Linux's and macOS's rules accept it on a Windows host too.
 * The fake filesystem stores it in the host's form, which is what the
 * resolver answers, so expectations use path.normalize. */
const at = (...parts: string[]) => path.posix.join("/tools", ...parts);

function setUp(
  execPath: string | undefined,
  files: readonly string[] = [],
  configure?: (fs: ReturnType<typeof createFakeFs>) => void,
) {
  const fs = createFakeFs(Object.fromEntries(files.map((file) => [file, ""])));
  configure?.(fs);
  return createFakeContext({
    fs,
    env: execPath === undefined ? {} : { npm_execpath: execPath },
  });
}

async function resolve(
  execPath: string | undefined,
  platform: NodeJS.Platform,
  files: readonly string[] = [],
  configure?: (fs: ReturnType<typeof createFakeFs>) => void,
): Promise<Launcher> {
  return resolveLauncher(setUp(execPath, files, configure), platform);
}

function refusedFor(launcher: Launcher): string {
  if (launcher.kind !== "refused") {
    assert.fail(`expected a refusal, got ${JSON.stringify(launcher)}`);
  }
  return launcher.reason;
}

void test("launcher: no npm_execpath means the gate was run by hand", async () => {
  assert.deepEqual(await resolve(undefined, "linux"), { kind: "absent" });
  assert.deepEqual(await resolve("", "win32"), { kind: "absent" });
});

for (const name of [
  "pnpm.cjs",
  "pnpm.js",
  "pnpm.mjs",
  "PNPM.CJS",
  "npm-cli.js",
]) {
  for (const platform of ["linux", "darwin", "win32"] as const) {
    void test(`launcher: ${name} on ${platform} runs through the Node running the gate`, async () => {
      const entry = at("bin", name);
      const launcher = await resolve(entry, platform, [entry]);
      assert.deepEqual(launcher, {
        kind: "javascript",
        path: path.normalize(entry),
      });
      assert.ok(launcher.kind === "javascript");
      assert.deepEqual(launch(launcher, ["run", "lint"]), {
        command: process.execPath,
        args: [path.normalize(entry), "run", "lint"],
      });
    });
  }
}

for (const [platform, name] of [
  ["linux", "pnpm"],
  ["darwin", "pnpm"],
  ["darwin", "PNPM"],
  ["win32", "pnpm.exe"],
  ["win32", "PNPM.EXE"],
] as const) {
  void test(`launcher: ${name} on ${platform} is pnpm's standalone executable, run directly`, async () => {
    const binary = at(name);
    const launcher = await resolve(binary, platform, [binary]);
    assert.deepEqual(launcher, {
      kind: "native",
      path: path.normalize(binary),
    });
    assert.ok(launcher.kind === "native");
    assert.deepEqual(launch(launcher, ["list", "--json"]), {
      command: path.normalize(binary),
      args: ["list", "--json"],
    });
  });
}

void test("launcher: a link is followed, and its target decides the form and is what runs", async () => {
  const link = path.posix.join("/usr", "local", "bin", "pnpm");
  const binary = at("pnpm", "pnpm");
  const native = await resolve(link, "linux", [binary], (fs) => {
    fs.realpaths.set(link, binary);
  });
  assert.deepEqual(native, { kind: "native", path: path.normalize(binary) });

  // An extensionless link to pnpm's JavaScript entry still goes through
  // Node, never through whatever Node its shebang names.
  const entry = at("pnpm", "bin", "pnpm.cjs");
  const javascript = await resolve(link, "linux", [entry], (fs) => {
    fs.realpaths.set(link, entry);
  });
  assert.deepEqual(javascript, {
    kind: "javascript",
    path: path.normalize(entry),
  });
});

void test("launcher: a broken link, a link loop or a link to a folder is refused", async () => {
  const link = path.posix.join("/usr", "local", "bin", "pnpm");
  const broken = await resolve(link, "linux", [], (fs) => {
    fs.linkTargets.set(link, at("gone"));
  });
  assert.match(refusedFor(broken), /doesn't exist$/);

  const loop = await resolve(link, "linux", [], (fs) => {
    fs.realpathErrors.set(
      path.normalize(link),
      Object.assign(new Error("ELOOP: too many symbolic links"), {
        code: "ELOOP",
      }),
    );
  });
  assert.match(refusedFor(loop), /can't be resolved: ELOOP/);

  const folder = await resolve(link, "linux", [], (fs) => {
    fs.directories.add(at("pnpm"));
    fs.realpaths.set(link, at("pnpm"));
  });
  assert.match(refusedFor(folder), /isn't a file$/);
});

void test("launcher: a relative path is refused, before anything is read", async () => {
  for (const [given, platform] of [
    ["pnpm", "linux"],
    ["./pnpm", "linux"],
    ["bin/pnpm.cjs", "darwin"],
    ["pnpm.exe", "win32"],
    // Relative to drive C's current folder, not to its root.
    ["C:pnpm.exe", "win32"],
  ] as const) {
    let read = false;
    const reason = refusedFor(
      await resolve(given, platform, [], (fs) => {
        const realpath = fs.realpath.bind(fs);
        fs.realpath = (target) => {
          read = true;
          return realpath(target);
        };
      }),
    );
    assert.equal(reason, `npm_execpath (${given}) isn't an absolute path`);
    assert.equal(read, false, given);
  }
});

void test("launcher: a shim, another binary or the wrong platform's pnpm is refused, by name", async () => {
  for (const [name, platform] of [
    ["pnpm.cmd", "win32"],
    ["pnpm.bat", "win32"],
    ["pnpm.ps1", "win32"],
    ["pnpm.exe", "linux"],
    ["pnpm.exe", "darwin"],
    ["pnpm", "win32"],
    ["true", "linux"],
    ["pnpm-real", "darwin"],
  ] as const) {
    const file = at(name);
    assert.equal(
      refusedFor(await resolve(file, platform, [file])),
      `npm_execpath (${file}) names ${name}, which can't be started without a shell`,
    );
  }
});

void test("launcher: a missing path or a folder is refused", async () => {
  const missing = at("pnpm");
  assert.match(
    refusedFor(await resolve(missing, "linux")),
    /\) doesn't exist$/,
  );
  const folder = at("pnpm");
  const reason = refusedFor(
    await resolve(folder, "linux", [], (fs) => {
      fs.directories.add(folder);
    }),
  );
  assert.match(reason, /isn't a file$/);
});

void test("launcher: an error reading the path is a refusal, never a crash", async () => {
  const binary = at("pnpm");
  const launcher = await resolve(binary, "linux", [binary], (fs) => {
    fs.classificationErrors.set(
      path.normalize(binary),
      Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      }),
    );
  });
  assert.match(refusedFor(launcher), /can't be read: EACCES/);
});
