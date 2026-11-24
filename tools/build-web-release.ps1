# SPDX-License-Identifier: GPL-3.0-or-later
[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '0.1.0'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path -Parent $PSScriptRoot
$output = Join-Path $repo 'dist'
$cache = Join-Path $output 'runtime-cache'
New-Item -ItemType Directory -Path $cache -Force | Out-Null

$nodeVersion = '24.22.3'
$pythonVersion = '3.13.17'
$nodeName = "node-v$nodeVersion-win-x64"
$nodeUrl = "https://nodejs.org/download/release/v$nodeVersion/$nodeName.zip"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"

function Get-VerifiedArchive {
    param([string]$Url, [string]$Sha256)

    $archive = Join-Path $cache ([IO.Path]::GetFileName($Url))
    if ((Test-Path -LiteralPath $archive) -and (Get-FileHash -LiteralPath $archive).Hash -eq $Sha256) {
        return $archive
    }
    $download = "$archive.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        & curl.exe -q -4 --fail --silent --show-error --location --proto '=https' `
            --retry 2 --max-time 150 --output $download $Url
        if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $download).Hash -ne $Sha256) {
            throw "Download or SHA-256 verification failed for $Url"
        }
        Move-Item -LiteralPath $download -Destination $archive -Force
        return $archive
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}

$nodeArchive = Get-VerifiedArchive $nodeUrl 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'
$pythonArchive = Get-VerifiedArchive $pythonUrl '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'
$stage = Join-Path $output ".web-build-$([Guid]::NewGuid().ToString('N'))"
$name = "X20CTL-Web-$Version-windows-x64"
$bundle = Join-Path $stage $name
$nodeDir = Join-Path $bundle 'runtime/node'
$pythonDir = Join-Path $bundle 'runtime/python'

$files = @(
    'start-web.cmd', 'LICENSE', 'NOTICE', 'THIRD_PARTY.md',
    'licenses/MIT-BEFORE-4.1.0-preview.3.txt',
    'licenses/MICROSOFT-WEBVIEW2.txt',
    'web/index.html', 'web/style.css', 'web/app.mjs', 'web/demo.mjs', 'web/device.mjs',
    'web/protocol.mjs', 'web/start-web.cmd', 'web/launch.mjs', 'web/serve.mjs',
    'web/input-bridge.mjs', 'web/input_bridge.py',
    'web/transport.html', 'web/transport-page.mjs', 'web/usb-probe.mjs', 'web/receiver-observation.mjs',
    'x20ctl/__init__.py', 'x20ctl/input.py', 'x20ctl/protocol.py',
    'assets/x20ctl.png',
    'src/assets/controllers/x20/native/front-full.png',
    'src/assets/controllers/x20/native/rear-full.png',
    'src/assets/controllers/x20_pro/native/front-full.png',
    'src/assets/controllers/x20_pro/native/rear-full.png'
)

try {
    New-Item -ItemType Directory -Path $nodeDir, $pythonDir -Force | Out-Null
    foreach ($file in $files) {
        $target = Join-Path $bundle $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $target
    }
    Copy-Item -LiteralPath (Join-Path $repo 'web/PORTABLE.md') -Destination (Join-Path $bundle 'README.md')

    $nodeStage = Join-Path $stage 'node'
    [IO.Compression.ZipFile]::ExtractToDirectory($nodeArchive, $nodeStage)
    Copy-Item -LiteralPath (Join-Path $nodeStage "$nodeName/node.exe"), (Join-Path $nodeStage "$nodeName/LICENSE") -Destination $nodeDir
    [IO.Compression.ZipFile]::ExtractToDirectory($pythonArchive, $pythonDir)
    Add-Content -LiteralPath (Join-Path $pythonDir 'python313._pth') -Value '..\..' -Encoding Ascii

    @"
# Bundled runtimes

- Node.js $nodeVersion (Windows x64). [License](runtime/node/LICENSE), [binary distribution]($nodeUrl), [source](https://nodejs.org/download/release/v$nodeVersion/node-v$nodeVersion.tar.gz).
- Python $pythonVersion (Windows x64 embeddable distribution). [License](runtime/python/LICENSE.txt), [binary distribution]($pythonUrl), [source](https://www.python.org/ftp/python/$pythonVersion/Python-$pythonVersion.tgz).
- X20CTL Web $Version. [GPL-3.0-or-later](LICENSE), [notices](NOTICE), [source and build scripts](https://github.com/daoying0117/x20ctl/tree/web-v$Version).
"@ | Set-Content -LiteralPath (Join-Path $bundle 'RUNTIMES.md') -Encoding Ascii

    $pendingZip = Join-Path $stage "$name.zip"
    [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $pendingZip, [IO.Compression.CompressionLevel]::Optimal, $true)
    $hash = (Get-FileHash -LiteralPath $pendingZip).Hash.ToLowerInvariant()
    $zip = Join-Path $output "$name.zip"
    Move-Item -LiteralPath $pendingZip -Destination $zip -Force
    "$hash  $name.zip" | Set-Content -LiteralPath "$zip.sha256" -Encoding Ascii
    Get-Item -LiteralPath $zip, "$zip.sha256"
} finally {
    if (Test-Path -LiteralPath $stage) {
        $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
        $resolvedOutput = (Resolve-Path -LiteralPath $output).Path
        if ((Split-Path -Parent $resolvedStage) -eq $resolvedOutput -and
            (Split-Path -Leaf $resolvedStage) -match '^\.web-build-[0-9a-f]{32}$') {
            Remove-Item -LiteralPath $resolvedStage -Recurse -Force
        }
    }
}
