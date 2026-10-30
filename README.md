# my-pi-config

Portable snapshot of my [pi](https://pi.dev) / [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) setup: settings, custom extension, system-prompt additions, package choices, and one-command restore scripts for Windows and macOS/Linux.

Tested baseline: **Pi 1.4.0** · **Pi-Bolt 1.0.7** (Pi 1.4.0), win32-x64.

---

## Quick start on a new machine

### Windows (PowerShell)

```powershell
git clone https://github.com/ddawnlll/my-pi-config.git
cd my-pi-config
.\scripts\install.ps1 -DryRun     # preview
.\scripts\install.ps1             # apply
```

### macOS / Linux

```bash
git clone https://github.com/ddawnlll/my-pi-config.git
cd my-pi-config
./scripts/install.sh --dry-run    # preview
./scripts/install.sh              # apply
```

The installer:

1. Backs up any existing `~/.pi/agent` config to `~/.pi/agent/backups/config-<timestamp>/`.
2. Copies `settings.json`, `APPEND_SYSTEM.md`, and `extensions/codemode-log.ts`.
3. Installs every pi package and Pi-Bolt package listed below (skip with `--no-packages` / `-NoPackages`).
4. **Does not touch credentials.** After restoring, start `pi` and run `/login`.

Prerequisites:

- **pi** — `curl -fsSL https://pi.dev/install.sh | sh` (macOS/Linux) or `powershell -c "irm https://pi.dev/install.ps1 | iex"` (Windows), or `npm i -g --ignore-scripts @earendil-works/pi-coding-agent`.
- **Pi-Bolt** (optional but this setup uses it) — install from the [Pi-Bolt releases](https://github.com/opensec-git/Pi-Bolt), then update with `pi-bolt update`.
- Node.js 22.19+ if you use npm-based pi.

---

## What's in here

```
config/
  settings.json               sanitized user settings (provider, model, packages, theme)
  APPEND_SYSTEM.md            codemode usage policy appended to the system prompt
  extensions/
    codemode-log.ts           custom extension: persists every codemode run to SQLite + JSONL
scripts/
  install.ps1                 Windows restore script
  install.sh                  macOS/Linux restore script
INVENTORY.md                  full audit of the source setup + what is excluded
```

Nothing secret is committed: no `auth.json`, sessions, logs, caches, `models-store.json`, or `node_modules`.

---

## Choices (and why)

| Setting | Value | Rationale |
|---|---|---|
| `theme` | `dark` | Terminal is dark; consistent contrast. |
| `defaultProvider` | `opencode-go` | Primary provider; OpenAI-compatible endpoint with a large model catalog. |
| `defaultModel` | `deepseek-v4.1-flash` | Fast/cheap default for everyday coding; switch per-task with `/model`. |
| `defaultThinkingLevel` | `low` | Lowest latency by default; raise per-session when a task needs deeper reasoning. |
| `defaultTools` | `["+codemode"]` | Codemode on in every session for batching/tool orchestration. |
| `codemode.mode` | `on` | Force codemode availability rather than opt-in. |
| `hideThinkingBlock` | `false` | Keep reasoning visible while streaming. |
| `piBolt.packagesOverlay` | `true` | Pi-Bolt loads its Bun-native package builds alongside regular pi packages. |

`APPEND_SYSTEM.md` tells the model *when* to prefer codemode (parallel calls, big outputs, multi-step chains) versus direct tools, and how to write codemode scripts safely.

### Providers

`auth.json` is deliberately **not** included. On a new machine run `pi` and then `/login`, and authenticate:

- `opencode-go` — API key (OpenCode Go)
- `openai-codex` — OAuth (ChatGPT/Codex account)

`models-store.json` is also excluded; pi rebuilds it on login. To refresh later: `pi update --models`.

---

## Packages

| Package | Version | Kind | What it does |
|---|---|---|---|
| [pi-observational-memory](https://github.com/elpapi42/pi-observational-memory) | 3.1.4 (`022da5e`) | git | Cache-friendly tiered compaction: observations + reflections instead of raw truncation. |
| [@pi-plugins/speed](https://www.npmjs.com/package/@pi-plugins/speed) | 0.1.9 | npm | Tokens/sec and time-to-first-token readout. |
| [pi-goal-x](https://github.com/tmonk/pi-goal-x) | 0.34.1 | npm | `/goal`: conversational goal planning, persistent progress, independent completion auditor. |
| [pi-atelier](https://github.com/michaelmjhhhh/pi-atelier) | 0.17.0 (`d4b76ad`) | git | Responsive status rail / live activity sidebar. |
| [opensec-pi-subagents](https://www.npmjs.com/package/opensec-pi-subagents) | 0.20.9 | npm (Pi-Bolt) | Sub-agents in separate sessions, inheriting parent model + thinking level. Bun build. |
| [opensec-pi-todo](https://www.npmjs.com/package/opensec-pi-todo) | 2.13.1 | npm (Pi-Bolt) | Live todo panel that survives `/reload` and compaction. Bun build. |
| [opensec-pi-fff](https://www.npmjs.com/package/opensec-pi-fff) | 0.11.0 | npm (Pi-Bolt) | Fast fuzzy file/content search (`find`, `grep`, `@`-mentions). Bun build. |

Install manually:

```bash
# regular pi
pi install git:github.com/elpapi42/pi-observational-memory
pi install npm:@pi-plugins/speed
pi install npm:pi-goal-x
pi install git:github.com/michaelmjhhhh/pi-atelier

# Pi-Bolt overlay (Bun-native builds)
pi-bolt install npm:opensec-pi-subagents@0.20.9
pi-bolt install npm:opensec-pi-todo@2.13.1
pi-bolt install npm:opensec-pi-fff@0.11.0
```

The npm versions above are the ones this snapshot was taken with; `pi update --extensions` / `pi-bolt update` moves them forward.

### Custom extension: `codemode-log.ts`

Wraps every codemode execution and records it to disk (outside the QuickJS sandbox):

- `~/.pi/agent/logs/codemode-runs.db` — SQLite, queryable
- `~/.pi/agent/logs/codemode-runs.jsonl` — one JSON object per line
- `/codemode-log [n]` — show the last n runs (default 5)

Overrides: `PI_CODEMODE_LOG_DIR`, `PI_CODEMODE_LOG_DB`, `PI_CODEMODE_LOG_JSONL`, `PI_CODEMODE_LOG_DISABLE=1`.

---

## Manual restore (no scripts)

```bash
# 1. copy config (back up first!)
cp ~/.pi/agent/settings.json ~/.pi/agent/settings.json.bak 2>/dev/null || true
cp config/settings.json          ~/.pi/agent/settings.json
cp config/APPEND_SYSTEM.md       ~/.pi/agent/APPEND_SYSTEM.md
mkdir -p ~/.pi/agent/extensions
cp config/extensions/codemode-log.ts ~/.pi/agent/extensions/

# 2. install packages (see table above), then:
pi list

# 3. authenticate
pi        # then run /login
```

On Windows use `%USERPROFILE%\.pi\agent` instead of `~/.pi/agent`.

---

## Updating this repo

After changing your setup, re-snapshot it:

1. Update `config/settings.json`, `config/APPEND_SYSTEM.md`, and `config/extensions/` from `~/.pi/agent`.
2. Strip `deviceId` and `lastChangelogVersion` from `settings.json` (machine/runtime state).
3. Re-run the audit in [INVENTORY.md](INVENTORY.md) for any new package, then update the package tables and the arrays in both install scripts.
4. Commit and push.

---

## Troubleshooting

- **`pi: command not found`** — install pi first, or run the installer with `--install-pi` / `-InstallPi`.
- **Packages fail to install** — the installer warns and continues. Run the failing `pi install` manually; check network/registry access, or use `pi install` again (pi retries on next start).
- **Wrong provider/model after restore** — `settings.json` was copied over your local one; older values are in `~/.pi/agent/backups/config-<timestamp>/`. Switch live with `/model` and `/provider`.
- **Pi-Bolt packages missing** — they live under `piBolt.packages` and load only in Pi-Bolt. Confirm with `pi-bolt` then `/reload`.
- **Codemode log not written** — check `~/.pi/agent/logs/`; set `PI_CODEMODE_LOG_DIR` to a writable path or `PI_CODEMODE_LOG_DISABLE=1` to silence it.

## License

MIT — see [LICENSE](LICENSE). Third-party packages keep their own licenses.
