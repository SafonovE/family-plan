$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$file=Join-Path $projectRoot 'private\server.json'
if (Test-Path -LiteralPath $file) {
    $info=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $child=Get-Process -Id $info.pid -ErrorAction SilentlyContinue
    $expected=Join-Path $projectRoot '.runtime\php\php.exe'
    $listening=netstat -ano -p tcp | Where-Object { $_ -match (':'+[regex]::Escape([string]$info.port)+'\s+.*LISTENING\s+'+[regex]::Escape([string]$info.pid)+'\s*$') }
    if ($child -and $child.Path -eq $expected -and $info.root -eq $projectRoot -and $listening) {
        Stop-Process -Id $child.Id
    }
}
