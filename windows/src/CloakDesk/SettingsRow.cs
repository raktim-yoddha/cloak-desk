using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace CloakDesk;

/// Windows 11 Settings-style row: icon, header, description, control on the right. Styled in App.xaml.
/// ponytail: CommunityToolkit SettingsCard does the same plus wrapping and expanders; swap it in if those are needed.
public sealed partial class SettingsRow : ContentControl
{
    public static readonly DependencyProperty HeaderProperty = Register(nameof(Header));
    public static readonly DependencyProperty DescriptionProperty = Register(nameof(Description));
    public static readonly DependencyProperty GlyphProperty = Register(nameof(Glyph));

    public string Header { get => (string)GetValue(HeaderProperty); set => SetValue(HeaderProperty, value); }
    public string Description { get => (string)GetValue(DescriptionProperty); set => SetValue(DescriptionProperty, value); }
    public string Glyph { get => (string)GetValue(GlyphProperty); set => SetValue(GlyphProperty, value); }

    static DependencyProperty Register(string name) =>
        DependencyProperty.Register(name, typeof(string), typeof(SettingsRow), new PropertyMetadata(""));
}
