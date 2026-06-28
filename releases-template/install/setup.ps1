#Requires -Version 5.1
<#
.SYNOPSIS
    Nexora interactive setup for Windows (PowerShell 5.1+).

.DESCRIPTION
    Walks the operator through naming this install (invoice id, admin
    email, ports, public origin), generates ./nexora/.env with strong
    secrets, writes a docker-compose.yml pinned to the per-invoice
    image, and brings everything up.

.EXAMPLE
    irm https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.ps1 | iex

.EXAMPLE
    iwr https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.ps1 -OutFile setup.ps1
    .\setup.ps1
#>

[CmdletBinding()]
param(
    [string]$Invoice = $env:INVOICE,
    [string]$AdminEmail = $(if ($env:ADMIN_EMAIL) { $env:ADMIN_EMAIL } else { 'admin@nexora.local' }),
    [int]   $BackendPort  = $(if ($env:HOST_BACKEND_PORT)  { [int]$env:HOST_BACKEND_PORT }  else { 3000 }),
    [int]   $FrontendPort = $(if ($env:HOST_FRONTEND_PORT) { [int]$env:HOST_FRONTEND_PORT } else { 4321 }),
    [string]$PublicOrigin = $env:PUBLIC_ORIGIN,
    [string]$InstallDir   = $(Join-Path -Path (Get-Location) -ChildPath 'nexora'),
    [string]$ImageRepo    = 'ghcr.io/8w6s/nexora'
)

$ErrorActionPreference = 'Stop'

# ── Native colour helpers ──────────────────────────────────────────────────
# Uses Write-Host -ForegroundColor (no ANSI escapes) so colours render on
# Windows PowerShell 5.1 conhost, PS7 + Windows Terminal, and remote
# sessions alike — no terminal detection or VT-mode toggling required.

function Write-Banner {
    Write-Host ''
    Write-Host '   _   _'                                  -ForegroundColor Cyan
    Write-Host '  | \ | | _____  _____  _ __ __ _'         -ForegroundColor Cyan
    Write-Host '  |  \| |/ _ \ / / _ \| ''__/ _` |'        -ForegroundColor Cyan
    Write-Host '  | |\  |  __/>  < (_) | | | (_| |'        -ForegroundColor Cyan
    Write-Host '  |_| \_|\___/_/\_\___/|_|  \__,_|'        -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Self-host setup wizard'                  -ForegroundColor DarkGray
    Write-Host ''
}

function Write-Step {
    param([string]$Msg)
    Write-Host ''
    Write-Host '> ' -NoNewline -ForegroundColor Cyan
    Write-Host $Msg -ForegroundColor White
}

function Write-Info { param([string]$Msg) Write-Host "  $Msg" -ForegroundColor Blue }

function Write-Ok {
    param([string]$Msg)
    Write-Host '  [ok] ' -NoNewline -ForegroundColor Green
    Write-Host $Msg
}

function Write-Warn {
    param([string]$Msg)
    Write-Host '  [!]  ' -NoNewline -ForegroundColor Yellow
    Write-Host $Msg
}

function Write-Fail {
    param([string]$Msg)
    Write-Host ''
    Write-Host '  [x]  ' -NoNewline -ForegroundColor Red
    Write-Host $Msg
    exit 1
}

function Read-Prompt {
    param(
        [string]$Question,
        [string]$Default
    )
    $hint = if ($Default) { " [$Default]" } else { '' }
    Write-Host '  ? ' -NoNewline -ForegroundColor Cyan
    Write-Host "$Question$hint" -NoNewline
    Write-Host ': ' -NoNewline
    $val = Read-Host
    if ([string]::IsNullOrWhiteSpace($val) -and $Default) { return $Default }
    return $val
}

function Read-Validated {
    param(
        [string]$Question,
        [string]$Default,
        [scriptblock]$Validator
    )
    while ($true) {
        $val = Read-Prompt -Question $Question -Default $Default
        try {
            $ok = & $Validator $val
            if ($ok -eq $true) { return $val }
        } catch {
            Write-Warn $_.Exception.Message
        }
    }
}

$InvoiceRx = '^[A-Za-z0-9._-]{4,64}$'
$EmailRx   = '^[^\s@]+@[^\s@]+\.[^\s@]+$'

