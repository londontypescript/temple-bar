import { isDeepStrictEqual } from "node:util";
import {
  GATE_SCRIPT,
  PREPARE_SCRIPT,
  isTempleBarPrepare,
} from "../../packages/temple-bar/src/init/package-json.ts";
import { manifest, object, prepareCase } from "./expectation.ts";
import type { Snapshot } from "./snapshot.ts";

const PACKAGE_NAME = "@londontypescript/temple-bar";

export function validateManifest(
  snapshot: Snapshot,
  writtenText: string | undefined,
  packedVersion: string,
  pnpmVersion: string,
): {
  readonly findings: string[];
  readonly information: string[];
} {
  const findings: string[] = [];
  const original = manifest(snapshot.files["package.json"]);
  const written = manifest(writtenText);
  if (original === undefined || written === undefined)
    return {
      findings: ["package.json: expected a JSON object after setup"],
      information: [],
    };
  const scripts = object(original.scripts) ?? {};
  const actualScripts = object(written.scripts) ?? {};
  for (const [key, value] of Object.entries(original)) {
    if (["scripts", "devDependencies"].includes(key)) continue;
    if (!isDeepStrictEqual(written[key], value))
      findings.push(`package.json: preserved field ${key} changed`);
  }
  for (const [key, value] of Object.entries(scripts)) {
    if (key !== "prepare" && !isDeepStrictEqual(actualScripts[key], value))
      findings.push(`package.json: preserved script ${key} changed`);
  }
  for (const [key, value] of Object.entries(
    object(original.devDependencies) ?? {},
  )) {
    if (
      key !== PACKAGE_NAME &&
      !isDeepStrictEqual(object(written.devDependencies)?.[key], value)
    )
      findings.push(`package.json: preserved devDependency ${key} changed`);
  }
  if (actualScripts.gate !== GATE_SCRIPT)
    findings.push(
      `package.json: scripts.gate must be ${JSON.stringify(GATE_SCRIPT)}`,
    );
  if (object(written.devDependencies)?.[PACKAGE_NAME] !== packedVersion)
    findings.push(
      `package.json: ${PACKAGE_NAME} must be exactly ${packedVersion}`,
    );
  const devManager = object(original.devEngines)?.packageManager;
  if (
    !Object.hasOwn(original, "packageManager") &&
    devManager === undefined &&
    written.packageManager !== `pnpm@${pnpmVersion}`
  )
    findings.push(
      `package.json: packageManager must name running pnpm@${pnpmVersion}`,
    );
  const kind = prepareCase(scripts);
  const prepare = actualScripts.prepare;
  if (kind === "absent" && prepare !== PREPARE_SCRIPT)
    findings.push(
      "package.json: new scripts.prepare must be the shipped hook installer",
    );
  if (kind === "keep" && prepare !== scripts.prepare)
    findings.push("package.json: existing temple-bar scripts.prepare changed");
  if (
    kind === "chain" &&
    (!isTempleBarPrepare(prepare) ||
      typeof prepare !== "string" ||
      !prepare.startsWith((scripts.prepare as string).trim()))
  )
    findings.push(
      "package.json: scripts.prepare must preserve its command and chain the hook installer",
    );
  const layout = (text: string) =>
    `indent=${JSON.stringify(/^[ \t]+(?=\S)/m.exec(text)?.[0] ?? "")}, final newline=${String(text.endsWith("\n"))}`;
  return {
    findings,
    information: [
      `package.json layout (information): ${layout(snapshot.files["package.json"] ?? "")} -> ${layout(writtenText ?? "")}`,
    ],
  };
}
