# End-to-end test of Cloak Desk on a CI runner: drives the real UI through UI Automation and the global hotkeys,
# checks windows, presets.json and the registry, and screenshots each step. Windows PowerShell 5.1.
# Usage: e2e.ps1 -Exe <path to CloakDesk.exe> -Out <folder for screenshots and results>
param(
    [Parameter(Mandatory)] [string] $Exe,
    [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class W {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static List<string> Titles(int pid) {
        var list = new List<string>();
        EnumWindows((h, p) => {
            uint id; GetWindowThreadProcessId(h, out id);
            if (id == pid && IsWindowVisible(h)) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); list.Add(sb.ToString()); }
            return true;
        }, IntPtr.Zero);
        return list;
    }
    public static IntPtr Find(int pid, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, p) => {
            uint id; GetWindowThreadProcessId(h, out id);
            if (id == pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString() == title) { found = h; return false; } }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    // Ctrl+Alt+key, as injected input so RegisterHotKey sees it.
    public static void Chord(byte key) {
        keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 2, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
    }
}
'@

$UIA = [System.Windows.Automation.AutomationElement]
$dataDir = Join-Path $env:LOCALAPPDATA 'CloakDesk'
$presetsFile = Join-Path $dataDir 'presets.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$env:CLOAKDESK_CAPTURABLE = '1'
$script:failed = 0
$script:results = New-Object System.Collections.Generic.List[string]
$script:shot = 0

function Check([string] $name, [bool] $ok, [string] $detail = '') {
    $line = '{0}  {1}{2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($detail) { " ($detail)" } else { '' })
    $script:results.Add($line); Write-Host $line
    if (-not $ok) { $script:failed++ }
}
function Shot([string] $name) {
    $script:shot++
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $Out ('{0:D2}-{1}.png' -f $script:shot, $name)))
    $g.Dispose(); $bmp.Dispose()
}
function WaitFor([scriptblock] $cond, [int] $seconds = 10) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
        try { if (& $cond) { return $true } } catch { }
        Start-Sleep -Milliseconds 250
    }
    return $false
}
function Prop($p, $v) { New-Object System.Windows.Automation.PropertyCondition($p, $v) }
function MainWindow([int] $procId) {
    $c = New-Object System.Windows.Automation.AndCondition((Prop $UIA::ProcessIdProperty $procId), (Prop $UIA::NameProperty 'Cloak Desk'))
    $UIA::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)
}
function El([string] $by, [string] $value) {
    $w = MainWindow $script:app.Id
    if (-not $w) { return $null }
    $p = if ($by -eq 'id') { $UIA::AutomationIdProperty } else { $UIA::NameProperty }
    $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (Prop $p $value))
}
function Pattern($el, $pattern) { $el.GetCurrentPattern($pattern) }
function Click($el) {
    $o = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref] $o)) { $o.Invoke(); return }
    if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref] $o)) { $o.Select(); return }
    throw "Element '$($el.Current.Name)' can't be invoked"
}
function Toggle($el) { (Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)).Toggle() }
function IsOn($el) { (Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)).Current.ToggleState -eq 'On' }
function Presets() { Get-Content $presetsFile -Raw | ConvertFrom-Json }
function HasStage() { [W]::Find($script:app.Id, 'Cloak Desk Stage') -ne [IntPtr]::Zero }
function Start-App([string[]] $arguments = @()) {
    if ($arguments.Count) { Start-Process $Exe -ArgumentList $arguments -PassThru } else { Start-Process $Exe -PassThru }
}
function Step([string] $name, [scriptblock] $body) {
    try { & $body } catch { Check $name $false $_.Exception.Message }
}

Get-Process CloakDesk -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
Remove-ItemProperty $runKey -Name CloakDesk -ErrorAction SilentlyContinue

