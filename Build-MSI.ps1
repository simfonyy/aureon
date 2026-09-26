param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$logDirectory = Join-Path $PSScriptRoot 'build-logs'
New-Item -ItemType Directory -Force $logDirectory | Out-Null
$log = Join-Path $logDirectory ('MSI-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $log | Out-Null
try {
    foreach ($tool in @('node.exe','npm.cmd','cargo.exe')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing $tool. Install Node.js LTS and Rust (MSVC), then reopen the build window." }
    }
    if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
        if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio Build Tools with Desktop development with C++ and a Windows SDK.' }
        $vs = & $vswhere -latest -prerelease -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if (-not $vs) { throw 'Visual Studio C++ Build Tools were not found.' }
        & (Join-Path $vs 'Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
    }
    if (-not $SkipInstall) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; see build log.' }
    }
    
    & npm.cmd run tauri -- build --bundles msi --verbose
    if ($LASTEXITCODE -ne 0) { throw 'Tauri MSI build failed; see build log.' }
    $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
    $bundle = Join-Path $PSScriptRoot 'src-tauri/target/release/bundle/msi'
    $installer = Get-ChildItem -LiteralPath $bundle -Filter "*_${version}_*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw "Build finished but MSI $version was not found in $bundle" }
    Write-Host "`nMSI READY: $($installer.FullName)" -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList ('/select,"' + $installer.FullName + '"')
} catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log: $log"
    exit 1
} finally { Stop-Transcript | Out-Null }