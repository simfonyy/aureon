param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $projectRoot
$logDirectory = Join-Path $projectRoot 'build-logs'
New-Item -ItemType Directory -Force $logDirectory | Out-Null
$log = Join-Path $logDirectory ('MSI-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $log | Out-Null
try {
    foreach ($tool in @('node.exe','cargo.exe')) {
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
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Missing npm.cmd. Use -SkipInstall if dependencies are already installed.' }
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; see build log.' }
    }
    
    & (Join-Path $PSScriptRoot 'Prepare-InstallerArtwork.ps1')
    $desktopCrateType = (Select-String -LiteralPath 'src-tauri/Cargo.toml' -Pattern '^crate-type\s*=').Line
    $obsoleteLibrary = Join-Path $projectRoot 'src-tauri/target/release/mashiro_lib.dll'
    if ($desktopCrateType -and $desktopCrateType -notlike '*"cdylib"*' -and (Test-Path -LiteralPath $obsoleteLibrary)) {
        $resolvedLibrary = (Resolve-Path -LiteralPath $obsoleteLibrary).Path
        $expectedDirectory = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'src-tauri/target/release')).Path
        if ([IO.Path]::GetDirectoryName($resolvedLibrary) -ne $expectedDirectory) { throw 'Unexpected build artifact path.' }
        Move-Item -LiteralPath $resolvedLibrary -Destination ($resolvedLibrary + '.' + [Guid]::NewGuid().ToString('N') + '.unused')
    }
    & node node_modules/@tauri-apps/cli/tauri.js build --bundles msi --verbose -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Tauri MSI build failed; see build log.' }
    $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
    $bundle = Join-Path $projectRoot 'src-tauri/target/release/bundle/msi'
    $installer = Get-ChildItem -LiteralPath $bundle -Filter "*_${version}_*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw "Build finished but MSI $version was not found in $bundle" }
    Write-Host "`nMSI READY: $($installer.FullName)" -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList ('/select,"' + $installer.FullName + '"')
} catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log: $log"
    exit 1
} finally { Stop-Transcript | Out-Null }