# 1. Launch
$script:app = Start-App
Check 'Main window opens' (WaitFor { MainWindow $app.Id } 30)
Start-Sleep -Seconds 2
Shot 'main-window'
$app.Refresh()
Check 'Memory under 150 MB' ($app.PrivateMemorySize64 -lt 150MB) ('{0:N1} MB private' -f ($app.PrivateMemorySize64 / 1MB))
Check 'Default preset shown' ([bool](El 'name' 'Default'))

# 2. Cloak on and off from the switch
Step 'Cloak switch' {
    Toggle (El 'id' 'CloakSwitch')
    Check 'Cloak switch starts the Stage window' (WaitFor { HasStage } 15)
    Start-Sleep -Seconds 3
    Check 'App alive with the Stage rendering' (-not $app.HasExited)
    $err = El 'id' 'ErrorBar'
    Check 'No error shown' (-not $err -or $err.Current.IsOffscreen)
    Shot 'cloak-on'
    Toggle (El 'id' 'CloakSwitch')
    Check 'Cloak switch closes the Stage window' (WaitFor { -not (HasStage) } 10)
}

# 3. Ctrl+Alt+C hotkey
Step 'Ctrl+Alt+C' {
    [W]::Chord(0x43)
    Check 'Ctrl+Alt+C turns the cloak on' (WaitFor { HasStage } 15)
    Check 'Switch follows the hotkey' (WaitFor { IsOn (El 'id' 'CloakSwitch') } 5)
    [W]::Chord(0x43)
    Check 'Ctrl+Alt+C turns the cloak off' (WaitFor { -not (HasStage) } 10)
}

