using Microsoft.UI.Composition;
using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace CloakDesk;

/// Window surface: Mica tinted neutral gray (#2C2C2C dark, #F3F3F3 light) at 95%.
/// Input is always counted active, so the window looks the same focused or not.
sealed partial class GrayBackdrop : SystemBackdrop
{
    MicaController? _mica;
    SystemBackdropConfiguration? _config;

    protected override void OnTargetConnected(ICompositionSupportsSystemBackdrop target, XamlRoot root)
    {
        base.OnTargetConnected(target, root);
        _config = new SystemBackdropConfiguration { IsInputActive = true };
        _mica = new MicaController();
        var content = (FrameworkElement)root.Content;
        Apply(content.ActualTheme);
        content.ActualThemeChanged += (s, _) => Apply(s.ActualTheme);
        _mica.SetSystemBackdropConfiguration(_config);
        _mica.AddSystemBackdropTarget(target);
    }

    void Apply(ElementTheme theme)
    {
        if (_mica is null || _config is null) return;
        bool dark = theme == ElementTheme.Dark;
        var gray = dark ? Color.FromArgb(255, 0x2C, 0x2C, 0x2C) : Color.FromArgb(255, 0xF3, 0xF3, 0xF3);
        _config.Theme = dark ? SystemBackdropTheme.Dark : SystemBackdropTheme.Light;
        _mica.TintColor = gray;
        _mica.TintOpacity = 0.95f;
        _mica.FallbackColor = gray;
    }

    protected override void OnTargetDisconnected(ICompositionSupportsSystemBackdrop target)
    {
        base.OnTargetDisconnected(target);
        _mica?.RemoveSystemBackdropTarget(target);
        _mica?.Dispose();
        _mica = null;
    }
}
