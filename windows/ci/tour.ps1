# Screenshot tour of Cloak Desk for docs and visual review: light and dark theme, pickers, a wallpaper
# curtain, live preset switching, settings and the tray menu. Windows PowerShell 5.1.
# Usage: tour.ps1 -Exe <path to CloakDesk.exe> -Out <folder for screenshots>
param(
    [Parameter(Mandatory)] [string] $Exe,
    [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class T {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
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
    public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
'@

$UIA = [System.Windows.Automation.AutomationElement]
$dataDir = Join-Path $env:LOCALAPPDATA 'CloakDesk'
$personalize = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$env:CLOAKDESK_CAPTURABLE = '1'

function Shot([string] $name, $rect = $null) {
    $b = if ($rect) { $rect } else { $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; New-Object System.Windows.Rect($s.X, $s.Y, $s.Width, $s.Height) }
    $w = [int]$b.Width; $h = [int]$b.Height
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$b.X, [int]$b.Y, 0, 0, (New-Object System.Drawing.Size $w, $h))
    $bmp.Save((Join-Path $Out "$name.png")); $g.Dispose(); $bmp.Dispose()
    Write-Host "shot $name"
}
function Prop($p, $v) { New-Object System.Windows.Automation.PropertyCondition($p, $v) }
function Main() {
    $c = New-Object System.Windows.Automation.AndCondition((Prop $UIA::ProcessIdProperty $script:app.Id), (Prop $UIA::NameProperty 'Cloak Desk'))
    $UIA::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $c)
}
function El([string] $by, [string] $value) {
    $p = if ($by -eq 'id') { $UIA::AutomationIdProperty } else { $UIA::NameProperty }
    (Main).FindFirst([System.Windows.Automation.TreeScope]::Descendants, (Prop $p $value))
}
function Click($el) {
    $o = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref] $o)) { $o.Invoke(); return }
    if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref] $o)) { $o.Select(); return }
}
function Toggle($el) { $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
function WindowShot([string] $name, [int] $pad = 0) {
    Start-Sleep -Milliseconds 900
    $r = (Main).Current.BoundingRectangle
    Shot $name (New-Object System.Windows.Rect(($r.X - $pad), ($r.Y - $pad), ($r.Width + 2 * $pad), ($r.Height + 2 * $pad)))
}
function Launch([bool] $dark) {
    Get-Process CloakDesk -ErrorAction SilentlyContinue | Stop-Process -Force
    Set-ItemProperty $personalize -Name AppsUseLightTheme -Value ([int](-not $dark)) -Type DWord
    $script:app = Start-Process $Exe -PassThru
    for ($i = 0; $i -lt 60 -and -not (Main); $i++) { Start-Sleep -Milliseconds 500 }
    $h = [T]::Find($app.Id, 'Cloak Desk')
    [T]::MoveWindow($h, 0, 0, 1000, 700, $true) | Out-Null
    [T]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Seconds 2
}

# ---- Sample content: a wallpaper image for the curtain, a "confidential" notepad, two presets ----
$wallpaper = Join-Path $Out 'sample-wallpaper.png'
$bmp = New-Object System.Drawing.Bitmap 1600, 900
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 1600, 900), [System.Drawing.Color]::FromArgb(255, 30, 58, 138), [System.Drawing.Color]::FromArgb(255, 124, 58, 237))
$g.FillRectangle($brush, 0, 0, 1600, 900)
$font = New-Object System.Drawing.Font('Segoe UI Semibold', 96)
$small = New-Object System.Drawing.Font('Segoe UI', 40)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString('Be right back', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, 1600, 800), $fmt)
$g.DrawString('This window is private', $small, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 300, 1600, 600), $fmt)
$bmp.Save($wallpaper); $g.Dispose(); $bmp.Dispose()

$notes = Join-Path $env:TEMP 'Salary review - CONFIDENTIAL.txt'
"Q3 salary review (CONFIDENTIAL)`r`n`r`nAlex     142,000`r`nSam      128,500`r`nJordan   151,250`r`n`r`nDo not share." | Set-Content $notes

Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $dataDir | Out-Null
@{
    active  = 0
    presets = @(
        @{ name = 'Work meeting'; apps = @('notepad'); desktop = $false; color = '#1F2937'; image = $wallpaper },
        @{ name = 'Streaming'; apps = @('notepad'); desktop = $true; color = '#4C1D95'; image = $null }
    )
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $dataDir 'presets.json') -Encoding UTF8

