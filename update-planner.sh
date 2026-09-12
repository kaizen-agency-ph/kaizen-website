#!/usr/bin/env bash
# Planner update helper.
#
#   1. Save the new .html files into  _incoming/  (in this repo)
#   2. Run  ./update-planner.sh
#   3. Review, then commit & push  (or run with -p to do it for you)
#
# Each file is checked before it is copied, so a wrong or stale file
# can't end up in the wrong place.
set -u

IN="_incoming"
DEST="wedding-planner"
ok=0; bad=0; missing=0

[ -d "$DEST" ] || { echo "Run this from the repo root (where '$DEST' lives)."; exit 1; }
mkdir -p "$IN" "$DEST/offline"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }

has () { grep -q -- "$2" "$1"; }

check_and_copy () {
  local name="$1" dest="$2" kind="$3" role="${4:-}"
  local src="$IN/$name"

  if [ ! -f "$src" ]; then
    grey "  -  $name  (not in $IN, skipped)"
    missing=$((missing+1)); return
  fi

  if ! has "$src" "wp-seatboard"; then
    red   "  X  $name  doesn't look like the planner - not copied"
    bad=$((bad+1)); return
  fi

  if [ "$kind" = "signed" ]; then
    if ! has "$src" "requireAuth"; then
      red "  X  $name  has no login wiring (is this the offline build?) - not copied"
      bad=$((bad+1)); return
    fi
    if ! grep -q "allowedRoles: \[\"$role\"\]" "$src"; then
      red "  X  $name  is not the '$role' build - not copied"
      bad=$((bad+1)); return
    fi
  else
    if has "$src" "requireAuth"; then
      red "  X  $name  contains login wiring (is this the online build?) - not copied"
      bad=$((bad+1)); return
    fi
    if ! has "$src" "@font-face"; then
      red "  X  $name  has no embedded fonts, so it won't work offline - not copied"
      bad=$((bad+1)); return
    fi
  fi

  cp "$src" "$dest"
  green "  OK $name  ->  $dest"
  ok=$((ok+1))
}

echo "Reading from $IN/"
check_and_copy "coordinator.html"         "$DEST/coordinator.html"                 signed  coordinator
check_and_copy "couple.html"              "$DEST/couple.html"                      signed  couple
check_and_copy "coordinator-offline.html" "$DEST/offline/coordinator-offline.html" offline
check_and_copy "couple-offline.html"      "$DEST/offline/couple-offline.html"      offline

echo
if [ "$bad" -gt 0 ]; then
  red "$bad file(s) failed their check and were NOT copied. Nothing else was touched."
  exit 1
fi
if [ "$ok" -eq 0 ]; then
  echo "Nothing to do - put the new .html files in $IN/ first."
  exit 0
fi

echo "Copied $ok file(s), skipped $missing."
echo
git status --short "$DEST"

if [ "${1:-}" = "-p" ]; then
  git add -A "$DEST"
  git commit -m "${2:-Update wedding planner}"
  git push
  rm -f "$IN"/*.html
  echo
  green "Pushed, and $IN/ cleared."
else
  echo
  echo "Looks right? Then:"
  echo "  git add -A $DEST && git commit -m \"Update wedding planner\" && git push"
  echo "  rm -f $IN/*.html     # tidy up once pushed"
fi
