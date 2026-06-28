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
# Probe whether the host can actually bind a given port. Windows reserves
# many low-thousands ports for Hyper-V / WSL / IIS even when nothing is
# listening, so we don't trust a "free-looking" port until the OS lets us
# bind it. Returns $true on success.
function Test-PortBindable {
    param([int]$Port)
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { try { $listener.Stop() } catch {} }
    }
}

function Find-FreePort {
    param([int]$Start)
    for ($p = $Start; $p -lt ($Start + 200); $p++) {
        if (Test-PortBindable -Port $p) { return $p }
    }
    return 0
}

$validatePort = {
    param($v)
    $n = 0
    if (-not ([int]::TryParse($v, [ref]$n)) -or $n -lt 1 -or $n -gt 65535) {
        Write-Warn 'port must be 1-65535'
        return $false
    }
    if (-not (Test-PortBindable -Port $n)) {
        $suggested = Find-FreePort -Start ([Math]::Max($n + 1, 10000))
        if ($suggested -gt 0) {
            Write-Warn ("port $n is reserved or in use on this host - try " + $suggested + " or another free port")
        } else {
            Write-Warn "port $n cannot be bound on this host (Windows reserved range or another process). Pick a different one."
        }
        return $false
    }
    return $true
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
    # 24 chars from base64-encoded entropy. Generate a bigger buffer and
    # kep retrying so that stripping problematic chars still leaves >=24.
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object 'byte[]' 24
    $rng.GetBytes($bytes)
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt 24; $i++) {
        $null = $sb.Append($alphabet[$bytes[$i] % $alphabet.Length])
    }
    $sb.ToString()
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
# Discover sensible defaults: the canonical 3000/4321 collide with Windows
# reserved port ranges on a lot of hosts (Hyper-V/WSL2 grabs them). If
# they're free, use them. Otherwise probe upward for the first port the
# OS lets us bind.
$beDefault = if (Test-PortBindable -Port 3000) { 3000 } else { Find-FreePort -Start 18000 }
$feDefault = if (Test-PortBindable -Port 4321) { 4321 } else { Find-FreePort -Start ($beDefault + 1) }
if ($beDefault -le 0) { $beDefault = 18000 }
if ($feDefault -le 0) { $feDefault = 18001 }

if (-not $BackendPort)  { $BackendPort  = [int](Read-Validated 'Backend port (host)'  "$beDefault" $validatePort) }
if (-not $FrontendPort) { $FrontendPort = [int](Read-Validated 'Frontend port (host)' "$feDefault" $validatePort) }
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