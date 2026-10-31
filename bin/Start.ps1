param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $phpPath = Join-Path $projectRoot '.runtime\php\php.exe'
    if (-not (Test-Path -LiteralPath $phpPath)) { throw 'Не найден переносной PHP. Откройте README.md или используйте опубликованную версию.' }
    $extensionPath = Join-Path $projectRoot '.runtime\php\ext'
    & $phpPath -n (Join-Path $PSScriptRoot 'configure.php') --local | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать локальную настройку.' }
    $env:FAMILY_CONFIG = Join-Path $projectRoot 'private\config.php'
    $serverPort = 18426
    $baseUrl = "http://127.0.0.1:$serverPort/"
    $ready = $null
    try { $ready = Invoke-RestMethod -Uri ($baseUrl + 'api.php?action=session') -TimeoutSec 2 } catch { }
    if (-not $ready.csrf) {
        $publicPath = Join-Path $projectRoot 'public'
        $arguments = '-n -d "extension_dir=' + $extensionPath + '" -d extension=pdo_sqlite -d extension=pdo_mysql -S 127.0.0.1:' + $serverPort + ' -t "' + $publicPath + '"'
        $child = Start-Process -FilePath $phpPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $projectRoot 'private\server.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'private\server.stderr.log')
        @{pid=$child.Id;root=$projectRoot;port=$serverPort} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'private\server.json') -Encoding UTF8
        for ($attempt=0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 150
            try { $ready=Invoke-RestMethod -Uri ($baseUrl+'api.php?action=session') -TimeoutSec 2; if ($ready.csrf) { break } } catch { }
        }
    }
    if (-not $ready.csrf) { throw 'Бюджет не запустился. Проверьте private\server.stderr.log. Возможно, порт 18426 уже занят.' }
    $url=$baseUrl
    if ($ready.needsSetup) { $fragment=& $phpPath -n (Join-Path $PSScriptRoot 'configure.php') --setup-fragment; $url += $fragment }
    if ($NoBrowser) { Write-Output ('Local server ready: '+$baseUrl) } else { Start-Process $url }
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message,'Семейный план') | Out-Null
    exit 1
}
