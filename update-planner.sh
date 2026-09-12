#!/usr/bin/env bash
# Copies the newest planner files from Downloads into this repo.
# Usage:  ./update-planner.sh          (then review, commit, push)
#         ./update-planner.sh -p       (also commits and pushes)
set -u

DL="${DOWNLOADS:-/c/Users/PC/Downloads}"
REPO_DIR="wedding-planner"

if [ ! -d "$REPO_DIR" ]; then
  echo "Run this from the root of your repo (the folder containing '$REPO_DIR')."
  exit 1
fi
mkdir -p "$REPO_DIR/offline"

# Picks the most recently modified match, so 'coordinator (1).html' still works.
newest () { ls -t $DL/$1 2>/dev/null | head -1; }

copy_one () {          # $1 = glob in Downloads, $2 = destination path
  local src; src="$(newest "$1")"
  if [ -z "$src" ]; then
    echo "  skip   $2   (no match for $1)"
    return
  fi
  cp "$src" "$2"
  echo "  copied $2   <-  $(basename "$src")"
}

echo "Looking in: $DL"
copy_one 'coordinator*.html'         "$REPO_DIR/coordinator.html"
copy_one 'couple*.html'              "$REPO_DIR/couple.html"
copy_one 'coordinator-offline*.html' "$REPO_DIR/offline/coordinator-offline.html"
copy_one 'couple-offline*.html'      "$REPO_DIR/offline/couple-offline.html"

# The offline globs also match the plain ones, so re-copy the signed-in pair
# from files that do NOT contain "offline" in the name.
for pair in "coordinator" "couple"; do
  src="$(ls -t $DL/${pair}*.html 2>/dev/null | grep -v offline | head -1)"
  [ -n "$src" ] && cp "$src" "$REPO_DIR/${pair}.html"
done

echo
echo "Sanity check (should say 1 for each):"
for f in "$REPO_DIR/coordinator.html" "$REPO_DIR/couple.html"; do
  printf "  %-40s auth:%s  offline-btn:%s\n" "$f" \
    "$(grep -c 'requireAuth' "$f")" "$(grep -c 'wp-dlbtn' "$f" | awk '{print ($1>0)?1:0}')"
done

echo
git status --short "$REPO_DIR"

if [ "${1:-}" = "-p" ]; then
  git add -A "$REPO_DIR"
  git commit -m "Update wedding planner"
  git push
  echo "Pushed."
else
  echo
  echo "Review the list above, then:"
  echo "  git add -A $REPO_DIR && git commit -m \"Update wedding planner\" && git push"
fi
