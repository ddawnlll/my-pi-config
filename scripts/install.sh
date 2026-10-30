#!/usr/bin/env bash
# Restore the pi / Pi-Bolt setup captured in this repo.
#
# Usage:
#   ./scripts/install.sh [--dry-run] [--no-packages] [--install-pi] [--yes]
#
# Options:
#   --dry-run       Print what would happen; change nothing.
#   --no-packages   Copy config files only; skip package installation.
#   --install-pi    Install pi via the official installer if it is missing.
#   --yes           Do not prompt for confirmation.
#
# Never touches credentials: ~/.pi/agent/auth.json is left exactly as it is.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
CONFIG_DIR="$REPO_DIR/config"
DRY_RUN=0
INSTALL_PACKAGES=1
INSTALL_PI=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-packages) INSTALL_PACKAGES=0 ;;
    --install-pi) INSTALL_PI=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Package list mirrors config/settings.json. Keep both in sync when editing.
PI_PACKAGES=(
  "git:github.com/elpapi42/pi-observational-memory"
  "npm:@pi-plugins/speed"
  "npm:pi-goal-x"
  "git:github.com/michaelmjhhhh/pi-atelier"
)
PI_BOLT_PACKAGES=(
  "npm:opensec-pi-subagents@0.20.9"
  "npm:opensec-pi-todo@2.13.1"
  "npm:opensec-pi-fff@0.11.0"
)

say()  { printf '%s\n' "$*"; }
run()  {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

say "pi setup restore"
say "  repo:      $REPO_DIR"
say "  agent dir: $AGENT_DIR"
[ "$DRY_RUN" -eq 1 ] && say "  mode:      dry run (no changes)"

if [ "$ASSUME_YES" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  printf 'Continue? [y/N] '
  read -r reply
  case "$reply" in y|Y|yes|YES) ;; *) say "Aborted."; exit 0 ;; esac
fi

if ! command -v pi >/dev/null 2>&1; then
  say ""
  say "pi is not on PATH."
  if [ "$INSTALL_PI" -eq 1 ]; then
    run sh -c 'curl -fsSL https://pi.dev/install.sh | sh'
  else
    say "Install it first:"
    say "  curl -fsSL https://pi.dev/install.sh | sh"
    say "or re-run with --install-pi."
  fi
fi

# ---------------------------------------------------------------- backup + copy
if [ -d "$AGENT_DIR" ] && [ "$DRY_RUN" -eq 0 ]; then
  backup="$AGENT_DIR/backups/config-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup"
  for f in settings.json APPEND_SYSTEM.md; do
    [ -f "$AGENT_DIR/$f" ] && cp -p "$AGENT_DIR/$f" "$backup/$f"
  done
  [ -f "$AGENT_DIR/extensions/codemode-log.ts" ] && \
    { mkdir -p "$backup/extensions"; cp -p "$AGENT_DIR/extensions/codemode-log.ts" "$backup/extensions/"; }
  say "Backed up existing config to $backup"
fi

run mkdir -p "$AGENT_DIR/extensions"
run cp "$CONFIG_DIR/settings.json" "$AGENT_DIR/settings.json"
run cp "$CONFIG_DIR/APPEND_SYSTEM.md" "$AGENT_DIR/APPEND_SYSTEM.md"
run cp "$CONFIG_DIR/extensions/codemode-log.ts" "$AGENT_DIR/extensions/codemode-log.ts"
say "Copied settings.json, APPEND_SYSTEM.md, extensions/codemode-log.ts"

# ------------------------------------------------------------------ packages
if [ "$INSTALL_PACKAGES" -eq 1 ] && command -v pi >/dev/null 2>&1; then
  say ""
  say "Installing pi packages..."
  for pkg in "${PI_PACKAGES[@]}"; do
    say "  pi install $pkg"
    run pi install "$pkg" || say "  ! failed: $pkg (continuing)"
  done
fi

if [ "$INSTALL_PACKAGES" -eq 1 ] && command -v pi-bolt >/dev/null 2>&1; then
  say ""
  say "Installing Pi-Bolt packages..."
  for pkg in "${PI_BOLT_PACKAGES[@]}"; do
    say "  pi-bolt install $pkg"
    run pi-bolt install "$pkg" || say "  ! failed: $pkg (continuing)"
  done
elif [ "$INSTALL_PACKAGES" -eq 1 ]; then
  say ""
  say "pi-bolt not found; skipping Pi-Bolt packages."
  say "Install Pi-Bolt from https://github.com/opensec-git/Pi-Bolt, then run:"
  for pkg in "${PI_BOLT_PACKAGES[@]}"; do say "  pi-bolt install $pkg"; done
fi

say ""
say "Done. Next steps:"
say "  1. Start pi and run /login to authenticate providers (opencode-go, openai-codex)."
say "  2. Start pi-bolt once to load Pi-Bolt packages."
say "  3. Check with: pi list"
