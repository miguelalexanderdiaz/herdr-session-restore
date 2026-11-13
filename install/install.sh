#!/bin/sh
# Installs this repository's layout or mods into your Herdr home (macOS and Linux; Windows:
# install/install.ps1). The same installer can serve other repositories: only the REPO line
# differs, and what it installs is in install/manifest.
#
#   curl -fsSL https://raw.githubusercontent.com/<REPO>/main/install/install.sh | sh
#   curl -fsSL .../install/install.sh | sh -s -- --yes        no questions
#   install/install.sh [--yes] [--home <dir>] [--uninstall]   from a clone
#
# It follows Herdr's own rules for shared layouts and mods: say what they reach, copy them in,
# merge keys.json asking before it replaces a key you use, `herdr-app check` every mod. A folder
# or layout it replaces is backed up first under <home>/community/<repo>/backup-<time>/;
# --uninstall removes only what it added (and keys you haven't changed since).
set -eu
REPO="miguelalexanderdiaz/herdr-session-restore"
BRANCH="${HERDR_INSTALL_BRANCH:-main}"
TAB="$(printf '\t')"

YES=0 UNINSTALL=0 H="${HERDR_APP_HOME:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --home) [ $# -ge 2 ] || { echo "--home needs a folder" >&2; exit 2; }; H="$2"; shift ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }
# A yes/no question, read from the terminal even when this script arrives through a pipe.
# --yes answers yes; with no terminal the answer is no.
ask() {
  [ "$YES" = 1 ] && return 0
  [ -r /dev/tty ] || return 1
  printf '%s [y/N] ' "$1" > /dev/tty
  read -r reply < /dev/tty || return 1
  case "$reply" in y|Y|yes|Yes|YES) return 0 ;; *) return 1 ;; esac
}

# ---- the files: this clone, or the repository's branch downloaded ----------------------
TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; return 0; }
trap cleanup EXIT INT TERM
SRC=""
case "$0" in *install.sh) [ -f "$(dirname "$0")/manifest" ] && SRC="$(cd "$(dirname "$0")/.." && pwd)" ;; esac
if [ -z "$SRC" ]; then
  TMP="$(mktemp -d)"
  # HERDR_INSTALL_URL: another tarball of the repository (tests use a file:// one).
  url="${HERDR_INSTALL_URL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH}"
  say "Downloading $REPO ($BRANCH)..."
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" | tar -xz -C "$TMP"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$url" | tar -xz -C "$TMP"
  else die "needs curl or wget to download $REPO"; fi
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -f "$SRC/install/manifest" ] || die "the download has no install/manifest"
fi
M="$SRC/install/manifest"
field() { sed -n "s/^$1[[:space:]]\{1,\}//p" "$M" | head -n 1; }
NAME="$(field name)"; MODS="$(field mods)"; BUNDLED="$(field bundled)"; LAYOUTS="$(field layouts)"
SWITCH="$(field switch)"; KEYS="$(field keys)"; PANEL="$(field panel)"
SLUG="${REPO#*/}"

# ---- the Herdr home ------------------------------------------------------------------
if [ -z "$H" ] && command -v herdr-app >/dev/null 2>&1; then
  H="$(herdr-app --help 2>/dev/null | sed -n 's/^Home: \([^ ]*\).*/\1/p' | head -n 1)"
  case "$H" in "~"*) H="$HOME${H#\~}" ;; esac
fi
[ -n "$H" ] || H="$HOME/.config/herdr-app"
[ -d "$H" ] || die "no Herdr home at $H: open Herdr once, or pass --home <folder>"
STATE="$H/community/$SLUG"
LIST="$STATE/installed.txt"
mkdir -p "$STATE"

