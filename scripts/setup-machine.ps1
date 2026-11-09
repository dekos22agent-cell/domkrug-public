<#
.SYNOPSIS
    Подготовка машины к работе над liviti: окружение, база, тесты.

.DESCRIPTION
    Запускать из корня репозитория после клонирования. Скрипт идемпотентен:
    повторный запуск ничего не ломает, уже сделанные шаги пропускаются.

    Что делает:
      1. Проверяет, что путь к проекту без кириллицы (иначе PostgreSQL падает).
      2. Проверяет Node.js 22+.
      3. Создаёт .env с собственным JWT_SECRET (если файла ещё нет).
      4. Ставит зависимости бэкенда и фронтенда (если их нет).
      5. Поднимает PostgreSQL в Docker и ждёт готовности.
      6. Применяет миграции; демо-данные — только по флагу -SeedData.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup-machine.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup-machine.ps1 -SeedData
#>
[CmdletBinding()]
param(
    # Загрузить демо-данные. Осторожно: добавляет записи в базу.
    [switch]$SeedData,

    # Переустановить зависимости, даже если node_modules уже есть.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Die($text) { Write-Host "`nОШИБКА: $text" -ForegroundColor Red; exit 1 }

# ── 1. Путь без кириллицы ────────────────────────────────────────────────────
Step 1 'Проверяю путь к проекту'

$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root 'backend\package.json'))) {
    Die "Запускать из корня репозитория (не найден backend\package.json). Текущий путь: $root"
}
if ($root -match '[^\x00-\x7F]') {
    Die @"
В пути есть не-латинские символы:
  $root

PostgreSQL на Windows падает на таких путях с ошибкой
  invalid byte sequence for encoding "UTF8"
и ломаются git и node-gyp.

Перенесите проект в путь только из латиницы, например:
  git clone <репозиторий> C:\Projects\domkrug
"@
}
Ok $root

# ── 2. Node.js ───────────────────────────────────────────────────────────────
Step 2 'Проверяю Node.js'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'Node.js не найден. Установите 22 или новее: https://nodejs.org' }

$nodeVersion = (& node -v).TrimStart('v')
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) { Die "Нужен Node.js 22 или новее, установлен $nodeVersion" }
Ok "node $nodeVersion"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Die 'npm не найден рядом с node' }

# ── 3. .env ──────────────────────────────────────────────────────────────────
Step 3 'Файл окружения .env'

$envPath = Join-Path $root '.env'
if (Test-Path $envPath) {
    Ok '.env уже есть — не трогаю'
} else {
    Copy-Item (Join-Path $root '.env.example') $envPath
    $secret = (& node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
    $content = Get-Content $envPath -Raw
    $content = $content -replace 'JWT_SECRET=.*', "JWT_SECRET=$secret"
    [System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))
    Ok 'создан, JWT_SECRET сгенерирован заново'
}

# ── 4. Зависимости ───────────────────────────────────────────────────────────
Step 4 'Зависимости'

foreach ($part in @('backend', 'frontend')) {
    $dir = Join-Path $root $part
    $modules = Join-Path $dir 'node_modules'
    if ((Test-Path $modules) -and (-not $Force)) {
        Ok "$part — уже установлены (переустановить: -Force)"
        continue
    }
    Write-Host "    $part — npm ci, это займёт минуту…"
    Push-Location $dir
    try {
        & npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Die "npm ci упал в $part" }
    } finally {
        Pop-Location
    }
    Ok "$part — готово"
}

# ── 5. База данных ───────────────────────────────────────────────────────────
Step 5 'PostgreSQL'

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Warn 'Docker не найден. База не поднята.'
    Warn 'Поставьте Docker Desktop либо запустите scripts\db-start.ps1 (портативный PostgreSQL).'
    Warn 'Дальше вручную: cd backend; npm run migrate'
    exit 0
}

Push-Location $root
try {
    & docker compose up -d postgres
    if ($LASTEXITCODE -ne 0) { Die 'docker compose up -d postgres завершился ошибкой' }
} finally {
    Pop-Location
}

Write-Host '    ждём готовности контейнера…'
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 2
    $status = (& docker inspect --format '{{.State.Health.Status}}' domkrug-postgres 2>$null)
    if ($status -eq 'healthy') { $ready = $true; break }
}
if (-not $ready) { Die 'Контейнер domkrug-postgres не стал healthy за 60 секунд. Смотрите: docker logs domkrug-postgres' }
Ok 'domkrug-postgres healthy'

# ── 6. Миграции и данные ─────────────────────────────────────────────────────
Step 6 'Схема базы'

Push-Location (Join-Path $root 'backend')
try {
    & npm run migrate
    if ($LASTEXITCODE -ne 0) { Die 'Миграции не применились' }

    if ($SeedData) {
        & npm run db:seed
        if ($LASTEXITCODE -ne 0) { Die 'Демо-данные не загрузились' }
        Ok 'демо-данные загружены'
    } else {
        Warn 'демо-данные не загружались (нужны? добавьте -SeedData)'
    }
} finally {
    Pop-Location
}

# ── Итог ─────────────────────────────────────────────────────────────────────
Write-Host "`n──────── ГОТОВО ────────" -ForegroundColor Green
Write-Host @'
Дальше два окна:

  cd backend
  npm run dev          → API   http://localhost:3000

  cd frontend
  npm run dev          → сайт  http://localhost:5173

Проверки перед правками и после них:

  cd backend
  npm run typecheck
  npm test
  npm run test:api

Демо-входы (если запускали с -SeedData), пароль Demo1234!:
  +79000000001  администратор УК
  +79000000002  диспетчер
  +79000000003  исполнитель
  +79000000101  житель, кв. 1

Подробности — docs/OFFICE-MACHINE.md
'@ -ForegroundColor Gray
