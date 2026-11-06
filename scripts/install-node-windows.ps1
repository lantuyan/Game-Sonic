# Installs Node.js 22 on Windows. Called by 1-install.bat.
# 1) try winget (built into Windows 10/11), max 10 minutes
# 2) fall back to the official MSI from nodejs.org
$ErrorActionPreference = 'Stop'

function Test-Node {
    $candidates = @("$env:ProgramFiles\nodejs\node.exe")
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $candidates = @($cmd.Source) + $candidates }
    foreach ($exe in $candidates) {
        if (Test-Path $exe) {
            try {
                $ver = (& $exe -v) 2>$null
                if ($ver -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { return $true }
            } catch {}
        }
    }
    return $false
}

# ---- 1) winget ------------------------------------------------------
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
    Write-Host "      Dang cai Node.js bang winget (co the mat vai phut)..."
    try {
        $wp = Start-Process winget -ArgumentList 'install','-e','--id','OpenJS.NodeJS.22','--source','winget','--accept-source-agreements','--accept-package-agreements','--silent' -NoNewWindow -PassThru
        if (-not $wp.WaitForExit(600000)) {
            Write-Host "      winget chay qua lau, dung lai."
            try { $wp.Kill() } catch {}
        }
    } catch {}
    if (Test-Node) { exit 0 }
    Write-Host "      winget khong cai duoc, chuyen sang tai tu nodejs.org..."
}

# ---- 2) MSI tu nodejs.org ------------------------------------------
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $base = 'https://nodejs.org/dist/latest-v22.x'

    $pa = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = if ($pa -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }

    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[0-9.]+-$arch\.msi\s*$" } | Select-Object -First 1
    if (-not $line) { throw "Khong tim thay file cai dat Node.js cho may $arch" }
    $file = ($line.Trim() -split '\s+')[-1]
    $msi = Join-Path $env:TEMP $file

    Write-Host "      Dang tai $file ..."
    Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $msi

    Write-Host "      Dang cai dat. Neu Windows hoi quyen, hay bam YES."
    $p = $null
    for ($i = 0; $i -lt 3; $i++) {
        $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/passive', '/norestart' -Verb RunAs -Wait -PassThru
        if ($p.ExitCode -ne 1618) { break }
        Write-Host "      Windows dang cai mot chuong trinh khac, cho 30 giay roi thu lai..."
        Start-Sleep -Seconds 30
    }
    Remove-Item $msi -ErrorAction SilentlyContinue

    $code = $p.ExitCode
    if ($code -eq 1602 -or $code -eq 1223) { throw "Ban da bam NO/Cancel. Hay chay lai va bam YES." }
    if ($code -eq 1618) { throw "Windows dang cai dat/cap nhat chuong trinh khac. Doi xong roi chay lai." }
    if ($code -ne 0 -and $code -ne 3010 -and $code -ne 1641) { throw "Cai dat that bai (ma loi $code)" }
} catch {
    $msg = $_.Exception.Message
    if ($msg -match 'canceled by the user|operation was canceled') { $msg = "Ban da bam NO/Cancel. Hay chay lai va bam YES." }
    Write-Host "      LOI: $msg"
    exit 1
}

if (Test-Node) { exit 0 }
exit 1
