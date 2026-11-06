# End-to-end test of Cloak Desk on a CI runner: drives the real tray panel through UI Automation and the global
# hotkeys, checks windows, presets.json and the registry, and screenshots each step. Windows PowerShell 5.1.
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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public static uint ForegroundPid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static IntPtr Find(int pid, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, p) => {
            uint id; GetWindowThreadProcessId(h, out id);
            if (id == pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString() == title) { found = h; return false; } }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    // Bring a window to the front. Windows only lets the foreground process do that; an Alt tap lifts the lock.
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    public static void Front(IntPtr h) {
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        if (!SetForegroundWindow(h) || GetForegroundWindow() != h) SwitchToThisWindow(h, true);
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
$appKey = 'HKCU:\Software\CloakDesk'
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
function Panel() {
    $c = New-Object System.Windows.Automation.AndCondition((Prop $UIA::ProcessIdProperty $script:app.Id), (Prop $UIA::NameProperty 'Cloak Desk panel'))
    $UIA::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)
}
function El([string] $by, [string] $value) {
    $w = Panel
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
function Pinned() { (Get-ItemProperty $appKey -ErrorAction SilentlyContinue).Pinned -eq 1 }
function Start-App([string[]] $arguments = @()) {
    if ($arguments.Count) { Start-Process $Exe -ArgumentList $arguments -PassThru } else { Start-Process $Exe -PassThru }
}
function TrayClick() {
    $tray = [W]::FindWindowW('CloakDeskTray', 'Cloak Desk')
    [W]::PostMessageW($tray, 0x8001, [IntPtr]::Zero, [IntPtr]0x0202) | Out-Null # WM_LBUTTONUP on the icon
}
function Step([string] $name, [scriptblock] $body) {
    try { & $body } catch { Check $name $false $_.Exception.Message }
}
# A classic desktop app to hide. charmap first: on some Windows 11 PCs notepad is a Store stub, and starting it
# opens an "Open with" dialog that keeps the foreground and breaks every focus step after it.
function Start-Victim() {
    foreach ($n in 'charmap', 'notepad') {
        try {
            $p = Start-Process $n -PassThru -ErrorAction Stop
            if (WaitFor { $p.Refresh(); $p.MainWindowHandle -ne [IntPtr]::Zero } 15) { return $p }
        } catch { }
    }
    throw 'no test app could be started'
}

Get-Process CloakDesk -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
Remove-ItemProperty $runKey -Name CloakDesk -ErrorAction SilentlyContinue
Remove-Item $appKey -ErrorAction SilentlyContinue

# 1. Launch: the panel is the app, docked in the tray corner
$script:app = Start-App
Check 'Panel opens on launch' (WaitFor { Panel } 30)
Start-Sleep -Seconds 2
Shot 'panel'
$app.Refresh()
Check 'Memory under 150 MB' ($app.PrivateMemorySize64 -lt 150MB) ('{0:N1} MB private' -f ($app.PrivateMemorySize64 / 1MB))
Check 'Default preset shown' ([bool](El 'name' 'Default'))
$all = (Panel).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Check 'Version shown' (@($all | Where-Object { $_.Current.Name -like 'Cloak Desk [0-9]*' }).Count -gt 0)
$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$r = (Panel).Current.BoundingRectangle
Check 'Panel docked next to the tray' ((($work.Right - $r.Right) -lt 60) -and ([math]::Abs($work.Bottom - $r.Bottom) -lt 60)) "panel $r, work area $work"

# 2. Pin: keeps the panel open when something else takes focus, and is remembered
Step 'Pin' {
    Toggle (El 'id' 'PinButton')
    Check 'Pin is saved' (WaitFor { Pinned } 5)
    $script:victim = Start-Victim
    [W]::Front($victim.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 2
    Check 'Pinned panel stays open when another app is in front' ([bool](Panel))
    TrayClick
    Start-Sleep -Seconds 1
    Check 'Tray click keeps a pinned panel open' ([bool](Panel))
}

# 3. Cloak on and off from the switch
Step 'Cloak switch' {
    Toggle (El 'id' 'CloakSwitch')
    Check 'Cloak switch starts the Stage window' (WaitFor { HasStage } 15)
    Start-Sleep -Seconds 3
    Check 'App alive with the Stage rendering' (-not $app.HasExited)
    $err = El 'id' 'ErrorText'
    Check 'No error shown' (-not $err -or $err.Current.IsOffscreen)
    Shot 'cloak-on'
    Toggle (El 'id' 'CloakSwitch')
    Check 'Cloak switch closes the Stage window' (WaitFor { -not (HasStage) } 10)
}

# 4. Ctrl+Alt+C hotkey
Step 'Ctrl+Alt+C' {
    [W]::Chord(0x43)
    Check 'Ctrl+Alt+C turns the cloak on' (WaitFor { HasStage } 15)
    Check 'Switch follows the hotkey' (WaitFor { IsOn (El 'id' 'CloakSwitch') } 5)
    [W]::Chord(0x43)
    Check 'Ctrl+Alt+C turns the cloak off' (WaitFor { -not (HasStage) } 10)
}

# 5. Ctrl+Alt+H hides the app in front, then the Stage curtains it
Step 'Ctrl+Alt+H' {
    $name = $victim.ProcessName.ToLowerInvariant()
    [W]::Front($victim.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 1
    [W]::Chord(0x48)
    $fg = [W]::ForegroundPid()
    Check 'Ctrl+Alt+H saves the app in front to the preset' (WaitFor { (Presets).presets[0].apps -contains $name } 10) "foreground pid $fg, $name pid $($victim.Id)"
    Check 'Hidden app listed in the panel' (WaitFor { El 'name' $name } 5)

    [W]::Chord(0x43)
    Check 'Cloak on with the app hidden' (WaitFor { HasStage } 15)
    Start-Sleep -Seconds 2
    [W]::Front([W]::Find($app.Id, 'Cloak Desk Stage')) | Out-Null
    Start-Sleep -Seconds 2
    Shot 'stage-curtains-app'
    [W]::Chord(0x43)
    $null = WaitFor { -not (HasStage) } 10

    Click (El 'name' "Show $name")
    Check 'Remove button un-hides it' (WaitFor { -not ((Presets).presets[0].apps -contains $name) } 10)
    # Ctrl+Alt+H toggles: in front again, it hides; once more, it shows.
    $null = WaitFor { [W]::Front($victim.MainWindowHandle); Start-Sleep -Milliseconds 300; [W]::ForegroundPid() -eq $victim.Id } 10
    [W]::Chord(0x48)
    Check 'Ctrl+Alt+H hides it again' (WaitFor { (Presets).presets[0].apps -contains $name } 10) "foreground pid $([W]::ForegroundPid())"
    Start-Sleep -Seconds 1
    $null = WaitFor { [W]::Front($victim.MainWindowHandle); Start-Sleep -Milliseconds 300; [W]::ForegroundPid() -eq $victim.Id } 10
    [W]::Chord(0x48)
    Check 'Ctrl+Alt+H once more shows it' (WaitFor { -not ((Presets).presets[0].apps -contains $name) } 10) "foreground pid $([W]::ForegroundPid())"
}
if ($victim) { Stop-Process -Id $victim.Id -Force -ErrorAction SilentlyContinue }

# 6. Hide an app by name
Step 'Add app' {
    # The editable ComboBox takes text through its inner text box.
    $box = (El 'id' 'AppPicker').FindFirst([System.Windows.Automation.TreeScope]::Descendants, (Prop $UIA::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)))
    (Pattern $box ([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('Calc.exe')
    Click (El 'name' 'Hide app')
    Check 'Typed app name is saved (lowercase, no .exe)' (WaitFor { (Presets).presets[0].apps -contains 'calc' } 10)
    Click (El 'name' 'Show calc')
    Check 'And removed again' (WaitFor { -not ((Presets).presets[0].apps -contains 'calc') } 10)
}

# 7. Presets: create, select, delete
Step 'Presets' {
    Click (El 'name' 'New preset')
    Check 'New preset is saved and selected' (WaitFor { $p = Presets; $p.presets.Count -eq 2 -and $p.active -eq 1 -and $p.presets[1].name -eq 'Preset 2' } 10)
    Check 'New preset listed in the panel' (WaitFor { El 'name' 'Preset 2' } 5)
    (Pattern (El 'id' 'NameBox') ([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('Work')
    Check 'Renaming saves the name' (WaitFor { (Presets).presets[1].name -eq 'Work' } 10)
    Check 'Renamed preset shows in the list' (WaitFor { El 'name' 'Work' } 5)
    Click (El 'name' 'Default')
    Check 'Selecting a preset saves it as active' (WaitFor { (Presets).active -eq 0 } 10)
    Click (El 'name' 'Work')
    $null = WaitFor { (Presets).active -eq 1 } 10
    Click (El 'id' 'DeletePresetButton')
    Check 'Delete removes the preset' (WaitFor { (Presets).presets.Count -eq 1 } 10)
    Check 'Last preset cannot be deleted' (WaitFor { -not (El 'id' 'DeletePresetButton').Current.IsEnabled } 5)
}

# 8. Switches and settings
Step 'Switches' {
    Toggle (El 'id' 'PinSwitch')
    Check 'Settings switch unpins too' (WaitFor { -not (Pinned) } 5)
    Toggle (El 'id' 'PinSwitch')
    Check 'And pins again' (WaitFor { Pinned } 5)
    Check 'Pin button follows the switch' (IsOn (El 'id' 'PinButton'))
    $all = (Panel).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    Check 'Presets file path shown' (@($all | Where-Object { $_.Current.Name -eq $presetsFile }).Count -gt 0)
    Check 'Curtain color shown' (@($all | Where-Object { $_.Current.Name -eq '#202020' }).Count -gt 0)
    $before = (Presets).presets[0].desktop
    Toggle (El 'id' 'DesktopSwitch')
    Check 'Hide desktop is saved' (WaitFor { (Presets).presets[0].desktop -ne $before } 10)
    Toggle (El 'id' 'DesktopSwitch')
    Toggle (El 'id' 'StartupSwitch')
    $v = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).CloakDesk
    Check 'Start with Windows writes the Run key' ($v -eq "`"$Exe`" --tray") $v
    Toggle (El 'id' 'StartupSwitch')
    Check 'Turning it off removes the Run key' ($null -eq (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).CloakDesk)
}

# 9. Lifecycle: single instance, pinned panel at login, unpinned tray behavior
Step 'Lifecycle' {
    $second = Start-App
    Check 'Second launch exits' (WaitFor { $second.HasExited } 15)
    Check 'First instance keeps running' (-not $app.HasExited)

    Stop-Process -Id $app.Id -Force
    $script:app = Start-App @('--tray')
    Check '--tray with pin on shows the panel' (WaitFor { Panel } 20)
    Check 'Presets persist across restarts' ((Presets).presets.Count -eq 1)

    Toggle (El 'id' 'PinButton')
    Check 'Unpin is saved' (WaitFor { -not (Pinned) } 5)
    TrayClick
    Check 'Tray click closes the unpinned panel' (WaitFor { -not (Panel) } 5)
    Start-Sleep -Milliseconds 500
    TrayClick
    Check 'Tray click opens it again' (WaitFor { Panel } 10)
    $v = Start-Victim
    [W]::Front($v.MainWindowHandle) | Out-Null
    Check 'Unpinned panel closes when another app is in front' (WaitFor { -not (Panel) } 5)
    Stop-Process -Id $v.Id -Force -ErrorAction SilentlyContinue

    Stop-Process -Id $app.Id -Force
    $script:app = Start-App @('--tray')
    Start-Sleep -Seconds 5
    Check '--tray with pin off starts without a window' ((-not $app.HasExited) -and -not (Panel))
}

Check 'No crash.log written' (-not (Test-Path (Join-Path $dataDir 'crash.log')))
if (Test-Path (Join-Path $dataDir 'crash.log')) { Get-Content (Join-Path $dataDir 'crash.log') | Tee-Object (Join-Path $Out 'crash.log') }

Get-Process CloakDesk -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item $appKey -ErrorAction SilentlyContinue
$script:results | Set-Content (Join-Path $Out 'results.txt')
Write-Host ''
Write-Host ('{0} checks, {1} failed' -f $script:results.Count, $script:failed)
if ($script:failed) { exit 1 }
