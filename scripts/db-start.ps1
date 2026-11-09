# ДомКруг — запуск локального PostgreSQL без Docker.
#
# ЧТО ГДЕ ЛЕЖИТ
#   База (бинарники + кластер) — вне репозитория, в каталоге $Root.
#   По умолчанию это <репозиторий>\.local — так проект работает на любой
#   машине без флагов. На машинах, где путь к репозиторию содержит кириллицу,
#   PostgreSQL на Windows не стартует (invalid byte sequence for encoding "UTF8"),
#   поэтому там Root надо задать явно в ASCII-каталоге:
#
#     .\scripts\db-start.ps1 -Root C:\domkrug-pg
#
#   Переменная окружения DOMKRUG_PG_ROOT задаёт Root по умолчанию — удобно,
#   если на машине принят один общий путь.
#
# ПОЧЕМУ БЕЗ DOCKER. На слабых машинах (8 ГБ RAM) Docker Desktop забирает
# 2–3 ГБ и заметно замедляет работу. Нативный PostgreSQL занимает ~200 МБ.
# Окружение всё равно одинаковое: версия 16.9 и те же миграции.
#
# Параметры (пользователь, пароль, порт, база) берутся из .env проекта —
# те же, что у docker-compose, поэтому DATABASE_URL менять не нужно.
#
# Использование:
#   .\scripts\db-start.ps1                  — запустить (создаст кластер при первом разе)
#   .\scripts\db-start.ps1 -Root C:\domkrug-pg
#   .\scripts\db-stop.ps1                   — остановить

[CmdletBinding()]
param(
    [string]$Root = '',
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot

# Root: -Root > DOMKRUG_PG_ROOT > <репозиторий>\.local
if (-not $Root) {
    if ($env:DOMKRUG_PG_ROOT) {
        $Root = $env:DOMKRUG_PG_ROOT
    } else {
        $Root = Join-Path $RepoRoot '.local'
    }
}

function Read-DotEnv([string]$path) {
    $result = @{}
    if (-not (Test-Path $path)) { return $result }
    foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $k, $v = $line -split '=', 2
        $result[$k.Trim()] = $v.Trim()
    }
    return $result
}

$cfg = Read-DotEnv (Join-Path $RepoRoot '.env')
$PgUser = if ($cfg['POSTGRES_USER']) { $cfg['POSTGRES_USER'] } else { 'domkrug' }
$PgPass = if ($cfg['POSTGRES_PASSWORD']) { $cfg['POSTGRES_PASSWORD'] } else { 'domkrug_dev_password' }
$PgDb = if ($cfg['POSTGRES_DB']) { $cfg['POSTGRES_DB'] } else { 'domkrug_dev' }
if ($Port -le 0) { $Port = if ($cfg['POSTGRES_PORT']) { [int]$cfg['POSTGRES_PORT'] } else { 5432 } }

if ($Root -match '[^\x00-\x7F]') {
    Write-Host "ОШИБКА: $Root содержит кириллицу." -ForegroundColor Red
    Write-Host 'PostgreSQL на Windows не работает на таких путях.' -ForegroundColor Yellow
    Write-Host 'Задайте ASCII-каталог: .\scripts\db-start.ps1 -Root C:\domkrug-pg' -ForegroundColor Yellow
    exit 1
}

$Bin = Join-Path $Root 'pgsql\bin'
$Data = Join-Path $Root 'pgdata'
$Log = Join-Path $Root 'pg.log'
$initdb = Join-Path $Bin 'initdb.exe'
$pgCtl = Join-Path $Bin 'pg_ctl.exe'
$isReady = Join-Path $Bin 'pg_isready.exe'

if (-not (Test-Path $isReady)) {
    Write-Host "Не найдены бинарники PostgreSQL: $Bin" -ForegroundColor Red
    Write-Host 'Скачайте портативную сборку и распакуйте так, чтобы был путь:' -ForegroundColor Yellow
    Write-Host "  $Bin\postgres.exe"
    Write-Host '  https://get.enterprisedb.com/postgresql/postgresql-16.9-1-windows-x64-binaries.zip'
    Write-Host ''
    Write-Host 'Либо поднимите базу в Docker: docker compose up -d postgres' -ForegroundColor Yellow
    exit 1
}

# Уже запущен?
& $isReady -h localhost -p $Port *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host "PostgreSQL уже слушает порт $Port."
    Write-Host "База: $PgDb, каталог: $Root"
    exit 0
}

# Первый запуск: создаём кластер
if (-not (Test-Path (Join-Path $Data 'PG_VERSION'))) {
    Write-Host "Создаю кластер в $Data ..." -ForegroundColor Cyan
    $pwFile = Join-Path $Root 'pwfile.txt'
    Set-Content -LiteralPath $pwFile -Value $PgPass -Encoding ascii -NoNewline
    try {
        & $initdb -D $Data -U $PgUser --pwfile=$pwFile --encoding=UTF8 --locale=C `
            --auth-local=scram-sha-256 --auth-host=scram-sha-256 2>&1 |
            Select-Object -Last 3 | Write-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'initdb завершился с ошибкой.' -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Запускаю PostgreSQL на порту $Port (каталог: $Root)..." -ForegroundColor Cyan
# ВАЖНО: pg_ctl держит stdout, поэтому запуск через Start-Process с редиректом,
# иначе PowerShell зависает на захвате вывода.
Start-Process -FilePath (Join-Path $Bin 'postgres.exe') `
    -ArgumentList @('-D', "`"$Data`"", '-p', $Port) `
    -RedirectStandardOutput (Join-Path $Root 'postgres.out.log') `
    -RedirectStandardError (Join-Path $Root 'postgres.err.log') `
    -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    & $isReady -h localhost -p $Port *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "PostgreSQL готов: localhost:$Port" -ForegroundColor Green
        # База могла ещё не существовать — создаём при первом запуске
        $psql = Join-Path $Bin 'psql.exe'
        $env:PGPASSWORD = $PgPass
        $exists = (& $psql -h localhost -p $Port -U $PgUser -d postgres -tAc `
            "SELECT 1 FROM pg_database WHERE datname='$PgDb'" 2>&1 | Out-String).Trim()
        if ($exists -ne '1') {
            & (Join-Path $Bin 'createdb.exe') -h localhost -p $Port -U $PgUser -E UTF8 $PgDb 2>&1 | Out-Null
            Write-Host "Создана база $PgDb"
        }
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        Write-Host "База: $PgDb | пользователь: $PgUser | каталог: $Root"
        exit 0
    }
}

Write-Host 'PostgreSQL не запустился за 30 секунд.' -ForegroundColor Red
foreach ($f in @((Join-Path $Root 'postgres.err.log'), $Log)) {
    if (Test-Path $f) {
        Write-Host "--- $f ---" -ForegroundColor Yellow
        Get-Content -LiteralPath $f -Tail 15
    }
}
exit 1
