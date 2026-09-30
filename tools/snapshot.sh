#!/bin/sh
# Publish the tree at HEAD to the public repository as ONE commit.
#
# The development repository keeps its full history private. The public
# repository (github.com/JoshuaLevi/pocket-diorama) gets a flat history: the
# first run makes a root commit out of HEAD's tree, every later run adds one
# commit on top of whatever is there, with the same tree as HEAD. Nothing is
# force-pushed and nothing is rewritten; a snapshot is an ordinary fast-forward.
#
#   tools/snapshot.sh "Pocket Diorama 1.0.0, as submitted"
#
# The remote is called "public" (override with SNAPSHOT_REMOTE). Add it once:
#
#   git remote add public https://github.com/JoshuaLevi/pocket-diorama.git
#
# Git LFS: the four LFS objects travel with the push through git-lfs's pre-push
# hook, and the script pushes them again explicitly, because a snapshot without
# the two Lens Studio packages does not open in Lens Studio.
set -eu

REMOTE="${SNAPSHOT_REMOTE:-public}"
BRANCH="${SNAPSHOT_BRANCH:-main}"
MESSAGE="${1:-}"
if [ -z "$MESSAGE" ]; then
  echo "usage: tools/snapshot.sh \"commit message\"" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "SNAPSHOT: the working tree has uncommitted changes; commit them first." >&2
  exit 1
fi

# The rule the whole project rests on, checked once more at the door.
LEAKED="$(git ls-files | grep -Ei '\.(gb|gbc|sav|sgm|rom)$|^Assets/Generated/' || true)"
if [ -n "$LEAKED" ]; then
  echo "SNAPSHOT: ROM-derived files are tracked; refusing to publish:" >&2
  echo "$LEAKED" >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "SNAPSHOT: no remote named $REMOTE; add it first (see the header)." >&2
  exit 1
fi

PARENT=""
if git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null; then
  PARENT="$(git rev-parse FETCH_HEAD)"
  if [ "$(git rev-parse "$PARENT^{tree}")" = "$(git rev-parse 'HEAD^{tree}')" ]; then
    echo "SNAPSHOT: $REMOTE/$BRANCH already carries this exact tree; nothing to do."
    exit 0
  fi
fi

TREE="$(git rev-parse 'HEAD^{tree}')"
BODY="$(printf '%s\n\nSnapshot of the development tree at %s.\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' \
  "$MESSAGE" "$(git rev-parse --short HEAD)")"
if [ -n "$PARENT" ]; then
  SHA="$(printf '%s' "$BODY" | git commit-tree "$TREE" -p "$PARENT")"
else
  SHA="$(printf '%s' "$BODY" | git commit-tree "$TREE")"
fi

git push "$REMOTE" "$SHA:refs/heads/$BRANCH"
git lfs push "$REMOTE" "$SHA" >/dev/null 2>&1 || git lfs push "$REMOTE" "$BRANCH"

echo "SNAPSHOT: $REMOTE/$BRANCH is now $(git rev-parse --short "$SHA") (tree of $(git rev-parse --short HEAD))"
