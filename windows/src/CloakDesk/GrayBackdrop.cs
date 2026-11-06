using Microsoft.UI.Composition;
using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace CloakDesk;

/// Window surface: Mica tinted neutral gray #2C2C2C at 95%. The app is dark only.
/// Input is always counted active, so the window looks the same focused or not.
sealed partial class GrayBackdrop : SystemBackdrop
{
    public static readonly Color Gray = Color.FromArgb(255, 0x2C, 0x2C, 0x2C);

    MicaController? _mica;
    SystemBackdropConfiguration? _config;

    protected override void OnTargetConnected(ICompositionSupportsSystemBackdrop target, XamlRoot root)
    {
        base.OnTargetConnected(target, root);
        _config = new SystemBackdropConfiguration { IsInputActive = true, Theme = SystemBackdropTheme.Dark };
        _mica = new MicaController { TintColor = Gray, TintOpacity = 0.95f, FallbackColor = Gray };
        _mica.SetSystemBackdropConfiguration(_config);
        _mica.AddSystemBackdropTarget(target);
    }

    protected override void OnTargetDisconnected(ICompositionSupportsSystemBackdrop target)
    {
        base.OnTargetDisconnected(target);
        _mica?.RemoveSystemBackdropTarget(target);
        _mica?.Dispose();
        _mica = null;
    }
}