# ---- JSON edits: Node, or macOS's own JavaScript ---------------------------------------
JS=""
if [ "${HERDR_INSTALL_ENGINE:-}" != "osascript" ] && command -v node >/dev/null 2>&1; then JS="node"
elif command -v osascript >/dev/null 2>&1; then JS="osascript"; fi
[ "${HERDR_INSTALL_ENGINE:-}" = "none" ] && JS=""
json() {
  case "$JS" in
    node) node "$SRC/install/jsonedit.cjs" "$@" ;;
    osascript) osascript -l JavaScript "$SRC/install/jsonedit.cjs" "$@" ;;
    *) return 3 ;;
  esac
}

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$STATE/backup-$STAMP"
backup() { # path relative to the home
  [ -e "$H/$1" ] || return 0
  mkdir -p "$BACKUP/$(dirname "$1")"
  cp -R "$H/$1" "$BACKUP/$1"
}
recorded() { [ -f "$LIST" ] && grep -qxF "$1" "$LIST"; }
record() { recorded "$1" || printf '%s\n' "$1" >> "$LIST"; }
herdr_running() { command -v herdr-app >/dev/null 2>&1 && HERDR_APP_HOME="$H" herdr-app status >/dev/null 2>&1; }

# ---- uninstall -------------------------------------------------------------------------
if [ "$UNINSTALL" = 1 ]; then
  [ -f "$LIST" ] || die "nothing from $REPO is recorded as installed in $H"
  ask "Remove what $REPO installed in $H?" || { say "Nothing removed."; exit 0; }
  if [ -n "$SWITCH" ] && herdr_running; then
    current="$(HERDR_APP_HOME="$H" herdr-app status 2>/dev/null | sed -n 's/^ *"layout": *"\([^"]*\)".*/\1/p' | head -n 1)"
    for l in $LAYOUTS; do [ "$current" = "$l" ] && HERDR_APP_HOME="$H" herdr-app do layout.switch '{"name":"main"}' >/dev/null 2>&1 || true; done
  fi
  keyfile="$STATE/keys-remove.tsv"; : > "$keyfile"
  while IFS= read -r line; do
    case "$line" in
      "mod "*) backup "mods/${line#mod }"; rm -rf "${H:?}/mods/${line#mod }"; say "  removed mods/${line#mod }" ;;
      "layout "*) n="${line#layout }"; backup "layouts/$n.json"; rm -f "$H/layouts/$n.json" "$H/layouts/$n.svg"; say "  removed layouts/$n" ;;
      "key$TAB"*) printf '%s\n' "${line#key$TAB}" >> "$keyfile" ;;
    esac
  done < "$LIST"
  if [ -s "$keyfile" ]; then
    backup keys.json
    if json keys-unset "$H/keys.json" "$keyfile" >/dev/null 2>&1; then say "  removed its keys from keys.json"
    else say "  remove these keys from keys.json yourself:"; sed 's/^/    /' "$keyfile"; fi
  fi
  rm -f "$keyfile" "$LIST"
  [ -d "$BACKUP" ] && say "Backed up first to $BACKUP"
  say "Done."
  exit 0
fi

# ---- install ---------------------------------------------------------------------------
say "$NAME, from $REPO"
say "Into: $H"
sed -n 's/^say[[:space:]]\{1,\}/  /p' "$M"
ask "Install?" || { say "Nothing installed."; exit 0; }
first=1; [ -f "$LIST" ] && first=0

# A mod folder goes in whole: copied next to the old one, then swapped, so Herdr never loads a
# half-copied folder. The editor typings Herdr writes into a mod folder are left out.
put_mod() {
  m="$1"; [ -d "$SRC/mods/$m" ] || die "mods/$m is missing from the download"
  stage="$STATE/.new-$m"; rm -rf "$stage"; cp -R "$SRC/mods/$m" "$stage"
  rm -f "$stage/gpui-kit.d.ts" "$stage/jsconfig.json"
  if [ -d "$H/mods/$m" ]; then backup "mods/$m"; rm -rf "${H:?}/mods/$m"; fi
  mkdir -p "$H/mods"; mv "$stage" "$H/mods/$m"
  record "mod $m"
}
for m in $MODS; do put_mod "$m"; say "  mods/$m"; done
for m in $BUNDLED; do
  if [ -d "$H/mods/$m" ] && ! recorded "mod $m"; then say "  mods/$m: yours is kept"
  else put_mod "$m"; say "  mods/$m"; fi
