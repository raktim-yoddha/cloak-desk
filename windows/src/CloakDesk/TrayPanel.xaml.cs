using Microsoft.UI;
using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace CloakDesk;

/// Small panel next to the tray icon (left click): cloak, preset, desktop curtain, start with Windows.
/// Closes when it loses focus; destroyed on close, so it costs nothing while hidden.
public sealed partial class TrayPanel : Window
{
    const int WidthDip = 340, MarginDip = 12;

    readonly App _app = App.Current;
    readonly double _scale;
    bool _syncing, _wasActive;

    public TrayPanel()
    {
        InitializeComponent();
        if (MicaController.IsSupported()) SystemBackdrop = new GrayBackdrop();
        else Root.Background = new SolidColorBrush(GrayBackdrop.Gray);

        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "CloakDesk.ico");
        Logo.Source = new BitmapImage(new Uri(icon));
        AppWindow.SetIcon(icon);

        var hwnd = Win32Interop.GetWindowFromWindowId(AppWindow.Id);
        // Like the main window: you see it, viewers never do.
        if (Environment.GetEnvironmentVariable("CLOAKDESK_CAPTURABLE") != "1")
            Native.SetWindowDisplayAffinity(hwnd, Native.WDA_EXCLUDEFROMCAPTURE);
        Native.DarkFrame(hwnd);

        var presenter = OverlappedPresenter.Create();
        presenter.SetBorderAndTitleBar(true, false);
        presenter.IsResizable = false;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.IsAlwaysOnTop = true;
        AppWindow.SetPresenter(presenter);
        AppWindow.IsShownInSwitchers = false;

        _scale = Native.GetDpiForWindow(hwnd) / 96.0;
        Place(420);
        Root.Loaded += (_, _) =>
        {
            Root.Measure(new Windows.Foundation.Size(WidthDip, double.PositiveInfinity));
            Place(Root.DesiredSize.Height);
        };

        Activated += (_, e) =>
        {
            if (e.WindowActivationState != WindowActivationState.Deactivated) _wasActive = true;
            else if (_wasActive) Close(); // clicked elsewhere
        };
        _app.Changed += Refresh;
        Closed += (_, _) => _app.Changed -= Refresh;
        Refresh();
    }

    /// Next to the cursor (the tray icon was just clicked), inside the work area of that monitor.
    void Place(double heightDip)
    {
        Native.GetCursorPos(out var p);
        var work = Native.WorkAreaAt(p);
        int w = (int)(WidthDip * _scale), h = (int)(heightDip * _scale), m = (int)(MarginDip * _scale);
        int x = Math.Clamp(p.X - w / 2, work.Left + m, Math.Max(work.Left + m, work.Right - w - m));
        int y = p.Y > (work.Top + work.Bottom) / 2 ? work.Bottom - h - m : work.Top + m;
        AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(x, y, w, h));
    }

    void Refresh()
    {
        _syncing = true;
        var preset = _app.Presets.Current;
        CloakSwitch.IsOn = _app.IsCloaked;
        StateText.Text = _app.IsCloaked ? "On" : "Off";
        CloakHint.Text = _app.IsCloaked ? "Share the Cloak Desk Stage" : "Ctrl+Alt+C";
        DesktopSwitch.IsOn = preset.Desktop;
        StartupSwitch.IsOn = App.StartWithWindows;
        ErrorText.Text = _app.Error ?? "";
        ErrorText.Visibility = _app.Error is null ? Visibility.Collapsed : Visibility.Visible;

        // One radio button per preset, built in code (see MainWindow.SyncNav for why).
        var presets = _app.Presets.Presets;
        var items = PresetList.Children;
        while (items.Count > presets.Count) items.RemoveAt(items.Count - 1);
        for (int i = 0; i < presets.Count; i++)
        {
            if (i >= items.Count)
            {
                var added = new RadioButton { GroupName = "Preset", Tag = i };
                added.Checked += OnPresetChecked;
                items.Add(added);
            }
            var button = (RadioButton)items[i];
            button.Content = presets[i].Name;
            button.IsChecked = i == _app.Presets.Active;
        }
        _syncing = false;
    }

    void OnCloakToggled(object sender, RoutedEventArgs e)
    {
        if (!_syncing && CloakSwitch.IsOn != _app.IsCloaked) _app.ToggleCloak(); // Refresh flips it back if it failed
    }

    void OnPresetChecked(object sender, RoutedEventArgs e)
    {
        if (_syncing) return;
        int i = (int)((FrameworkElement)sender).Tag;
        if (i != _app.Presets.Active) _app.SelectPreset(i);
    }

    void OnDesktopToggled(object sender, RoutedEventArgs e)
    {
        var preset = _app.Presets.Current;
        if (_syncing || DesktopSwitch.IsOn == preset.Desktop) return;
        preset.Desktop = DesktopSwitch.IsOn;
        _app.PresetsChanged();
    }

    void OnStartupToggled(object sender, RoutedEventArgs e)
    {
        if (!_syncing && StartupSwitch.IsOn != App.StartWithWindows) App.StartWithWindows = StartupSwitch.IsOn;
    }

    void OnOpen(object sender, RoutedEventArgs e)
    {
        _app.ShowWindow();
        Close();
    }

    void OnExit(object sender, RoutedEventArgs e) => _app.Quit();
}
