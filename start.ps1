# One-click dev setup. Everything runs in docker compose now:
# postgres / redis / minio / backend (:4000) / frontend (:3000).
# Usage:  .\start.ps1
#         .\start.ps1 -InfraOnly   (只起 postgres/redis/minio;想本機直跑
#                                   backend/frontend 時用,見 README Manual Startup)

[CmdletBinding()]
param(
    [switch] $InfraOnly
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# docker compose 的進度訊息走 stderr;在 Windows PowerShell 5.1 + $ErrorActionPreference="Stop"
# 下會被當成致命錯誤而中斷腳本(即使容器有成功起來)。用 cmd /c 把 stderr 併進 stdout,
# 讓 PS 只看退出碼、不誤判 stderr。回傳 docker 的 exit code。
function Invoke-Compose {
    param([string] $ComposeArgs)
    # Out-Host 讓 docker 輸出印到主控台、不進函式回傳值,否則 return 會夾帶所有輸出行
    # 變成陣列,呼叫端的 "-ne 0" 判斷就失準。只回傳整數退出碼。
    cmd /c "docker compose $ComposeArgs 2>&1" | Out-Host
    return $LASTEXITCODE
}

# backend/frontend 容器用 env_file 讀根目錄 .env,沒有它起不來
if (-not (Test-Path (Join-Path $root ".env"))) {
    throw ".env not found — Copy-Item .env.example .env 並填入 secrets(見 README First-Time Setup)"
}

if ($InfraOnly) {
    Step "Starting infra only (postgres / redis / minio)"
    $code = Invoke-Compose "up -d postgres redis minio"
    if ($code -ne 0) { throw "docker compose failed — is Docker Desktop running?" }
    Write-Host "`nInfra up. backend/frontend 請本機直跑(見 README Manual Startup)。" -ForegroundColor Green
    return
}

Step "Starting full stack (docker compose up -d)"
$code = Invoke-Compose "up -d"
if ($code -ne 0) { throw "docker compose failed — is Docker Desktop running?" }

Write-Host "`nAll up." -ForegroundColor Green
Write-Host "  frontend  http://localhost:3000"
Write-Host "  backend   http://localhost:4000"
Write-Host "`n首次啟動 backend/frontend 會在容器內 npm install + prisma migrate,可能需要幾分鐘。" -ForegroundColor DarkGray
Write-Host "看啟動進度:  docker compose logs -f backend frontend" -ForegroundColor DarkGray
Write-Host "全部關閉:    docker compose down" -ForegroundColor DarkGray