done

if [ -n "$LAYOUTS" ]; then
  mkdir -p "$H/layouts"
  set -- $PANEL; pmod="${1:-}" psnip="${2:-}" pnode="${3:-}"
  for l in $LAYOUTS; do
    backup "layouts/$l.json"; backup "layouts/$l.svg"
    cp "$SRC/layouts/$l.json" "$H/layouts/$l.json"
    [ -f "$SRC/layouts/$l.svg" ] && cp "$SRC/layouts/$l.svg" "$H/layouts/$l.svg"
    record "layout $l"
    extra=""
    if [ -n "$pmod" ] && [ -d "$H/mods/$pmod" ]; then
      if r="$(json panel-add "$H/layouts/$l.json" "$SRC/$psnip" "$pnode" 2>/dev/null)"; then extra=" (with the $pmod panel)"
      else extra=" (add $psnip to the $pnode children by hand for the $pmod panel)"; fi
    fi
    say "  layouts/$l$extra"
  done
fi

if [ -n "$KEYS" ] && [ -f "$SRC/$KEYS" ]; then
  had_keys=1; [ -f "$H/keys.json" ] || { printf '{}\n' > "$H/keys.json"; had_keys=0; }
  if plan="$(json keys-plan "$H/keys.json" "$SRC/$KEYS" 2>/dev/null)"; then
    set_file="$STATE/keys-set.tsv"; : > "$set_file"
    printf '%s\n' "$plan" | while IFS="$TAB" read -r what section chord want have; do
      case "$what" in
        add) printf '%s\t%s\t%s\n' "$section" "$chord" "$want" >> "$set_file" ;;
        conflict)
          if [ "$YES" != 1 ] && ask "keys.json [$section] $chord is \"$have\"; use \"$want\" from $SLUG instead?"; then
            printf '%s\t%s\t%s\n' "$section" "$chord" "$want" >> "$set_file"
          else say "  kept your [$section] $chord ($have); $SLUG's $want is not bound"; fi ;;
      esac
    done
    if [ -s "$set_file" ]; then
      [ "$had_keys" = 1 ] && backup keys.json
      json keys-set "$H/keys.json" "$set_file" >/dev/null
      while IFS= read -r l; do record "key$TAB$l"; done < "$set_file"
      say "  keys.json: $(wc -l < "$set_file" | tr -d ' ') key(s) added"
    else say "  keys.json: nothing to add"; fi
    rm -f "$set_file"
  else
    say "  keys.json: merge these into yours by hand (no Node, or it failed):"
    sed 's/^/    /' "$SRC/$KEYS"
  fi
fi

if command -v herdr-app >/dev/null 2>&1; then
  failed=0
  for m in $MODS $BUNDLED; do
    [ -d "$H/mods/$m" ] || continue
    HERDR_APP_HOME="$H" herdr-app check "$H/mods/$m" >/dev/null 2>&1 || { say "  herdr-app check failed: mods/$m"; failed=1; }
  done
  [ "$failed" = 0 ] && say "  herdr-app check: every mod loads"
else say "  herdr-app is not on PATH: run herdr-app check on each mod yourself"; fi

if [ "$first" = 1 ] && [ -n "$SWITCH" ] && herdr_running; then
  HERDR_APP_HOME="$H" herdr-app do layout.switch "{\"name\":\"$SWITCH\"}" >/dev/null 2>&1 && say "  switched to the $SWITCH layout (ctrl-shift-l switches back)"
fi
[ -d "$BACKUP" ] && say "Replaced files were backed up to $BACKUP"
if [ -n "$TMP" ]; then say "Done. To remove it: curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install/install.sh | sh -s -- --uninstall"
else say "Done. To remove it: install/install.sh --uninstall"; fi
