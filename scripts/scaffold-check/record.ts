import { renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScaffoldFixture } from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import type { Snapshot } from "./snapshot.ts";
import type { Recipe } from "./recipes.ts";

export interface Recording {
  readonly fixture: ScaffoldFixture;
  readonly recipe: Recipe;
  readonly snapshot: Snapshot;
  readonly version: string;
  readonly command: string;
}

export function londonDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function moduleText(
  recording: Recording,
  date: string,
  pnpmVersion: string,
  nodeVersion: string,
): string {
  for (const [name, bytes] of Object.entries(recording.snapshot.bytes)) {
    if (
      Buffer.from(recording.snapshot.files[name] ?? "").toString("base64") !==
      bytes
    )
      throw new Error(
        `${recording.fixture.name}: cannot record non-UTF-8 bytes in ${name} as a text fixture`,
      );
  }
  const fixture = {
    name: recording.fixture.name,
    scaffolder: recording.recipe.package,
    version: recording.version,
    command: recording.command,
    recordedOn: date,
    rootEntries: recording.snapshot.rootEntries,
    symlinks: recording.snapshot.symlinks,
    files: recording.snapshot.files,
  };
  return `// Recorded on ${date} from ${recording.recipe.package} ${recording.version}, without installing\n// dependencies, under pnpm ${pnpmVersion} and Node ${nodeVersion}:\n// ${recording.command}\n// Re-recording replaces these strings wholesale; never edit their content.\n\nexport const ${recording.recipe.exportName} = ${JSON.stringify(fixture, null, 2)};\n`;
}

/** All captures finish before recording starts; each replacement is one rename. */
export function writeRecordings(
  recordings: readonly Recording[],
  directory: string,
  date: string,
  pnpmVersion: string,
  nodeVersion: string,
): string[] {
  const writes = recordings.map((recording) => {
    const file = path.join(directory, `${recording.fixture.name}.ts`);
    return {
      file,
      temporary: `${file}.${String(process.pid)}.tmp`,
      content: moduleText(recording, date, pnpmVersion, nodeVersion),
    };
  });
  try {
    for (const entry of writes)
      writeFileSync(entry.temporary, entry.content, { flag: "wx" });
    for (const entry of writes) renameSync(entry.temporary, entry.file);
  } finally {
    for (const entry of writes) rmSync(entry.temporary, { force: true });
  }
  return writes.map((entry) => entry.file);
}
