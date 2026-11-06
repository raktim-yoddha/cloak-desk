using System.Diagnostics;
using Microsoft.UI;
using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.Windows.Storage.Pickers;
using Windows.UI;

namespace CloakDesk;

/// The app's only window: docked above the tray, in the corner of the primary screen's work area.
/// Pinned, it stays open on top; unpinned, it closes when it loses focus. Destroyed on close.
public sealed partial class TrayPanel : Window
{
    const int WidthDip = 380, HeightDip = 600, MarginDip = 12; // about the size of Quick Settings

    readonly App _app = App.Current;
    readonly double _scale;
    bool _syncing, _wasActive, _closed, _picking;

    public TrayPanel()
    {
        InitializeComponent();
        if (MicaController.IsSupported()) SystemBackdrop = new GrayBackdrop();
        else Root.Background = new SolidColorBrush(GrayBackdrop.Gray);

        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "CloakDesk.ico");
        Logo.Source = new BitmapImage(new Uri(icon));
        AppWindow.SetIcon(icon);
        VersionText.Text = $"Cloak Desk {App.Version}";
        FileText.Text = PresetFile.FilePath;
        if (_app.Tray.HotkeyError is { } hotkeys) HotkeyText.Text = hotkeys;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(FileText, PresetFile.FilePath); // selectable text has no name otherwise

        var hwnd = Win32Interop.GetWindowFromWindowId(AppWindow.Id);
        // You see it, viewers never do. CLOAKDESK_CAPTURABLE=1 turns that off for screenshots of the app itself.
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
        Place();

