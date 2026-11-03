# Launch Cloak Desk on the CI runner, keep it alive for a while, screenshot it and collect crash evidence.
# Usage: smoke.ps1 -Exe <path to CloakDesk.exe> -Out <folder for logs and screenshots> [-Name <label>] [-Debugger]
param(
    [Parameter(Mandatory)] [string] $Exe,
    [Parameter(Mandatory)] [string] $Out,
    [string] $Name = "app",
    [int] $Seconds = 15,
    [switch] $Debugger
)
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $Out | Out-Null
$dataDir = Join-Path $env:LOCALAPPDATA "CloakDesk"
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
$env:CLOAKDESK_CAPTURABLE = "1"
$started = Get-Date

$p = Start-Process -FilePath $Exe -PassThru -RedirectStandardOutput "$Out\$Name-stdout.txt" -RedirectStandardError "$Out\$Name-stderr.txt"
Start-Sleep -Seconds $Seconds

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save("$Out\$Name-screen.png")

$alive = -not $p.HasExited
if ($alive) {
    Write-Host "[$Name] still running after $Seconds s, memory $([math]::Round($p.PrivateMemorySize64 / 1MB, 1)) MB private"
    Stop-Process -Id $p.Id -Force
} else {
    Write-Host ("[$Name] exited with code 0x{0:X8}" -f $p.ExitCode)
}

if (Test-Path "$dataDir\crash.log") { Copy-Item "$dataDir\crash.log" "$Out\$Name-crash.log"; Get-Content "$dataDir\crash.log" }
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $started } -ErrorAction SilentlyContinue |
    Where-Object { $_.ProviderName -in 'Application Error', 'Windows Error Reporting', '.NET Runtime' } |
    ForEach-Object { "---- $($_.ProviderName) $($_.TimeCreated)`n$($_.Message)" } |
    Tee-Object "$Out\$Name-events.txt"

if (-not $alive -and $Debugger) {
    # Run again under cdb and dump the stowed exception and stacks at the crash.
    $cdb = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\cdb.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cdb) {
        Write-Host "[$Name] rerunning under cdb"
        $cmds = 'sxe -c \"!analyze -v; .ecxr; kn 60; ~*kn 30; q\" c000027b; sxe -c \"!analyze -v; .ecxr; kn 60; q\" av; sxd eh; g; !analyze -v; kn 60; q'
        & $cdb.FullName -G -lines -c $cmds $Exe *> "$Out\$Name-cdb.txt"
        Get-Content "$Out\$Name-cdb.txt" | Select-String -Pattern 'STOWED|Error|HRESULT|EXCEPTION|ExceptionCode|SYMBOL_NAME|FAILURE_BUCKET|Microsoft_UI_Xaml|CloakDesk|^\s*[0-9a-f]{2} ' | Select-Object -First 200
    } else { Write-Host "cdb not found" }
}

if (-not $alive) { exit 1 }
