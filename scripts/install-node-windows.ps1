# Installs Node.js on Windows. Called by 1-install.bat.
# 1) try winget (built into Windows 10/11)  2) fall back to the official MSI from nodejs.org
$ErrorActionPreference = 'Stop'

function Test-Node {
    $candidates = @("$env:ProgramFiles\nodejs\node.exe")
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $candidates = @($cmd.Source) + $candidates }
    foreach ($exe in $candidates) {
        if (Test-Path $exe) {
            try {
                $major = [int](& $exe -p "process.versions.node.split('.')[0]")
                if ($major -ge 20) { return $true }
            } catch {}
        }
    }
    return $false
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
    Write-Host "      Dang cai Node.js bang winget..."
    try {
        & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    } catch {}
    if (Test-Node) { exit 0 }
    Write-Host "      winget khong cai duoc, chuyen sang tai tu nodejs.org..."
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $base = 'https://nodejs.org/dist/latest-v22.x'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[0-9.]+-$arch\.msi\s*$" } | Select-Object -First 1
    if (-not $line) { throw "Khong tim thay file cai dat Node.js cho $arch" }
    $file = ($line.Trim() -split '\s+')[-1]
    $msi = Join-Path $env:TEMP $file
    Write-Host "      Dang tai $file ..."
    Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $msi
    Write-Host "      Dang cai dat (bam YES neu Windows hoi quyen)..."
    $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/passive', '/norestart' -Wait -PassThru
    Remove-Item $msi -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "msiexec exit code $($p.ExitCode)" }
} catch {
    Write-Host "      LOI: $($_.Exception.Message)"
    exit 1
}

if (Test-Node) { exit 0 }
exit 1