        Activated += (_, e) =>
        {
            if (e.WindowActivationState != WindowActivationState.Deactivated) _wasActive = true;
            else if (_wasActive && !App.Pinned && !_picking) Close(); // clicked elsewhere (not the image picker)
        };
        _app.Changed += Refresh;
        Closed += (_, _) => { _closed = true; _app.Changed -= Refresh; };
        Refresh();
    }

    /// Fixed flyout size (content scrolls), in the corner of the primary screen next to the tray:
    /// bottom right, or top right with the taskbar on top. Shorter only on a screen too small for it.
    void Place()
    {
        var mi = Native.PrimaryMonitor(out _);
        var work = mi.rcWork;
        int w = (int)(WidthDip * _scale), h = (int)(HeightDip * _scale), m = (int)(MarginDip * _scale);
        bool taskbarOnTop = work.Top > mi.rcMonitor.Top;
        int x = work.Right - w - m;
        h = Math.Min(h, work.Bottom - work.Top - 2 * m);
        int y = taskbarOnTop ? work.Top + m : Math.Max(work.Top + m, work.Bottom - h - m);
        AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(x, y, w, h));
    }

    void Refresh()
    {
        _syncing = true;
        var preset = _app.Presets.Current;
        CloakSwitch.IsOn = _app.IsCloaked;
        StateText.Text = _app.IsCloaked ? "Cloaked" : "Not cloaked";
        StateIcon.Glyph = _app.IsCloaked ? "" : ""; // lock / eye
        CloakHint.Text = _app.IsCloaked ? $"Share the “Cloak Desk Stage” window · {preset.Name}" : "Turn on before you share";
        DesktopSwitch.IsOn = preset.Desktop;
        StartupSwitch.IsOn = App.StartWithWindows;
        PinButton.IsChecked = PinSwitch.IsOn = App.Pinned;
        if (NameBox.Text != preset.Name) NameBox.Text = preset.Name;
        var (r, g, b) = preset.Rgb();
        var color = Color.FromArgb(255, r, g, b);
        ColorSwatch.Background = new SolidColorBrush(color);
        ColorText.Text = preset.Color.ToUpperInvariant();
        if (Picker.Color != color) Picker.Color = color;
        ImageText.Text = preset.Image is null ? "None" : Path.GetFileName(preset.Image);
        RemoveImageButton.Visibility = preset.Image is null ? Visibility.Collapsed : Visibility.Visible;
        PinIcon.Glyph = App.Pinned ? "" : ""; // pinned / pin
        DeletePresetButton.IsEnabled = _app.Presets.Presets.Count > 1;
        ErrorText.Text = _app.Error ?? "";
        ErrorText.Visibility = _app.Error is null ? Visibility.Collapsed : Visibility.Visible;

        // Rows built in code: data-templating Preset objects goes through WinRT marshaling, which failed under NativeAOT.
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

        AppList.Children.Clear();
        foreach (var name in preset.Apps)
        {
            var row = new Grid { MinHeight = 32 };
            row.Children.Add(new TextBlock { Text = name, VerticalAlignment = VerticalAlignment.Center });
            var remove = new Button
            {
                Content = new FontIcon { Glyph = "", FontSize = 12 },
                Padding = new Thickness(6, 4, 6, 4),
                HorizontalAlignment = HorizontalAlignment.Right,
                Tag = name,
            };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(remove, $"Show {name}");
            remove.Click += OnRemoveApp;
            row.Children.Add(remove);
            AppList.Children.Add(row);
        }
        NoAppsText.Visibility = preset.Apps.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        _syncing = false;
    }

    void OnPinClicked(object sender, RoutedEventArgs e)
    {
        App.Pinned = PinButton.IsChecked == true;
        Refresh();
    }

    void OnPinToggled(object sender, RoutedEventArgs e)
    {
        if (_syncing || PinSwitch.IsOn == App.Pinned) return;
        App.Pinned = PinSwitch.IsOn;
        Refresh();
    }

    // TextChanged also fires when Refresh sets the text, so compare instead of guarding with a flag.
    void OnNameChanged(object sender, TextChangedEventArgs e)
    {
        var preset = _app.Presets.Current;
        if (_syncing || NameBox.Text == preset.Name) return;
        preset.Name = NameBox.Text;
        _app.PresetsChanged();
    }

    void OnColorChanged(ColorPicker sender, ColorChangedEventArgs e)
    {
        var c = e.NewColor;
        var hex = $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        var preset = _app.Presets.Current;
        if (_syncing || hex == preset.Color) return;
        preset.Color = hex;
        _app.PresetsChanged();
    }

    async void OnPickImage(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker(AppWindow.Id) { SuggestedStartLocation = PickerLocationId.PicturesLibrary };
        foreach (var ext in (string[])[".png", ".jpg", ".jpeg", ".bmp"]) picker.FileTypeFilter.Add(ext);
        _picking = true; // the dialog takes focus; don't close the panel under it
        try
        {
            var file = await picker.PickSingleFileAsync();
            if (file is null) return;
            _app.Presets.Current.Image = file.Path;
            _app.PresetsChanged();
        }
        finally { _picking = false; }
        if (!_closed) Activate();
    }

    void OnClearImage(object sender, RoutedEventArgs e)
    {
        _app.Presets.Current.Image = null;
        _app.PresetsChanged();
    }

    void OnOpenFolder(object sender, RoutedEventArgs e) =>
        Process.Start("explorer.exe", Path.GetDirectoryName(PresetFile.FilePath)!)?.Dispose();

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

    void OnNewPreset(object sender, RoutedEventArgs e)
    {
        var presets = _app.Presets.Presets;
        int n = presets.Count + 1;
        while (presets.Any(p => p.Name == $"Preset {n}")) n++;
        presets.Add(new Preset { Name = $"Preset {n}" });
        _app.SelectPreset(presets.Count - 1);
    }

    void OnDeletePreset(object sender, RoutedEventArgs e)
    {
        var presets = _app.Presets.Presets;
        if (presets.Count < 2) return;
        int i = _app.Presets.Active;
        presets.RemoveAt(i);
        _app.SelectPreset(Math.Min(i, presets.Count - 1));
    }

    void OnPickerOpened(object? sender, object e)
    {
        var names = new SortedSet<string>();
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                // A process can exit mid-enumeration; skip it instead of crashing the picker.
                try { if (p.MainWindowHandle != 0 && p.Id != Environment.ProcessId) names.Add(p.ProcessName.ToLowerInvariant()); }
                catch (InvalidOperationException) { }
            }
        }
        AppPicker.ItemsSource = names.ToList();
    }

    void OnAddApp(object sender, RoutedEventArgs e)
    {
        var name = ((AppPicker.SelectedItem as string) ?? AppPicker.Text ?? "").Trim().ToLowerInvariant();
        if (name.EndsWith(".exe")) name = name[..^4];
        AppPicker.SelectedItem = null;
        AppPicker.Text = "";
        var apps = _app.Presets.Current.Apps;
        if (name == "" || apps.Contains(name)) return;
        apps.Add(name);
        _app.PresetsChanged();
    }

    void OnRemoveApp(object sender, RoutedEventArgs e)
    {
        _app.Presets.Current.Apps.Remove((string)((FrameworkElement)sender).Tag);
        _app.PresetsChanged();
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

    void OnExit(object sender, RoutedEventArgs e) => _app.Quit();
}
