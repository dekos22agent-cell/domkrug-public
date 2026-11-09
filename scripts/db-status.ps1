# ДомКруг — состояние базы и API одной картинкой.
#
# Использование: .\scripts\db-status.ps1

[CmdletBinding()]
param(
    [string]$Root = '',
    [int]$Port = 5432,
    [int]$ApiPort = 3000
)

$ErrorActionPreference = 'Continue'

$RepoRoot = Split-Path -Parent $PSScriptRoot

# Root: -Root > DOMKRUG_PG_ROOT > <репозиторий>\.local
if (-not $Root) {
    if ($env:DOMKRUG_PG_ROOT) {
        $Root = $env:DOMKRUG_PG_ROOT
    } else {
        $Root = Join-Path $RepoRoot '.local'
    }
}
$Bin = Join-Path $Root 'pgsql\bin'

Write-Host '=== ДомКруг: состояние ===' -ForegroundColor Cyan

# --- PostgreSQL ---
$ready = 'не найден'
if (Test-Path (Join-Path $Bin 'pg_isready.exe')) {
    $out = & (Join-Path $Bin 'pg_isready.exe') -h localhost -p $Port 2>&1
    $ready = if ($LASTEXITCODE -eq 0) { 'запущен' } else { 'остановлен' }
    Write-Host "PostgreSQL (порт $Port): $ready"
} else {
    Write-Host "PostgreSQL: бинарники не найдены в $Bin" -ForegroundColor Yellow
}

# --- Данные в базе ---
if ($ready -eq 'запущен') {
    function Read-DotEnv([string]$path) {
        $r = @{}
        if (-not (Test-Path $path)) { return $r }
        foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
            if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
            $k, $v = $line -split '=', 2
            $r[$k.Trim()] = $v.Trim()
        }
        return $r
    }
    $cfg = Read-DotEnv (Join-Path $RepoRoot '.env')
    $u = if ($cfg['POSTGRES_USER']) { $cfg['POSTGRES_USER'] } else { 'domkrug' }
    $p = if ($cfg['POSTGRES_PASSWORD']) { $cfg['POSTGRES_PASSWORD'] } else { 'domkrug_dev_password' }
    $db = if ($cfg['POSTGRES_DB']) { $cfg['POSTGRES_DB'] } else { 'domkrug_dev' }
    $psql = Join-Path $Bin 'psql.exe'
    $env:PGPASSWORD = $p
    # Только ASCII в запросе: русский литерал уходит в базу в кодировке
    # консоли Windows (cp866) и сервер с UTF-8 его отвергает.
    $q = "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'), (SELECT count(*) FROM schema_migrations), (SELECT count(*) FROM tickets), (SELECT count(*) FROM users)"
    $r = (& $psql -h localhost -p $Port -U $u -d $db -tAc $q 2>&1 | Out-String).Trim()
    $cols = $r -split '\|'
    if ($cols.Count -eq 4) {
        Write-Host "База ${db}: $($cols[0]) таблиц, $($cols[1]) миграций, $($cols[2]) заявок, $($cols[3]) пользователей"
    } else {
        Write-Host "База ${db}: $r" -ForegroundColor Yellow
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# --- API ---
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$ApiPort/health/ready" -UseBasicParsing -TimeoutSec 5
    Write-Host "API (порт $ApiPort): $($resp.Content)" -ForegroundColor Green
} catch {
    Write-Host "API (порт $ApiPort): не отвечает" -ForegroundColor Yellow
}

# --- Кто именно держит порт: нативная база или Docker ---
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $procName = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    $where = switch ($procName) {
        'postgres' { 'нативная база (каталог Root)' }
        'wslrelay' { 'Docker (контейнер domkrug-postgres)' }
        default    { $procName }
    }
    Write-Host "Источник базы: $where"
}

# --- Порты ---
foreach ($p in 5432, 9000, 9001, 3000, 5173) {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($c) {
        $pr = (Get-Process -Id $c[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host "  порт $p занят: $pr"
    }
}
