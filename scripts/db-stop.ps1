# ДомКруг — остановка локального PostgreSQL.
#
# Корректное завершение (fast): активные транзакции откатываются,
# сервер закрывает файлы данных. Не убивайте процесс через Диспетчер
# задач — это может повредить кластер.
#
# Root по умолчанию: DOMKRUG_PG_ROOT, иначе <репозиторий>\.local.
# Если база лежит в другом месте: .\scripts\db-stop.ps1 -Root C:\domkrug-pg
#
# Использование: .\scripts\db-stop.ps1

[CmdletBinding()]
param(
    [string]$Root = '',
    [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $Root) {
    if ($env:DOMKRUG_PG_ROOT) {
        $Root = $env:DOMKRUG_PG_ROOT
    } else {
        $Root = Join-Path $RepoRoot '.local'
    }
}

$Bin = Join-Path $Root 'pgsql\bin'
$Data = Join-Path $Root 'pgdata'

if (-not (Test-Path (Join-Path $Bin 'pg_ctl.exe'))) {
    Write-Host "Бинарники PostgreSQL не найдены: $Bin" -ForegroundColor Yellow
    exit 1
}

& (Join-Path $Bin 'pg_isready.exe') -h localhost -p $Port *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PostgreSQL не запущен.' -ForegroundColor Yellow
    exit 0
}

Write-Host 'Останавливаю PostgreSQL...' -ForegroundColor Cyan
& (Join-Path $Bin 'pg_ctl.exe') -D $Data -m fast -w -t 30 stop 2>&1 | Select-Object -Last 3 | Write-Host
if ($LASTEXITCODE -eq 0) {
    Write-Host 'PostgreSQL остановлен.' -ForegroundColor Green
} else {
    Write-Host "Не удалось остановить корректно (код $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}
