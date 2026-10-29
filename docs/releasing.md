# Releasing

The sequence for a temple-bar release from this repo. Read it before
planning a release wave or briefing any of its steps. Each numbered step is
its own pull request where it is one, merged in order with `pnpm merge <N>`.
Why the baseline comes before the pin:
[ADR 0017](adr/0017-running-and-merging-workspaces.md), decision 79.

1. **Prepare the release.** One pull request,
   `chore(release): prepare <version>`, sets `version` in
   `packages/temple-bar/package.json` and
   `packages/create-temple-bar/package.json` to the same number: the release
   workflow refuses packages out of lockstep.
2. **Tag and publish, only on the maintainer's yes.** Pushing the tag
   `v<version>` on that commit of `main` starts `release.yml`: full CI, the
   release tier, then both packages staged on npm and a draft GitHub Release
   drafted from the commit subjects. The maintainer approves each staged
   package with 2FA, finishes the draft's notes (Upgrading, Incidents fixed,
   and the guides this release changed), then runs
   `pnpm release:publish v<version>`.
3. **Freeze the baseline.** A data-only pull request,
   `chore(test): freeze <version>'s published output in the baseline`, adds
   the release to `packages/temple-bar/src/testing/published-output/`,
   following its README: download the npm tarball, check its SHA-512 against
   npm's record, then record its metadata in `releases.json` and its output in
   `outputs.json` (and any new fixture). Never regenerate from the working
   tree. Until this merges, every branch cut from `main` fails the gate with:

   ```text
   v<version>: refresh the frozen published-output baseline from its integrity-verified npm package before changing templates
   ```

   That message means this step was missed.

4. **Bump the pin.** Its own pull request, `chore: pin temple-bar <version>`,
   changes the `@londontypescript/temple-bar` version in the root
   `package.json`, its lockfile entry (specifier, version and integrity,
   matching npm's), and the pinned version in `docs/enforcement.md`. This
   repo's `AGENTS.md` and guides take the release's new text here, never
   earlier. If the new block pushes `AGENTS.md` past the gate's 200 lines or
   32 KiB, move this repo's own text to docs, never temple-bar's block.
