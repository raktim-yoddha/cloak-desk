using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Win32;
using Microsoft.Windows.AppLifecycle;

namespace CloakDesk;

public partial class App : Application
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static new App Current => (App)Application.Current;

    public PresetFile Presets { get; } = PresetFile.Load();
    public bool IsCloaked => _stage is not null;
    public string? Error { get; private set; }
    public Tray Tray => _tray!;
    /// Raised on the UI thread after the cloak state or presets change.
    public event Action? Changed;

    Stage? _stage;
    Tray? _tray;
    MainWindow? _window;

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
        main.Activated += (_, _) => ui.TryEnqueue(ShowWindow);
        _tray = new Tray(this);
        if (!Environment.GetCommandLineArgs().Contains("--tray")) ShowWindow();
    }

    public void ShowWindow()
    {
        if (_window is null)
        {
            _window = new MainWindow();
            _window.Closed += (_, _) => _window = null; // closing frees the UI; the tray keeps running
        }
        _window.Activate();
        Native.SetForegroundWindow(Win32Interop.GetWindowFromWindowId(_window.AppWindow.Id));
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
        _window?.Close();
        Exit();
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
