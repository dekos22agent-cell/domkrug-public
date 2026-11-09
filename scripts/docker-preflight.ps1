# ДомКруг — проверка окружения перед запуском Docker-стека.
# Запускать от имени администратора: .\scripts\docker-preflight.ps1
# Сам ничего не меняет — только сообщает, чего не хватает.

$ErrorActionPreference = 'Continue'

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "=== ДомКруг: проверка окружения Docker ===" -ForegroundColor Cyan

$isAdmin = Test-Admin
Write-Host ("Права администратора: " + ($(if ($isAdmin) { 'ДА' } else { 'НЕТ (часть проверок не выполнится)' })))

# --- Windows ---
$os = Get-CimInstance Win32_OperatingSystem
Write-Host "Windows: $($os.Caption) $($os.Version) build $($os.BuildNumber)"
Write-Host "RAM: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) ГБ"

# --- Виртуализация ---
$hv = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
Write-Host "Гипервизор (Hyper-V/WSL2) активен: $hv" -ForegroundColor $(if ($hv) { 'Green' } else { 'Yellow' })

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Host "CPU: $($cpu.Name)"
Write-Host "  VirtualizationFirmwareEnabled: $($cpu.VirtualizationFirmwareEnabled)  (False = VT-x выключен в BIOS)"
Write-Host "  SecondLevelAddressTranslation: $($cpu.SecondLevelAddressTranslationExtensions)"

# --- Компоненты Windows ---
$features = @(
    'Microsoft-Windows-Subsystem-Linux',
    'VirtualMachinePlatform',
    'Microsoft-Hyper-V-All'
)
if ($isAdmin) {
    foreach ($f in $features) {
        $raw = & dism /online /get-featureinfo /featurename:$f 2>&1
        $state = $raw | Where-Object { $_ -match 'Состояние|State' } | Select-Object -First 1
        $state = ($state -replace '^\s*(Состояние|State)\s*:\s*', '').Trim()
        $color = if ($state -match 'Включен|Enabled') { 'Green' } else { 'Yellow' }
        Write-Host "Компонент $f : $state" -ForegroundColor $color
    }
} else {
    Write-Host 'Компоненты Windows: запустите скрипт от администратора, чтобы увидеть состояние' -ForegroundColor Yellow
}

# --- Docker ---
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    $cand = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
    if (Test-Path $cand) { $docker = $cand } 
}
if ($docker) {
    $src = if ($docker -is [string]) { $docker } else { $docker.Source }
    Write-Host "Docker CLI: $((& $src --version 2>&1))"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $srv = & $src info --format '{{.ServerVersion}}' 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    $srvText = ($srv | Out-String).Trim()
    if ($code -eq 0 -and $srvText -match '^\d+\.\d+') {
        Write-Host "Движок Docker запущен: $srvText" -ForegroundColor Green
    } else {
        Write-Host 'Движок Docker НЕ отвечает' -ForegroundColor Red
        $first = ($srvText -split "`r?`n" | Where-Object { $_.Trim() })[0]
        Write-Host "  $first"
    }
} else {
    Write-Host 'Docker CLI не найден' -ForegroundColor Red
}

# --- Порты ---
foreach ($p in 5432, 9000, 9001, 3000, 5173) {
    $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $procName = (Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host "Порт $p ЗАНЯТ процессом $procName (pid $($conn[0].OwningProcess))" -ForegroundColor Yellow
    } else {
        Write-Host "Порт $p свободен" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Если "Гипервизор" = False и VirtualizationFirmwareEnabled = False,' -ForegroundColor Yellow
Write-Host 'нужно включить Intel Virtualization Technology (VT-x) в BIOS/UEFI.' -ForegroundColor Yellow
Write-Host 'Это делается при перезагрузке, до загрузки Windows (F2 / Del / F10).' -ForegroundColor Yellow
