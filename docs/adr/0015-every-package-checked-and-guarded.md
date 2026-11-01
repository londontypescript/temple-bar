# ADR 0015: In a workspace, every package is checked and guarded

Date: 2026-10-11, revised 2026-11-01 (decision 66: a catalog-only change
passes). Status: accepted (plan decisions 63 to 67 for 0.1.0;
[#311](https://github.com/londontypescript/temple-bar/issues/311),
[#312](https://github.com/londontypescript/temple-bar/issues/312),
[#285](https://github.com/londontypescript/temple-bar/issues/285); the
revision: [#457](https://github.com/londontypescript/temple-bar/issues/457)).

## Context

The gate reads the root `package.json` and runs its four scripts:
`typecheck`, `lint`, `format:check` and `test`
([ADR 0007](0007-what-the-gate-checks.md)). The judge guards the root's
`gate` and four scripts, its temple-bar pin, and pnpm's install settings
([ADR 0011](0011-which-checks-judge-a-pull-request.md)). In a pnpm workspace
that leaves every other package outside both. A trial on a small workspace
([#309](https://github.com/londontypescript/temple-bar/issues/309#issuecomment-6103677235))
showed three pull requests passing both gate and judge:

- one adding a package with no scripts
- one removing a package's `typecheck`
- one replacing it with `node --version`

Two gaps also exist at the root already, and every package multiplies them:

- **Delegation.** A guarded `test` can call an unguarded `test:unit`, which
  then changes freely.
- **Install-time scripts.** `preinstall`, `install`, `postinstall` and
  `prepare` run during CI's `pnpm install`, before the gate, and can replace
  the installed temple-bar. A workspace package's own `postinstall` runs on
  install too (checked with pnpm 10.34.5).

Codex reviewed the first design adversarially, and its findings shaped the
decisions below. The trial notes are at
[#366](https://github.com/londontypescript/temple-bar/issues/366).

**The revision (2026-11-01).** grand-union, the first adopter, switched
Dependabot on and within minutes had two pull requests that only bumped
versions in the `catalog:` of `pnpm-workspace.yaml`
([#457](https://github.com/londontypescript/temple-bar/issues/457)). Decision
66 made each the maintainer's merge, as every bump in every adopter would be.
A catalog bump cannot change what a check does, so the judge now tells one
apart, by the text grammar below, which ChatGPT Sol 6.1 reviewed adversarially.

## Decisions

**Decision 63: the same promise, in every package.** The judge guards the
files that decide whether and how the gate runs, now in every package, and
nothing more. It still does not cover:

- weakening inside the code, such as a skipped test or a disable comment
- tool configs other than `temple-bar.config.json` (decision 58)
- helper files a script calls
- what a script does while it runs
- where temple-bar's own dependencies' tarballs come from (see ADR 0011)

The weakening inside code and configs is
[#52](https://github.com/londontypescript/temple-bar/issues/52)'s to close,
in the gate, not the judge. The judge can say a file changed, not whether
the change made a check weaker.

**Decision 64: the judge guards every script of every tracked
`package.json`.** Any added, changed or removed script, in any manifest
outside `node_modules`, is a finding. Guarding the whole map closes
delegation and every install-time script without parsing shell commands.
Parsing would miss `npm-run-all`, `concurrently` and many shell forms. The
cost: changing any script, `dev` or `build` included, is the maintainer's
merge. The judge's record will show whether that is too often, as it did for
configs.

**Decision 65: a new package needs the maintainer.** An added `package.json`
with scripts is a finding, so each new target's first checks are reviewed.
The gate can only refuse obvious no-ops. `"test": "node --version"` passes
it, and a new package's scripts run in CI like any other. A deleted
manifest, or one renamed away, is a finding too: removing a package removes
its checks. A rename is judged as the old path deleted and the new one added.

**Decision 66: `pnpm-workspace.yaml` stays guarded as a whole file, except a
catalog-only change (revised 2026-11-01).** The first design let its package
list grow without the maintainer. That proved unsafe:

- Adding a pattern can narrow what pnpm selects, by moving from pnpm's
  default list to an explicit one, or by adding a negation.
- Separating the list from the install settings needs a YAML reader in the
  judge.

After decision 65 every new package is the maintainer's anyway, so the split
would save no merges. A new folder under an existing pattern doesn't touch
this file.

The revision admits one change without the maintainer: in the root file's
default `catalog:` block, a version value changed or an entry added, under
"The catalog grammar" below. Everything else about the file is as before:
removing an entry, touching temple-bar's own entry, a named catalog, the
package list, a setting, a comment outside the block, or any text the
grammar doesn't read, is a finding. The grammar is text, not YAML: the judge
reads no YAML library (as for the lockfile) and refuses what it can't read.
The maintainer decided the shape on 2026-10-30 (changed values and added
entries pass; removals stay a finding; temple-bar's own entry always
guarded; duplicate sections or keys, quoted keys and named catalogs refused)
and amended one point on 2026-11-01: a single-quoted lowercase scoped key,
`'@scope/name'`, is admitted, because YAML cannot write a scoped name any
other way and half of grand-union's catalog is scoped. Double quotes stay
refused: they process escapes, which a parser-free judge can't safely read.
New packages still need the maintainer in 0.3.0; a guarded script template
that would let a new package's scripts pass is a later issue.

**Decision 67: the gate checks every package, and checks its own list
against git.**

- The gate lists packages through the pnpm that started it (`npm_execpath`),
  never through a `pnpm` the project's PATH might shadow.
- It requires and runs the four scripts in each package's folder: the root
  first, then each package in path order. Every script runs, whatever the
  others return.
- A missing or obviously empty script fails the gate, naming the package.
- Any tracked `package.json` that is neither the root nor in pnpm's list
  fails the gate. That catches a package left outside the patterns, using
  evidence pnpm does not control. There is no exception list until a project
  needs one; if one is ever added, it belongs in `temple-bar.config.json`,
  which the judge guards.
- The root may still run all packages' checks from its own scripts. The gate
  doesn't depend on it.

## The catalog grammar

A change to `pnpm-workspace.yaml` passes only when every rule here holds.
One rule failing is a finding that names the rule, so the judge's record
shows which refusals are common. "Space" means U+0020 and nothing else; a
line is the text between line feeds, and the text after the last line feed
is a line too, so a final newline added or removed is a change like any other.

### When the exception applies

- The path is exactly `pnpm-workspace.yaml` at the repository root. A copy
  at any other depth, or a root name that only folds to it
  (`PNPM-WORKSPACE.YAML`), stays guarded whole, and the exception is off
  when the head holds such a root name beside the real one.
- Both sides are regular files of the same mode, read whole. Absent on either
  side, a symlink, a submodule, a folder, a mode change or an unreadable side
  is a finding, as for every guarded file.
- Neither side holds a carriage return, a tab, a control character other than
  the line feed, U+2028, U+2029 or U+FEFF. Other non-ASCII text may appear
  only in a comment line or outside the block.

### The marker and the block

- Each side has exactly one line that is exactly `catalog:` at column 0: no
  spaces, no comment, no anchor. No such line, or two or more, is a finding
  (a block added, a section repeated, `catalog: # default`).
- The block runs from the line after the marker to the first line whose
  first character is neither a space nor `#` (exclusive), or the file's end.
- The text before the marker, and the text after the block, are byte for
  byte identical on the two sides. Any difference there is "changed outside
  the catalog".
- The marker is proved a root key of the one document pnpm reads, by a scan
  of the lines before it. Each is empty, a comment line (spaces then `#`),
  `---` alone when it is the first line that is neither, or a line that,
  scanned left to right outside quotes, opens and closes every `'`, `"`,
  `{` and `[` on the same line, never goes below zero on `}` or `]`, and
  stops at a `#` that follows a space. A backslash anywhere scanned, a `%`
  or `...` at column 0, or a second `---`, fails the scan. That is all the
  YAML the judge understands, and enough to show that no multi-line quoted
  scalar, flow collection or second document holds the marker: ChatGPT Sol
  6.1 showed `{x-note: "` on one line and `catalog:` on the next passing as
  a catalog change without it.

### The entry

Every line of the block, on both sides, is one of three things, or the side
is "not a catalog the judge can read" and that is the finding:

- empty;
- a comment line: zero or more spaces, then `#`, then anything;
- an entry: two spaces, a key, a colon, one space, a value, then the end of
  the line. No trailing space, no trailing comment, no other indentation.

The key is a package name in one of two forms, and no other:

- plain, unscoped: `[a-z0-9][a-z0-9._-]*`, written bare, such as `react`;
- single-quoted, scoped: `'@` name `/` name `'`, with each name as above,
  such as `'@types/react'`. The quotes hold nothing else: no `''`, no `\`,
  no space, no second `/`.

A whole key is at most 214 characters. A quoted unscoped key (`'react'`), a
double-quoted key, a bare scoped key, an uppercase letter, a non-ASCII
character or a trailing space inside the quotes is outside the grammar. Keys
are compared as their unquoted text; file-name folding never applies to
them. The same key twice in one block, on either side, is a finding.

The value is a version, optionally led by `^` or `~`: `N.N.N`, each `N` a
`0` or digits without a leading zero, with an optional prerelease
`-ident(.ident)*` of `[0-9A-Za-z-]`. Nothing else: no `npm:`, `file:`,
`link:`, `workspace:`, `catalog:`, URL, git address, tag, `*`, `x`, `>=`,
`||`, build metadata or quotes. A value that passes names a version of the
same package on the registry, which is what a catalog bump does.

### Comparing the two sides

The block's lines are walked in order on both sides at once. At each step
the pair is one of:

- the same line, byte for byte: both advance;
- two entries with the same key and different values: a changed value, both
  advance;
- a head entry whose key appears nowhere in the base block: an added entry,
  the head advances alone.

Anything else is a finding: a base line with no match (an entry removed or
moved, a comment or empty line that differs), a head line that is neither
the base's line nor an addition. Base lines left over at the end are
removals; head lines left over must each be additions.

Then, over the changed and added entries: a key containing
`@londontypescript/temple-bar` is temple-bar's own, and any change to it,
including adding it, is a finding (`manifests.ts` reads the same name). The
grammar already refuses the look-alikes: a trailing space inside the quotes,
another case, a third path segment.

### What makes a catalog change inert

A catalog entry reaches a package only through a `catalog:` reference in a
manifest's own dependency fields, and that is the project's dependency, not
temple-bar's: pnpm resolves temple-bar's dependencies (today knip and
markdownlint) from temple-bar's own manifest. Two things can map the catalog
onto them, and the exception is off when the head holds either:

- **An override that reads the catalog.** pnpm 10.34.5 resolves `catalog:`
  inside override values (`parseOverrides`), and `$name` makes an override
  follow the root manifest's own spec, which may be `catalog:`. So the text
  outside the block must not contain `catalog:` anywhere (an `overrides:`
  section of the workspace file), and the root `package.json` at the head
  must be a regular, valid manifest in which no string value under
  `overrides`, `resolutions` or `pnpm`, at any depth, contains `catalog:` or
  starts with `$`. A root manifest absent, unreadable or invalid turns the
  exception off: unknown is never inert.
- **Code that runs at install.** A pnpmfile can rewrite any manifest from
  any input. The exception is off when the head holds a `.pnpmfile.*` at any
  depth, an `.npmrc` at any depth whose text contains `pnpmfile`, or the
  word `pnpmfile` outside the block of the workspace file.

Neither costs an adopter anything until used; then it is the maintainer's
merge, and the finding says which rule.

### One verdict in three places

The comparison stays pure (`judge/changes.ts`): the readers hand it each
side's text, as they do for manifests and the lockfile, so `readsText` in
`guarded-paths.ts` grows to the root workspace file. With the changes, the
readers hand it the facts above about the head: the root manifest's state,
whether a pnpmfile or a folded root name exists, and each `.npmrc`'s text.
GitHub's trees supply them to the judge, git to `ready` and `merge`; a fact
a reader can't establish is handed over as unknown, which turns the
exception off. The judge-agreement test covers every example in this ADR
through both readers. When the change passes, the judge's success line says
it was a catalog-only change, so the record shows the exception at work.

## What the judge reads, and how it fails

These follow from the decisions, apart from two the maintainer chose on
2026-10-15 while the judge was built: comparing two fixed trees, and the
package-manager fields in every package.

- **Two fixed trees, not GitHub's file list (chosen 2026-10-15).** The
  judge reads the pull request's head commit and the base branch's tip,
  then each commit's whole tree, and compares the guarded paths by mode and
  object id. A path on one side only, or with another mode or id, changed;
  a rename is the old path gone and the new one there. A tree GitHub cuts
  short is no answer. Afterwards it reads the pull request and the base
  branch again: if either moved, it can't judge and fails. GitHub's list of
  a pull request's files can't be asked for a given commit, so a list read
  while the head moves away and back can describe a commit neither read
  names, and no count or check of the list can tell. Commits never change,
  so judging two named commits judges exactly them.
- **Install settings.** The judge also guards the `packageManager` and
  `devEngines` fields in every `package.json` (chosen 2026-10-15: pnpm
  honours a package's own `devEngines` when it runs that package's
  scripts), the root's `pnpm` field, and `.npmrc`, `.pnpmfile.*` and
  `pnpm-workspace.yaml` at any depth. The root workspace file is the one
  guarded path read as text under its own grammar; the rest are judged by
  the fact of a change.
- **Names as a checkout reads them.** Checkouts on Windows and macOS ignore
  letter case, so `Package.json` and `.NPMRC` count as the real files. A
  `package.json` is left out only under a folder named exactly
  `node_modules`; install settings never are.
- **Regular files only.** A guarded path that isn't a regular file on the
  pull request's side (a symlink, a submodule or a folder) is a finding,
  whether or not the pull request changed it, and so is a change of mode.
  Otherwise a manifest made a symlink could later follow a file the judge
  doesn't guard.
- **Fail closed.** Every manifest is read as absent, valid, invalid or
  unreadable, by the judge and by `ready` and `merge` alike. Unreadable never
  counts as absent, and invalid on the pull request's side is a finding. Any
  answer from GitHub that isn't the documented shape is a failure to read,
  never an empty answer.
- **Unused code.** knip still runs once at the root, where it sees every
  package. Entry exports are judged as they are today. A project whose
  entries knip's plugins don't find declares them in its own knip config,
  which decision 58 leaves to the project.

## Consequences

- Each new target, and each script change, is an admin merge. Ordinary code
  changes inside packages are not.
- A Dependabot catalog bump merges through `temple-bar merge` without the
  maintainer; both of grand-union's evidence pull requests pass.
- A catalog in another style (four-space indent, trailing comments, wider
  ranges, a legacy uppercase name) never passes until rewritten; the finding
  says why.
- When this repo pins 0.1.0, `packages/temple-bar` and
  `packages/create-temple-bar` each need the four scripts.
- [#285](https://github.com/londontypescript/temple-bar/issues/285) closes
  with decision 64.

## The failure each promise stops

Phases 5 and 6 add a test for each; 0.3.0's phase E adds the catalog rows.

| Pull request                                                  | Stopped by  | Decision      |
| ------------------------------------------------------------- | ----------- | ------------- |
| Adds a package with no scripts                                | gate        | 67            |
| Removes a package's `typecheck`                               | gate, judge | 64, 67        |
| Replaces a package's `typecheck` with `node --version`        | judge       | 64            |
| Changes an unguarded `test:unit` that `test` calls            | judge       | 64            |
| Adds a `postinstall` to any package                           | judge       | 64            |
| Adds a package whose scripts are real but weak                | judge       | 65            |
| Deletes a package, or renames it away                         | judge       | 65            |
| Adds a negation to `pnpm-workspace.yaml`'s package list       | judge       | 66            |
| Removes a catalog entry, or moves temple-bar's own            | judge       | 66            |
| Bumps a catalog entry an override maps onto temple-bar        | judge       | 66            |
| Leaves a tracked `package.json` outside the workspace list    | gate        | 67            |
| Puts a `pnpm` on the project's PATH that lists fewer packages | gate        | 67            |
| Has a tree GitHub can't list whole                            | judge       | (fail closed) |

## Adversarial examples

Each row is a test in phase E, with this verdict in the judge, `ready` and
`merge`. "Base" is grand-union's file when Dependabot opened its first bump:
`packages:`, a comment, `catalog:` with fourteen entries (seven scoped), then
`strictPeerDependencies: true`.

**Passes** (no finding):

| Head                                                                    | Why                                         |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| grand-union#31 as opened: seven values changed, three under scoped keys | changed values, scoped keys single-quoted   |
| grand-union#30: `vite` bumped, lockfile `catalogs:` and importers moved | lockfile change is not temple-bar's entries |
| `  zod: 4.1.0` appended; `  '@types/node': 24.13.6` inserted mid-block  | added entries                               |
| `  vite: ^8.3.0` to `^8.4.0`; `~5.0.1` to `~5.0.2`                      | a range led by `^` or `~` is a value        |
| `  vitest: 5.0.0-beta.3` to `5.0.0`; `8.3.3` to `8.3.0`                 | prerelease and downgrade are versions       |
| A bump beside unchanged comment and empty lines inside the block        | non-entry lines match byte for byte         |
| Block after `packages:` with `- "packages/*"` and a comment before it   | the quoted item closes on its line          |
| `---` as the file's first line, then the same                           | one document marker, first                  |

**Refused** (a finding naming the rule):

| Head                                                                                                                                          | Rule                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `  ink: 7.1.1` deleted                                                                                                                        | removal                           |
| `vite` moved below `vitest`; a comment line inside the block edited                                                                           | base line unmatched               |
| `'@londontypescript/temple-bar': 0.2.2` bumped, added or removed                                                                              | temple-bar's own entry            |
| `  react: npm:evil@19.3.1`, `file:../x`, `link:`, `workspace:*`, `latest`, `>=19`, `19.x`, `*`, a URL, `github:o/r`                           | value grammar                     |
| `  "@types/react": 19.3.1`; `  'react': 19.3.1`; `  @types/react: 19.3.1`; `  React: 19.3.1`                                                  | key form                          |
| `  '@Types/react'`; `  '@types/react ': 19.3.1`; `  '@a/b''c'`; `  '@a/b\c'`; `  '@a/b/c'`                                                    | key form                          |
| `  vite: 8.3.3 # pinned`; a trailing space; a four-space indent; a tab; `  vite:8.3.3`; `  vite : 8.3.3`; `  vite: '8.3.3'`; a line of spaces | entry shape                       |
| `  react: 19.3.1` added when `react` is already there                                                                                         | duplicate key                     |
| A second `catalog:` section appended; `catalog:` added where none was                                                                         | one marker                        |
| `catalog: # default` with a bump beneath                                                                                                      | no marker, whole file compared    |
| `catalogs:` named catalog bumped                                                                                                              | changed outside the catalog       |
| A `packages:` pattern, a setting, a comment or an empty line changed                                                                          | changed outside the catalog       |
| `{x-note: "` on one line, `catalog:` on the next (Sol's case)                                                                                 | marker scan: quote and brace open |
| `note: "a\"` before the marker; `%YAML 1.2`; a second `---`                                                                                   | marker scan                       |
| `overrides:` with `knip: catalog:` in the file, any bump                                                                                      | `catalog:` outside the block      |
| Root `pnpm.overrides.knip` of `"catalog:"` or `"$typescript"`, any bump                                                                       | an override reads the catalog     |
| Root `package.json` missing or invalid JSON, any bump                                                                                         | unknown is not inert              |
| `.pnpmfile.cjs` at the head, or `.npmrc` naming a `pnpmfile`                                                                                  | code runs at install              |
| CRLF line endings; a BOM added; a final newline added or removed                                                                              | file shape; text outside differs  |
| Mode `100755`; replaced by a symlink; `PNPM-WORKSPACE.YAML` beside it                                                                         | regular files only; folded name   |
| `packages/a/pnpm-workspace.yaml` changed in any way                                                                                           | not the root file, guarded whole  |

## What would end it

- If the judge's record shows script changes making admin merges routine,
  decision 64 narrows to the scripts the gate runs plus install-time
  scripts, and delegation gets another answer.
- If a project needs a package outside pnpm's workspace list, decision 67
  gains an exception list in `temple-bar.config.json`.
- If pnpm ever gives a list of workspace packages that the judge can read
  without running the pull request's code, decision 66's package list can
  be revisited.
- If the record shows catalog refusals that are only style (indent width,
  trailing comments, wider ranges, `catalogs.default`), the grammar can
  grow those forms, each with examples: always from refused to admitted,
  never the reverse without a new review.
- If pnpm changes how overrides, pnpmfiles or catalogs reach a package, the
  "inert" rules are re-derived from its source, as for 10.34.5.
- If a project outgrows one recursive tree listing (GitHub stops at 100,000
  entries or 7 MB), the judge refuses every pull request there; it would
  then read trees folder by folder instead.