# 4. Ctrl+Alt+H hides the app in front, then the Stage curtains it
Step 'Ctrl+Alt+H' {
    $np = Start-Process notepad -PassThru
    $null = WaitFor { $np.Refresh(); $np.MainWindowHandle -ne [IntPtr]::Zero } 15
    [W]::SetForegroundWindow($np.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 1
    [W]::Chord(0x48)
    Check 'Ctrl+Alt+H saves the app in front to the preset' (WaitFor { (Presets).presets[0].apps -contains 'notepad' } 10)
    Check 'Hidden app listed in the window' (WaitFor { El 'name' 'notepad' } 5)

    [W]::Chord(0x43)
    Check 'Cloak on with notepad hidden' (WaitFor { HasStage } 15)
    Start-Sleep -Seconds 2
    [W]::SetForegroundWindow([W]::Find($app.Id, 'Cloak Desk Stage')) | Out-Null
    Start-Sleep -Seconds 2
    Shot 'stage-curtains-notepad'
    [W]::Chord(0x43)
    $null = WaitFor { -not (HasStage) } 10

    [W]::SetForegroundWindow($np.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 1
    [W]::Chord(0x48)
    Check 'Ctrl+Alt+H again removes it' (WaitFor { -not ((Presets).presets[0].apps -contains 'notepad') } 10)
    Stop-Process -Id $np.Id -Force
}

# 5. Presets: create, rename, delete
Step 'Presets' {
    [W]::SetForegroundWindow([W]::Find($app.Id, 'Cloak Desk')) | Out-Null
    Click (El 'name' 'New preset')
    Check 'New preset is saved and selected' (WaitFor { $p = Presets; $p.presets.Count -eq 2 -and $p.active -eq 1 -and $p.presets[1].name -eq 'Preset 2' } 10)
    (Pattern (El 'id' 'NameBox') ([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('Work')
    Check 'Renaming saves the name' (WaitFor { (Presets).presets[1].name -eq 'Work' } 10)
    Check 'Renamed preset shows in the navigation' (WaitFor { El 'name' 'Work' } 5)
    Shot 'second-preset'
    Click (El 'id' 'DeletePresetButton')
    Check 'Delete removes the preset' (WaitFor { (Presets).presets.Count -eq 1 } 10)
    $btn = El 'id' 'DeletePresetButton'
    Check 'Last preset cannot be deleted' (-not $btn.Current.IsEnabled)
}

# 6. Settings page
Step 'Settings' {
    Click (El 'name' 'Settings')
    Check 'Settings page shows the version' (WaitFor {
        $w = MainWindow $app.Id
        $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        @($all | Where-Object { $_.Current.Name -like 'Version *' }).Count -gt 0 } 5)
    Shot 'settings'
    Toggle (El 'id' 'StartupSwitch')
    $v = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).CloakDesk
    Check 'Start with Windows writes the Run key' ($v -eq "`"$Exe`" --tray") $v
    Toggle (El 'id' 'StartupSwitch')
    Check 'Turning it off removes the Run key' ($null -eq (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).CloakDesk)
}

# 7. Tray panel: left click opens it, it controls the cloak, a second click closes it
function Panel() {
    $c = New-Object System.Windows.Automation.AndCondition((Prop $UIA::ProcessIdProperty $script:app.Id), (Prop $UIA::NameProperty 'Cloak Desk panel'))
    $UIA::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)
}
function TrayClick() {
    $tray = [W]::FindWindowW('CloakDeskTray', 'Cloak Desk')
    [W]::PostMessageW($tray, 0x8001, [IntPtr]::Zero, [IntPtr]0x0202) | Out-Null # WM_LBUTTONUP on the icon
}
Step 'Tray panel' {
    [W]::SetCursorPos(1200, 700) | Out-Null
    TrayClick
    Check 'Tray click opens the panel' (WaitFor { Panel } 10)
    Start-Sleep -Seconds 1
    Shot 'tray-panel'
    $sw = (Panel).FindFirst([System.Windows.Automation.TreeScope]::Descendants, (Prop $UIA::NameProperty 'Cloak'))
    Toggle $sw
    Check 'Panel switch starts the Stage' (WaitFor { HasStage } 15)
    Check 'Panel shows the cloak on' (WaitFor { IsOn ((Panel).FindFirst([System.Windows.Automation.TreeScope]::Descendants, (Prop $UIA::NameProperty 'Cloak'))) } 5)
    Toggle ((Panel).FindFirst([System.Windows.Automation.TreeScope]::Descendants, (Prop $UIA::NameProperty 'Cloak')))
    Check 'Panel switch stops the Stage' (WaitFor { -not (HasStage) } 10)
    TrayClick
    Check 'Second tray click closes the panel' (WaitFor { -not (Panel) } 5)
}

# 8. Single instance, close to tray, tray start, reopen
Step 'Lifecycle' {
    $second = Start-App
    Check 'Second launch exits' (WaitFor { $second.HasExited } 15)
    Check 'First instance keeps running' (-not $app.HasExited)

    (Pattern (MainWindow $app.Id) ([System.Windows.Automation.WindowPattern]::Pattern)).Close()
    $closed = WaitFor { -not (MainWindow $app.Id) } 10
    Start-Sleep -Seconds 2
    Check 'Closing the window keeps the app in the tray' ($closed -and -not $app.HasExited)

    $again = Start-App
    Check 'Launching again reopens the window' (WaitFor { MainWindow $app.Id } 15)
    $null = WaitFor { $again.HasExited } 10

    Stop-Process -Id $app.Id -Force
    $script:app = Start-App @('--tray')
    Start-Sleep -Seconds 5
    Check '--tray starts without a window' ((-not $app.HasExited) -and -not (MainWindow $app.Id))
    Check 'Presets persist across restarts' ((Presets).presets.Count -eq 1)
}

Check 'No crash.log written' (-not (Test-Path (Join-Path $dataDir 'crash.log')))
if (Test-Path (Join-Path $dataDir 'crash.log')) { Get-Content (Join-Path $dataDir 'crash.log') | Tee-Object (Join-Path $Out 'crash.log') }

Get-Process CloakDesk -ErrorAction SilentlyContinue | Stop-Process -Force
$script:results | Set-Content (Join-Path $Out 'results.txt')
Write-Host ''
Write-Host ('{0} checks, {1} failed' -f $script:results.Count, $script:failed)
if ($script:failed) { exit 1 }
