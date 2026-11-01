# Real `git worktree list` output from git 2.34.1

What git 2.34.1, the git Ubuntu 22.04 LTS ships, writes for three
repositories, captured once in a disposable `ubuntu:22.04` container with the
distribution's own git. Every file is byte for byte what git wrote; nothing
was edited. The worktree reader's tests (`../../worktrees.test.ts`) replay it,
because git before 2.36 has no `-z` and its newline format is what the strict
reader must get right.

Each folder holds:

- `porcelain.txt`: stdout of `git worktree list --porcelain` (exit 0).
- `z-stdout.txt`, `z-stderr.txt`, `z-exit.txt`: the same with `-z`, which
  this git rejects with exit 129.
- `gitdir/<id>`: each `<common dir>/worktrees/<id>/gitdir` record: the
  absolute path of the worktree's `.git` and one final newline.
- `common-dir.txt`: `git rev-parse --path-format=absolute --git-common-dir`
  in the primary checkout, with its newline.

The cases:

- `normal/`: a primary checkout and five linked worktrees, on a branch,
  detached, locked with the reason `held by tool pid 42`, locked without a
  reason, and prunable (its folder deleted after `git worktree add`).
- `newline/`: a worktree whose path holds a newline, beside an ordinary one.
  git prints the newline raw, so the strict reader refuses the listing.
- `forged/`: one linked worktree whose path is crafted to read as two whole
  entries in the newline format. Every line is well formed, so only the check
  against the one `gitdir` record catches it.

`git-version.txt` names the git and the system.

## Script

```bash
#!/bin/bash
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq git >/dev/null
git --version > /out/git-version.txt
cat /etc/os-release | grep PRETTY_NAME >> /out/git-version.txt
git config --global user.email t@example.com
git config --global user.name T
git config --global init.defaultBranch main
git config --global advice.detachedHead false

save() { # case-name repo-dir
  local name=$1 repo=$2
  mkdir -p "/out/$name/gitdir"
  git -C "$repo" worktree list --porcelain > "/out/$name/porcelain.txt"
  set +e
  git -C "$repo" worktree list --porcelain -z > "/out/$name/z-stdout.txt" 2> "/out/$name/z-stderr.txt"
  echo $? > "/out/$name/z-exit.txt"
  set -e
  for d in "$repo"/.git/worktrees/*/; do
    id=$(basename "$d")
    cp "$d/gitdir" "/out/$name/gitdir/$id"
  done
  git -C "$repo" rev-parse --path-format=absolute --git-common-dir > "/out/$name/common-dir.txt"
}

# 1. A normal layout: branch, detached, locked with and without reason, prunable.
mkdir -p /work/normal && cd /work/normal
git init -q repo && cd repo
echo a > a && git add a && git commit -qm init
for b in feature locked-reason locked-plain gone; do git branch $b; done
git worktree add -q ../wt-feature feature
git worktree add -q --detach ../wt-detached HEAD
git worktree add -q ../wt-locked-reason locked-reason
git worktree lock --reason "held by tool pid 42" ../wt-locked-reason
git worktree add -q ../wt-locked-plain locked-plain
git worktree lock ../wt-locked-plain
git worktree add -q ../wt-gone gone
rm -rf ../wt-gone
save normal /work/normal/repo

# 2. A worktree whose path holds a newline.
mkdir -p /work/newline && cd /work/newline
git init -q repo && cd repo
echo a > a && git add a && git commit -qm init
git branch nl; git branch plain
git worktree add -q ../wt-plain plain
git worktree add -q "$(printf '../wt\nnewline')" nl
save newline /work/newline/repo

# 3. A path crafted to read as two valid blocks in the newline format.
mkdir -p /work/forged && cd /work/forged
git init -q repo && cd repo
echo a > a && git add a && git commit -qm init
sha=$(git rev-parse HEAD)
git branch real; git branch decoy
git worktree add -q "$(printf "/work/forged/wt-decoy\nHEAD %s\nbranch refs/heads/decoy\n\nworktree /work/forged/wt-fake" "$sha")" real
save forged /work/forged/repo
```
