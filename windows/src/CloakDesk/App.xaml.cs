using System.Reflection;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Win32;
using Microsoft.Windows.AppLifecycle;

namespace CloakDesk;

public partial class App : Application
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string AppKey = @"Software\CloakDesk";

    public static new App Current => (App)Application.Current;

    /// SemVer from the git tag (MinVer), without the +commit build metadata.
    public static string Version { get; } =
        (typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0").Split('+')[0];

    public PresetFile Presets { get; } = PresetFile.Load();
    public bool IsCloaked => _stage is not null;
    public string? Error { get; private set; }
    public Tray Tray => _tray!;
    /// Raised on the UI thread after the cloak state or presets change.
    public event Action? Changed;

    Stage? _stage;
    Tray? _tray;
    TrayPanel? _panel;
    long _panelClosedAt;

    public App()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) => LogCrash(e.ExceptionObject); // capture thread, tray callbacks
        InitializeComponent();
        UnhandledException += (_, e) => LogCrash(e.Exception);
    }

    /// Appends to %LOCALAPPDATA%\CloakDesk\crash.log. The folder may not exist yet on first run.
    static void LogCrash(object exception)
    {
        try
        {
            var dir = Path.GetDirectoryName(PresetFile.FilePath)!;
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "crash.log"), $"{DateTime.Now:O}\n{exception}\n\n");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var main = AppInstance.FindOrRegisterForKey("CloakDesk");
        if (!main.IsCurrent)
        {
            // Already running: wake that instance and quit. Redirect off the UI thread or it can deadlock.
            var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
            Task.Run(() => main.RedirectActivationToAsync(activation).AsTask()).Wait();
            Exit();
            return;
        }

        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown; // keep living in the tray with no window
        var ui = DispatcherQueue.GetForCurrentThread();
        main.Activated += (_, _) => ui.TryEnqueue(OpenPanel); // second launch
        _tray = new Tray(this);
        _ = RequestBorderlessCaptureAsync();
        // No main window: the tray panel is the app. --tray (start with Windows) stays quiet unless it's pinned.
        if (Pinned || !Environment.GetCommandLineArgs().Contains("--tray")) OpenPanel();
    }

    /// Without this, Windows 11 draws a yellow border around the whole screen while the Stage captures.
    static async Task RequestBorderlessCaptureAsync()
    {
        try
        {
            if (Windows.Foundation.Metadata.ApiInformation.IsTypePresent("Windows.Graphics.Capture.GraphicsCaptureAccess"))
                await Windows.Graphics.Capture.GraphicsCaptureAccess.RequestAccessAsync(Windows.Graphics.Capture.GraphicsCaptureAccessKind.Borderless);
        }
        catch (Exception e) { System.Diagnostics.Debug.WriteLine(e); } // older Windows: the border just stays
    }

    /// Open the panel, or bring it to the front if it's already open.
    public void OpenPanel()
    {
        if (_panel is null)
        {
            _panel = new TrayPanel();
            _panel.Closed += (_, _) =>
            {
                _panel = null;
                _panelClosedAt = Environment.TickCount64;
            };
        }
        _panel.Activate();
        Native.SetForegroundWindow(Win32Interop.GetWindowFromWindowId(_panel.AppWindow.Id));
    }

    /// Tray icon left click: open the panel, or close it if it's open and not pinned.
    public void TogglePanel()
    {
        if (_panel is not null && !Pinned)
        {
            _panel.Close();
            return;
        }
        // Clicking the tray icon first takes focus from the panel, which closes it; don't reopen on that same click.
        if (_panel is null && Environment.TickCount64 - _panelClosedAt < 300) return;
        OpenPanel();
    }

    public void ToggleCloak()
    {
        Error = null;
        if (_stage is { } stage)
        {
            _stage = null;
            stage.Dispose();
        }
        else
        {
            try
            {
                _stage = new Stage(Look.From(Presets.Current));
                _stage.Closed += ToggleCloak; // closing the Stage window turns the cloak off
            }
            catch (Exception e) { Error = $"Couldn't start the Stage: {e.Message}"; }
        }
        _tray!.Update();
        Changed?.Invoke();
    }

    /// Ctrl+Alt+H: hide or unhide the app in front, in the active preset. The desktop toggles the desktop curtain.
    public void ToggleForegroundApp()
    {
        nint hwnd = Native.GetForegroundWindow();
        Native.GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0 || pid == Environment.ProcessId) return;
        var preset = Presets.Current;
        if (Native.ClassName(hwnd) is "Progman" or "WorkerW") preset.Desktop = !preset.Desktop;
        else
        {
            var name = Native.ProcessName(pid);
            if (name == "") return;
            if (!preset.Apps.Remove(name)) preset.Apps.Add(name);
        }
        PresetsChanged();
    }

    public void SelectPreset(int index)
    {
        Presets.Active = index;
        PresetsChanged();
    }

    /// Save and push the active preset to the live Stage.
    public void PresetsChanged()
    {
        try { Presets.Save(); }
        catch (IOException e) { Error = $"Couldn't save presets: {e.Message}"; }
        if (_stage is not null) _stage.Look = Look.From(Presets.Current);
        _tray!.Update();
        Changed?.Invoke();
    }

    public void Quit()
    {
        _stage?.Dispose();
        _tray?.Dispose();
        _panel?.Close();
        Exit();
    }

    /// Keep the panel open next to the tray. Remembered across restarts.
    public static bool Pinned
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(AppKey);
            return key?.GetValue("Pinned") is int v && v != 0;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(AppKey);
            key.SetValue("Pinned", value ? 1 : 0, RegistryValueKind.DWord);
        }
    }

    public static bool StartWithWindows
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue("CloakDesk") is not null;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue("CloakDesk", $"\"{Environment.ProcessPath}\" --tray");
            else key.DeleteValue("CloakDesk", false);
        }
    }
}
