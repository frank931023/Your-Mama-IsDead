# Loads .env (UTF-8) into the current PowerShell session.
# Usage:  . .\load-env.ps1            (note the leading dot + space — dot-source)
#         . .\load-env.ps1 -Path foo  (load a different env file)
[CmdletBinding()]
param(
    [string] $Path = ""
)

# Ensure the terminal renders UTF-8 properly (otherwise CJK in logs becomes
# `擳?蟡?` mojibake on default Big5/CP950 Windows installs).
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    [Console]::InputEncoding  = [System.Text.UTF8Encoding]::new()
    chcp 65001 *> $null
} catch { }

if (-not $Path) {
    # Resolve script directory robustly across dot-sourcing styles.
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } `
                 elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } `
                 else { (Get-Location).Path }
    $Path = Join-Path $scriptDir ".env"
}

if (-not (Test-Path $Path)) {
    Write-Error "env file not found: $Path"
    return
}

$count = 0
Get-Content -Path $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { return }

    $idx = $line.IndexOf('=')
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    # strip surrounding quotes if present
    if ($v.Length -ge 2 -and (
        ($v.StartsWith('"') -and $v.EndsWith('"')) -or
        ($v.StartsWith("'") -and $v.EndsWith("'"))
    )) {
        $v = $v.Substring(1, $v.Length - 2)
    }

    Set-Item -Path "Env:\$k" -Value $v
    $count++
}

# Also prepend ~/.foundry/bin to PATH for forge/cast/anvil convenience.
$forgeBin = "$env:USERPROFILE\.foundry\bin"
if ((Test-Path $forgeBin) -and ($env:Path -notlike "*$forgeBin*")) {
    $env:Path = "$forgeBin;$env:Path"
}

Write-Host "Loaded $count env vars from $Path" -ForegroundColor Green
