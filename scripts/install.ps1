# Restore the pi / Pi-Bolt setup captured in this repo (Windows PowerShell).
#
# Usage:
#   .\scripts\install.ps1 [-DryRun] [-NoPackages] [-InstallPi] [-Yes]
#
# Options:
#   -DryRun       Print what would happen; change nothing.
#   -NoPackages   Copy config files only; skip package installation.
#   -InstallPi    Install pi via the official installer if it is missing.
#   -Yes          Do not prompt for confirmation.
#
# Never touches credentials: $env:USERPROFILE\.pi\agent\auth.json is left alone.
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$NoPackages,
    [switch]$InstallPi,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$RepoDir    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigDir  = Join-Path $RepoDir 'config'
$AgentDir   = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $HOME '.pi\agent' }

# Package list mirrors config/settings.json. Keep both in sync when editing.
$PiPackages = @(
    'git:github.com/elpapi42/pi-observational-memory'
    'npm:@pi-plugins/speed'
    'npm:pi-goal-x'
    'git:github.com/michaelmjhhhh/pi-atelier'
)
$PiBoltPackages = @(
    'npm:opensec-pi-subagents@0.20.9'
    'npm:opensec-pi-todo@2.13.1'
    'npm:opensec-pi-fff@0.11.0'
)

function Write-Say([string]$Message) { Write-Host $Message }
function Invoke-Step {
    param([string]$Description, [scriptblock]$Action)
    if ($DryRun) {
        Write-Host "[dry-run] $Description"
    } else {
        & $Action
    }
}

Write-Say 'pi setup restore'
Write-Say "  repo:      $RepoDir"
Write-Say "  agent dir: $AgentDir"
if ($DryRun) { Write-Say '  mode:      dry run (no changes)' }

if (-not $Yes -and -not $DryRun) {
    $reply = Read-Host 'Continue? [y/N]'
    if ($reply -notmatch '^(y|yes)$') { Write-Say 'Aborted.'; exit 0 }
}

$pi = Get-Command pi -ErrorAction SilentlyContinue
if (-not $pi) {
    Write-Say ''
    Write-Say 'pi is not on PATH.'
    if ($InstallPi) {
        Invoke-Step 'install pi' { powershell -c "irm https://pi.dev/install.ps1 | iex" }
    } else {
        Write-Say 'Install it first:'
        Write-Say '  powershell -c "irm https://pi.dev/install.ps1 | iex"'
        Write-Say 'or re-run with -InstallPi.'
    }
}

# ------------------------------------------------------------ backup + copy
if ((Test-Path $AgentDir) -and -not $DryRun) {
    $backup = Join-Path $AgentDir ('backups\config-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($f in @('settings.json', 'APPEND_SYSTEM.md')) {
        $src = Join-Path $AgentDir $f
        if (Test-Path $src) { Copy-Item $src (Join-Path $backup $f) }
    }
    $ext = Join-Path $AgentDir 'extensions\codemode-log.ts'
    if (Test-Path $ext) {
        New-Item -ItemType Directory -Path (Join-Path $backup 'extensions') -Force | Out-Null
        Copy-Item $ext (Join-Path $backup 'extensions\codemode-log.ts')
    }
    Write-Say "Backed up existing config to $backup"
}

Invoke-Step "mkdir $AgentDir\extensions" { New-Item -ItemType Directory -Path (Join-Path $AgentDir 'extensions') -Force | Out-Null }
Invoke-Step 'copy settings.json'           { Copy-Item (Join-Path $ConfigDir 'settings.json') (Join-Path $AgentDir 'settings.json') -Force }
Invoke-Step 'copy APPEND_SYSTEM.md'        { Copy-Item (Join-Path $ConfigDir 'APPEND_SYSTEM.md') (Join-Path $AgentDir 'APPEND_SYSTEM.md') -Force }
Invoke-Step 'copy extensions/codemode-log.ts' { Copy-Item (Join-Path $ConfigDir 'extensions\codemode-log.ts') (Join-Path $AgentDir 'extensions\codemode-log.ts') -Force }
Write-Say 'Copied settings.json, APPEND_SYSTEM.md, extensions/codemode-log.ts'

# --------------------------------------------------------------- packages
if (-not $NoPackages -and $pi) {
    Write-Say ''
    Write-Say 'Installing pi packages...'
    foreach ($pkg in $PiPackages) {
        Write-Say "  pi install $pkg"
        try {
            if ($DryRun) { Write-Host "[dry-run] pi install $pkg" }
            else { & pi install $pkg }
        } catch {
            Write-Say "  ! failed: $pkg (continuing)"
        }
    }
}

$piBolt = Get-Command pi-bolt -ErrorAction SilentlyContinue
if (-not $NoPackages -and $piBolt) {
    Write-Say ''
    Write-Say 'Installing Pi-Bolt packages...'
    foreach ($pkg in $PiBoltPackages) {
        Write-Say "  pi-bolt install $pkg"
        try {
            if ($DryRun) { Write-Host "[dry-run] pi-bolt install $pkg" }
            else { & pi-bolt install $pkg }
        } catch {
            Write-Say "  ! failed: $pkg (continuing)"
        }
    }
} elseif (-not $NoPackages) {
    Write-Say ''
    Write-Say 'pi-bolt not found; skipping Pi-Bolt packages.'
    Write-Say 'Install Pi-Bolt from https://github.com/opensec-git/Pi-Bolt, then run:'
    foreach ($pkg in $PiBoltPackages) { Write-Say "  pi-bolt install $pkg" }
}

Write-Say ''
Write-Say 'Done. Next steps:'
Write-Say '  1. Start pi and run /login to authenticate providers (opencode-go, openai-codex).'
Write-Say '  2. Start pi-bolt once to load Pi-Bolt packages.'
Write-Say '  3. Check with: pi list'