$validateInvoice = {
    param($v)
    if ($v -match $InvoiceRx) { return $true }
    Write-Warn 'invoice id must match [A-Za-z0-9._-]{4,64}'
    return $false
}
$validateEmail = {
    param($v)
    if ($v -match $EmailRx) { return $true }
    Write-Warn 'invalid email shape'
    return $false
}
$validatePort = {
    param($v)
    $n = 0
    if ([int]::TryParse($v, [ref]$n) -and $n -ge 1 -and $n -le 65535) { return $true }
    Write-Warn 'port must be 1-65535'
    return $false
}
$validateOrigin = {
    param($v)
    if ($v -match '^(http|https)://') { return $true }
    Write-Warn 'origin must start with http:// or https://'
    return $false
}

function Get-RandHex {
    $bytes = New-Object 'byte[]' 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
function Get-RandPassword {
    $bytes = New-Object 'byte[]' 18
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ([Convert]::ToBase64String($bytes) -replace '[/+=]', '').Substring(0, 24)
}

function Test-Cmd { param([string]$Name) [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# ── 0. preflight ───────────────────────────────────────────────────────────
Write-Banner
Write-Step 'Checking prerequisites'

if (-not (Test-Cmd docker)) { Write-Fail 'docker not on PATH - install Docker Desktop first' }
try {
    & docker compose version *>$null
    if ($LASTEXITCODE -ne 0) { throw 'compose plugin missing' }
} catch {
    Write-Fail 'docker compose plugin missing - re-install Docker Desktop'
}
try {
    & docker info *>$null
    if ($LASTEXITCODE -ne 0) { throw 'daemon' }
} catch {
    Write-Fail 'the docker daemon is not running - start Docker Desktop, then re-run'
}
Write-Ok 'docker + compose ready'

# ── 1. interactive prompts ────────────────────────────────
Write-Step 'Tell us about this install'

if (-not $Invoice)      { $Invoice      = Read-Validated 'Your invoice id'           ''                    $validateInvoice }
if (-not $AdminEmail)   { $AdminEmail   = Read-Validated 'Admin email'               'admin@nexora.local'  $validateEmail }
if (-not $BackendPort)  { $BackendPort  = [int](Read-Validated 'Backend port (host)' '3000'                $validatePort) }
if (-not $FrontendPort) { $FrontendPort = [int](Read-Validated 'Frontend port (host)' '4321'               $validatePort) }
if (-not $PublicOrigin) {
    $defaultOrigin = "http://localhost:$FrontendPort"
    $PublicOrigin  = Read-Validated 'Public origin (URL customers will visit)' $defaultOrigin $validateOrigin
}

# Production refuses to boot without HTTPS - auto-pick a sane NODE_ENV.
$NodeEnv = if ($PublicOrigin -like 'https://*') { 'production' } else { 'development' }
$Tag = "latest-$Invoice"

# ── 2. echo back ─────────────────────────
Write-Step 'Plan'
Write-Host '  Invoice id:    ' -NoNewline -ForegroundColor DarkGray; Write-Host $Invoice
Write-Host '  Admin email:   ' -NoNewline -ForegroundColor DarkGray; Write-Host $AdminEmail
Write-Host '  Backend  ->    ' -NoNewline -ForegroundColor DarkGray; Write-Host "localhost:$BackendPort"
Write-Host '  Frontend ->    ' -NoNewline -ForegroundColor DarkGray; Write-Host "localhost:$FrontendPort"
Write-Host '  Public origin: ' -NoNewline -ForegroundColor DarkGray; Write-Host $PublicOrigin
Write-Host '  Mode:          ' -NoNewline -ForegroundColor DarkGray; Write-Host $NodeEnv
Write-Host '  Image:         ' -NoNewline -ForegroundColor DarkGray; Write-Host "${ImageRepo}:${Tag}"
Write-Host '  Install dir:   ' -NoNewline -ForegroundColor DarkGray; Write-Host $InstallDir
Write-Host ''

$confirm = Read-Prompt -Question 'Proceed? (y/N)' -Default 'n'
if ($confirm -notmatch '^(y|yes)$') { Write-Fail 'aborted by user' }

# ── 3. filesystem ─────────────────────────────────────
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
$EnvFile     = Join-Path $InstallDir '.env'
$ComposeFile = Join-Path $InstallDir 'docker-compose.yml'

Write-Step "Writing $EnvFile"
$generatedPw = $false
$adminPw = $null
if (Test-Path $EnvFile) {
    Write-Warn 'existing .env detected - preserving secrets, only updating invoice + ports'
    $lines = @(Get-Content $EnvFile)
    function Set-OrAppend([ref]$arr, $key, $value) {
        $pat = "^$([regex]::Escape($key))="
        for ($i = 0; $i -lt $arr.Value.Count; $i++) {
            if ($arr.Value[$i] -match $pat) {
                $arr.Value[$i] = "$key=$value"
                return
            }
        }
        $arr.Value = @($arr.Value) + "$key=$value"
    }
    Set-OrAppend ([ref]$lines) 'NEXORA_INVOICE_ID' $Invoice
    Set-OrAppend ([ref]$lines) 'ADMIN_EMAIL'        $AdminEmail
    Set-OrAppend ([ref]$lines) 'PUBLIC_ORIGIN'      $PublicOrigin
    Set-OrAppend ([ref]$lines) 'NODE_ENV'           $NodeEnv
    Set-Content -Path $EnvFile -Value $lines -Encoding ASCII
    Write-Ok 'updated in place'
} else {
    $adminPw = Get-RandPassword
    $generatedPw = $true
    @(
        '# Generated by setup.ps1 - keep this file private'
        "NEXORA_INVOICE_ID=$Invoice"
        "NODE_ENV=$NodeEnv"
        "PUBLIC_ORIGIN=$PublicOrigin"
        "ADMIN_EMAIL=$AdminEmail"
        "ADMIN_PASSWORD=$adminPw"
        "ORDER_TOKEN_SECRET=$(Get-RandHex)"
        "DATABASE_ENCRYPTION_KEY=$(Get-RandHex)"
        "NEXORA_LICENSE_SECRET=$(Get-RandHex)"
    ) | Set-Content -Path $EnvFile -Encoding ASCII
    Write-Ok 'generated secrets + admin password'
}

Write-Step "Writing $ComposeFile"
@"
services:
  nexora:
    image: ${ImageRepo}:${Tag}
    restart: unless-stopped
    env_file: .env
    ports:
      - "${BackendPort}:3000"
      - "${FrontendPort}:4321"
    volumes:
      - nexora-db:/app/data
    healthcheck:
      test: ["CMD", "sh", "-c", "wget -qO- http://localhost:3000/api/health >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  nexora-db:
"@ | Set-Content -Path $ComposeFile -Encoding ASCII
Write-Ok 'compose file ready'

# ── 4. pull + up ────────────────────────────
Write-Step "Pulling ${ImageRepo}:${Tag}"
& docker compose -f $ComposeFile pull --quiet
if ($LASTEXITCODE -ne 0) { Write-Fail 'pull failed - check your invoice id matches a published image' }
Write-Ok 'pulled'

Write-Step 'Starting Nexora'
& docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) { Write-Fail 'docker compose up failed' }
Write-Ok 'containers started'

Write-Info "waiting for the API on http://localhost:${BackendPort}/api/health"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:${BackendPort}/api/health" -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Write-Host '.' -NoNewline -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
}
Write-Host ''

if (-not $ready) {
    Write-Warn 'health check did not pass within ~90s - last 40 log lines:'
    & docker compose -f $ComposeFile logs --tail=40
    Write-Fail 'install incomplete - fix the issue above and re-run setup.ps1'
}

# ── 5. summary card ───────────────────────────────
Write-Host ''
Write-Host '  =============================================' -ForegroundColor Cyan
Write-Host '    Nexora is live' -ForegroundColor Cyan
Write-Host '  =============================================' -ForegroundColor Cyan
Write-Host '  Storefront  ' -NoNewline; Write-Host $PublicOrigin -ForegroundColor Green
Write-Host '  Admin       ' -NoNewline; Write-Host "$PublicOrigin/admin" -ForegroundColor Green
Write-Host '  Email       ' -NoNewline; Write-Host $AdminEmail
if ($generatedPw) {
    Write-Host '  Password    ' -NoNewline
    Write-Host $adminPw -NoNewline -ForegroundColor Green
    Write-Host "  (generated; saved in $EnvFile)" -ForegroundColor DarkGray
} else {
    Write-Host '  Password    ' -NoNewline
    Write-Host "(unchanged - see $EnvFile)" -ForegroundColor DarkGray
}
Write-Host ''
Write-Host '  Logs:    ' -NoNewline -ForegroundColor DarkGray; Write-Host "docker compose -f $ComposeFile logs -f"
Write-Host '  Stop:    ' -NoNewline -ForegroundColor DarkGray; Write-Host "docker compose -f $ComposeFile down"
Write-Host '  Upgrade: ' -NoNewline -ForegroundColor DarkGray; Write-Host "docker compose -f $ComposeFile pull && docker compose -f $ComposeFile up -d"
Write-Host ''