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

public sealed partial class MainWindow : Window
{
    readonly App _app = App.Current;

    Preset CurrentPreset => _app.Presets.Current;
    bool OnSettings => Nav.SelectedItem == Nav.SettingsItem;

    public MainWindow()
    {
        InitializeComponent();
        if (MicaController.IsSupported()) SystemBackdrop = new GrayBackdrop();
        else Root.Background = new SolidColorBrush((Color)Application.Current.Resources["GrayColor"]);

        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "CloakDesk.ico");
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppTitleBar.IconSource = new ImageIconSource { ImageSource = new BitmapImage(new Uri(icon)) };
        AppWindow.SetIcon(icon);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;

        var hwnd = Win32Interop.GetWindowFromWindowId(AppWindow.Id);
        // You see this window, viewers never do. CLOAKDESK_CAPTURABLE=1 turns that off for screenshots of the app itself.
        if (Environment.GetEnvironmentVariable("CLOAKDESK_CAPTURABLE") != "1")
            Native.SetWindowDisplayAffinity(hwnd, Native.WDA_EXCLUDEFROMCAPTURE);
        double scale = Native.GetDpiForWindow(hwnd) / 96.0;
        AppWindow.Resize(new((int)(1000 * scale), (int)(720 * scale)));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = (int)(520 * scale);
            presenter.PreferredMinimumHeight = (int)(480 * scale);
        }

        Nav.MenuItemsSource = _app.Presets.Presets;
        StartupSwitch.IsOn = App.StartWithWindows;
        HotkeyRow.Description = _app.Tray.HotkeyError ?? "Work in any app";
        PresetsFileRow.Description = PresetFile.FilePath;
        _app.Changed += Refresh;
        Closed += (_, _) => _app.Changed -= Refresh;
        Refresh();
    }

    void Refresh()
    {
        if (!OnSettings && Nav.SelectedItem != CurrentPreset) Nav.SelectedItem = CurrentPreset;
        CloakSwitch.IsOn = _app.IsCloaked;
        CloakRow.Description = _app.IsCloaked
            ? "On. Share the “Cloak Desk Stage” window in your meeting or stream app."
            : "Off. Turn on to start the Stage with this preset. Ctrl+Alt+C";
        ErrorBar.Message = _app.Error ?? "";
        ErrorBar.IsOpen = _app.Error is not null;
        DeletePresetButton.IsEnabled = _app.Presets.Presets.Count > 1;
        DesktopSwitch.IsOn = CurrentPreset.Desktop; // Ctrl+Alt+H on the desktop flips it
        if (!OnSettings) PageTitle.Text = CurrentPreset.Name;
    }

    void LoadPreset()
    {
        var p = CurrentPreset;
        PageTitle.Text = p.Name;
        NameBox.Text = p.Name;
        var (r, g, b) = p.Rgb();
        var color = Color.FromArgb(255, r, g, b);
        ColorSwatch.Background = new SolidColorBrush(color);
        Picker.Color = color;
        ImageRow.Description = p.Image is null ? "None. The curtain color is used." : Path.GetFileName(p.Image);
        RemoveImageButton.Visibility = p.Image is null ? Visibility.Collapsed : Visibility.Visible;
        DesktopSwitch.IsOn = p.Desktop;
        AppList.ItemsSource = p.Apps;
    }

    void Edit(Action<Preset> change)
    {
        change(CurrentPreset);
        _app.PresetsChanged();
    }

    void OnPaneToggle(TitleBar sender, object args) => Nav.IsPaneOpen = !Nav.IsPaneOpen;

    void OnNavInvoked(NavigationView sender, NavigationViewItemInvokedEventArgs args)
    {
        if (args.InvokedItemContainer != NewPresetItem) return;
        _app.Presets.Presets.Add(new Preset());
        _app.SelectPreset(_app.Presets.Presets.Count - 1);
    }

    void OnNavSelected(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        PresetPage.Visibility = args.IsSettingsSelected ? Visibility.Collapsed : Visibility.Visible;
        SettingsPage.Visibility = args.IsSettingsSelected ? Visibility.Visible : Visibility.Collapsed;
        if (args.IsSettingsSelected) { PageTitle.Text = "Settings"; return; }
        if (args.SelectedItem is not Preset preset) return;
        int i = _app.Presets.Presets.IndexOf(preset);
        if (i != _app.Presets.Active) _app.SelectPreset(i);
        LoadPreset();
    }

    void OnCloakToggled(object sender, RoutedEventArgs e)
    {
        if (CloakSwitch.IsOn != _app.IsCloaked) _app.ToggleCloak(); // Refresh flips the switch back if it failed
    }

    void OnDeletePreset(object sender, RoutedEventArgs e)
    {
        var presets = _app.Presets.Presets;
        if (presets.Count < 2) return;
        int i = _app.Presets.Active;
        presets.RemoveAt(i);
        _app.SelectPreset(Math.Min(i, presets.Count - 1));
    }

    // TextChanged also fires after LoadPreset sets the text, so compare instead of guarding with a flag.
    void OnNameChanged(object sender, TextChangedEventArgs e)
    {
        if (NameBox.Text == CurrentPreset.Name) return;
        Edit(p => p.Name = NameBox.Text);
        PageTitle.Text = NameBox.Text;
    }

    void OnColorChanged(ColorPicker sender, ColorChangedEventArgs e)
    {
        var c = e.NewColor;
        ColorSwatch.Background = new SolidColorBrush(c);
        var hex = $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        if (hex != CurrentPreset.Color) Edit(p => p.Color = hex);
    }

    async void OnPickImage(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker(AppWindow.Id) { SuggestedStartLocation = PickerLocationId.PicturesLibrary };
        foreach (var ext in (string[])[".png", ".jpg", ".jpeg", ".bmp"]) picker.FileTypeFilter.Add(ext);
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;
        Edit(p => p.Image = file.Path);
        LoadPreset();
    }

    void OnClearImage(object sender, RoutedEventArgs e)
    {
        Edit(p => p.Image = null);
        LoadPreset();
    }

    void OnDesktopToggled(object sender, RoutedEventArgs e)
    {
        if (DesktopSwitch.IsOn != CurrentPreset.Desktop) Edit(p => p.Desktop = DesktopSwitch.IsOn);
    }

    void OnPickerOpened(object sender, object e)
    {
        var names = new SortedSet<string>();
        foreach (var p in Process.GetProcesses())
        {
            using (p)
                if (p.MainWindowHandle != 0 && p.Id != Environment.ProcessId) names.Add(p.ProcessName.ToLowerInvariant());
        }
        AppPicker.ItemsSource = names.ToList();
    }

    void OnAddApp(object sender, RoutedEventArgs e)
    {
        var name = ((AppPicker.SelectedItem as string) ?? AppPicker.Text ?? "").Trim().ToLowerInvariant();
        if (name.EndsWith(".exe")) name = name[..^4];
        AppPicker.SelectedItem = null;
        AppPicker.Text = "";
        if (name == "" || CurrentPreset.Apps.Contains(name)) return;
        Edit(p => p.Apps.Add(name));
    }

    void OnRemoveApp(object sender, RoutedEventArgs e) => Edit(p => p.Apps.Remove((string)((FrameworkElement)sender).Tag));

    void OnStartupToggled(object sender, RoutedEventArgs e)
    {
        if (StartupSwitch.IsOn != App.StartWithWindows) App.StartWithWindows = StartupSwitch.IsOn;
    }

    void OnOpenFolder(object sender, RoutedEventArgs e) =>
        Process.Start("explorer.exe", Path.GetDirectoryName(PresetFile.FilePath)!)?.Dispose();
}