# ---- Light theme ----
Launch $false
WindowShot '01-light-preset-with-wallpaper-curtain'

Click (El 'name' 'Curtain color')
WindowShot '02-light-curtain-color-picker' 40
[T]::Key(0x1B); Start-Sleep -Milliseconds 500

$picker = El 'id' 'AppPicker'
$picker.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
WindowShot '03-light-hide-an-app-picker' 40
[T]::Key(0x1B); Start-Sleep -Milliseconds 500

Click (El 'name' 'Settings')
WindowShot '04-light-settings'
Click (El 'name' 'Work meeting')
Start-Sleep -Seconds 1

# ---- Cloak on: what viewers see in the Stage ----
$np = Start-Process notepad -ArgumentList "`"$notes`"" -PassThru
for ($i = 0; $i -lt 30 -and $np.MainWindowHandle -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 500; $np.Refresh() }
[T]::MoveWindow($np.MainWindowHandle, 40, 60, 620, 420, $true) | Out-Null
[T]::SetForegroundWindow($np.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 1
Shot '05-your-screen-notepad-is-private'

[T]::SetForegroundWindow([T]::Find($app.Id, 'Cloak Desk')) | Out-Null
Toggle (El 'id' 'CloakSwitch')
for ($i = 0; $i -lt 30 -and ([T]::Find($app.Id, 'Cloak Desk Stage') -eq [IntPtr]::Zero); $i++) { Start-Sleep -Milliseconds 500 }
WindowShot '06-light-cloak-on'
$stage = [T]::Find($app.Id, 'Cloak Desk Stage')
[T]::SetForegroundWindow($np.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 1
[T]::MoveWindow($stage, 300, 220, 720, 470, $true) | Out-Null
[T]::SetForegroundWindow($stage) | Out-Null
Start-Sleep -Seconds 2
Shot '07-stage-viewers-see-wallpaper-over-notepad'

# Switch preset while cloaked: color curtain plus desktop curtain, applied live.
[T]::SetForegroundWindow([T]::Find($app.Id, 'Cloak Desk')) | Out-Null
Click (El 'name' 'Streaming')
Start-Sleep -Seconds 1
[T]::SetForegroundWindow($np.MainWindowHandle) | Out-Null
[T]::SetForegroundWindow($stage) | Out-Null
Start-Sleep -Seconds 2
Shot '08-stage-streaming-preset-color-and-desktop-curtain'

# Tray menu (sent as the tray icon's right-click callback).
$tray = [T]::FindWindowW('CloakDeskTray', 'Cloak Desk')
[T]::SetCursorPos(820, 560) | Out-Null
[T]::PostMessageW($tray, 0x8001, [IntPtr]::Zero, [IntPtr]0x0205) | Out-Null
Start-Sleep -Seconds 2
Shot '09-tray-menu'
[T]::Key(0x1B); Start-Sleep -Milliseconds 500
[T]::PostMessageW($tray, 0x8001, [IntPtr]::Zero, [IntPtr]0x0205) | Out-Null # in case the first menu stayed open
Start-Sleep -Milliseconds 500; [T]::Key(0x1B)

# Cloak off again (hotkey), close notepad.
[T]::SetForegroundWindow([T]::Find($app.Id, 'Cloak Desk')) | Out-Null
$sw = El 'id' 'CloakSwitch'; if ($sw) { Toggle $sw }
Stop-Process -Id $np.Id -Force -ErrorAction SilentlyContinue

# ---- Dark theme ----
Launch $true
WindowShot '10-dark-preset'
Click (El 'name' 'Settings')
WindowShot '11-dark-settings'

Get-Process CloakDesk -ErrorAction SilentlyContinue | Stop-Process -Force
Set-ItemProperty $personalize -Name AppsUseLightTheme -Value 1 -Type DWord
Write-Host 'tour done'
