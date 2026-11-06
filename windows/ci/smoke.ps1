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

# Collect OutputDebugString (WinUI writes XAML errors there with line and position), like DebugView.
Add-Type @'
using System; using System.Threading; using System.Runtime.InteropServices; using System.Collections.Concurrent;
public static class DbgOut {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateEvent(IntPtr a, bool manual, bool init, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateFileMapping(IntPtr h, IntPtr a, uint prot, uint hi, uint lo, string name);
    [DllImport("kernel32.dll")] static extern IntPtr MapViewOfFile(IntPtr h, uint access, uint hi, uint lo, UIntPtr n);
    [DllImport("kernel32.dll")] static extern bool SetEvent(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    public static ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static void Start() {
        var ready = CreateEvent(IntPtr.Zero, false, false, "DBWIN_BUFFER_READY");
        var data = CreateEvent(IntPtr.Zero, false, false, "DBWIN_DATA_READY");
        var map = CreateFileMapping(new IntPtr(-1), IntPtr.Zero, 4, 0, 4096, "DBWIN_BUFFER");
        var view = MapViewOfFile(map, 4, 0, 0, new UIntPtr(4096));
        if (view == IntPtr.Zero) return;
        var t = new Thread(() => {
            while (true) {
                SetEvent(ready);
                if (WaitForSingleObject(data, 1000) != 0) continue;
                Lines.Enqueue(Marshal.ReadInt32(view) + ": " + Marshal.PtrToStringAnsi(IntPtr.Add(view, 4)));
            }
        });
        t.IsBackground = true; t.Start();
    }
}
'@ -ErrorAction SilentlyContinue
[DbgOut]::Start()

$p = Start-Process -FilePath $Exe -PassThru -RedirectStandardOutput "$Out\$Name-stdout.txt" -RedirectStandardError "$Out\$Name-stderr.txt"
Start-Sleep -Seconds $Seconds

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save("$Out\$Name-screen.png")

$crashed = $p.HasExited
$alive = -not $crashed
if ($alive) {
    $p.Refresh() # Process caches its counters from the first read
    # Alive is not enough: a startup error dialog keeps the process alive too. Require the main window.
    if ($p.MainWindowTitle -ne 'Cloak Desk') { Write-Host "[$Name] running but main window is '$($p.MainWindowTitle)'"; $alive = $false }
    Write-Host "[$Name] still running after $Seconds s, memory $([math]::Round($p.PrivateMemorySize64 / 1MB, 1)) MB private"
    Stop-Process -Id $p.Id -Force
} else {
    Write-Host ("[$Name] exited with code 0x{0:X8}" -f $p.ExitCode)
}

$debugLines = @([DbgOut]::Lines.ToArray()) | Where-Object { $_ -like "$($p.Id): *" }
$debugLines | Set-Content "$Out\$Name-debug-output.txt"
if ($debugLines) { Write-Host "---- [$Name] debug output"; $debugLines | Select-Object -Last 60 | ForEach-Object { Write-Host $_ } }

if (Test-Path "$dataDir\crash.log") { Copy-Item "$dataDir\crash.log" "$Out\$Name-crash.log"; Get-Content "$dataDir\crash.log" }
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $started } -ErrorAction SilentlyContinue |
    Where-Object { $_.ProviderName -in 'Application Error', 'Windows Error Reporting', '.NET Runtime' } |
    ForEach-Object { "---- $($_.ProviderName) $($_.TimeCreated)`n$($_.Message)" } |
    Tee-Object "$Out\$Name-events.txt"

if ($crashed -and $Debugger) {
    # Run again under cdb and dump the stowed exception and stacks at the crash.
    $cdb = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\cdb.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cdb) {
        Write-Host "[$Name] rerunning under cdb"
        # Under a debugger WinUI prints XAML errors (with line and position) to the debug output cdb shows.
        $script = Join-Path $env:RUNNER_TEMP "cdb-$Name.txt"
        @('sxd eh', 'sxe -c "!analyze -v; kn 60; q" c000027b', 'sxe -c "!analyze -v; kn 60; q" av', 'g', 'q') | Set-Content $script -Encoding ascii
        $job = Start-Job { param($c, $s, $e, $o) & $c -G -lines -cf $s $e *> $o } -ArgumentList $cdb.FullName, $script, (Resolve-Path $Exe).Path, "$Out\$Name-cdb.txt"
        if (-not (Wait-Job $job -Timeout 90)) { Stop-Job $job; Get-Process CloakDesk, cdb -ErrorAction SilentlyContinue | Stop-Process -Force }
        Get-Content "$Out\$Name-cdb.txt" | Select-String -Pattern 'xaml|Line:|Position|WinUI|Error' | Select-Object -First 40 | ForEach-Object { Write-Host $_.Line }
    } else { Write-Host "cdb not found" }
}

if (-not $alive) { exit 1 }
