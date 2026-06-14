# One-click dev setup. Brings up infra + installs deps + migrates DB,
# then prints the two commands for you to run in VSCode terminal panes.
# Usage:  .\start.ps1
#         .\start.ps1 -InfraOnly    (just docker, no install/migrate)
#         .\start.ps1 -SkipInstall  (skip npm install)
#         .\start.ps1 -SkipMigrate  (skip prisma migrate)

[CmdletBinding()]
param(
    [switch] $SkipInstall,
    [switch] $SkipMigrate,
    [switch] $InfraOnly
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# 1) env
Step "Loading .env"
. (Join-Path $root "load-env.ps1")

# 2) infra
Step "Starting infra (docker compose up -d)"
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose failed — is Docker Desktop running?" }

# 3) wait for postgres
Step "Waiting for postgres healthcheck"
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    $health = docker inspect --format '{{.State.Health.Status}}' (docker compose ps -q postgres) 2>$null
    if ($health -eq "healthy") { Write-Host "postgres ready." -ForegroundColor Green; break }
    Start-Sleep -Seconds 2
}
if ($health -ne "healthy") { throw "postgres did not become healthy within 60s" }

if ($InfraOnly) { Step "InfraOnly set — done."; return }

# 4) npm install (skip if node_modules already present)
foreach ($svc in @("backend", "frontend")) {
    $svcPath = Join-Path $root $svc
    $nm = Join-Path $svcPath "node_modules"
    if ($SkipInstall) { continue }
    if (-not (Test-Path $nm)) {
        Step "npm install in $svc"
        Push-Location $svcPath
        npm install
        if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed in $svc" }
        Pop-Location
    } else {
        Write-Host "node_modules already present in $svc — skipping install" -ForegroundColor DarkGray
    }
}

# 5) prisma
if (-not $SkipMigrate) {
    Step "prisma generate + migrate (backend)"
    Push-Location (Join-Path $root "backend")
    npx prisma generate
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "prisma generate failed" }
    # migrate deploy (不是 migrate dev):只套用 pending migrations,不做 schema diff。
    # migrate dev 會把 Prisma schema 表達不了的 hnsw 向量索引 (MemoryChunk) 誤判成
    # drift 而自動生成 DROP INDEX。要改 schema 時請手寫 migration 或用
    # `npx prisma migrate dev --create-only` 並檢查生成的 SQL。
    npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "prisma migrate failed" }
    Pop-Location
}

# 6) Launch backend + frontend dev servers in their own PowerShell windows
Step "Launching backend dev server (new window)"
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$root\backend'; . '$root\load-env.ps1'; npm run dev"
)

Step "Launching frontend dev server (new window)"
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$root\frontend'; . '$root\load-env.ps1'; npm run dev"
)

Write-Host "`nAll up. Backend + frontend are running in their own windows." -ForegroundColor Green
Write-Host "Stop infra later with:  docker compose down" -ForegroundColor DarkGray
