using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CloakDesk;

// Handed to XAML as NavigationView items. Under NativeAOT, CsWinRT can only build the WinRT interface table
// (INotifyPropertyChanged, ICustomPropertyProvider) for partial classes; without it XAML gets E_NOINTERFACE.
[WinRT.GeneratedBindableCustomProperty]
public sealed partial class Preset : INotifyPropertyChanged
{
    string _name = "New preset";
    public string Name { get => _name; set { _name = value; PropertyChanged?.Invoke(this, new(nameof(Name))); } }
    public ObservableCollection<string> Apps { get; set; } = [];
    public bool Desktop { get; set; }
    public string Color { get; set; } = "#202020";
    public string? Image { get; set; }
    public event PropertyChangedEventHandler? PropertyChanged;

    public (byte R, byte G, byte B) Rgb()
    {
        uint v = Color is ['#', .. var hex] && hex.Length == 6 && uint.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out var n) ? n : 0x202020;
        return ((byte)(v >> 16), (byte)(v >> 8), (byte)v);
    }
}

/// presets.json, shared format with the other ports: docs/presets.schema.json.
public sealed class PresetFile
{
    public int Active { get; set; }
    public ObservableCollection<Preset> Presets { get; set; } = [];

    [JsonIgnore] public Preset Current => Presets[Math.Clamp(Active, 0, Presets.Count - 1)];

    public static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CloakDesk", "presets.json");

    public static PresetFile Load()
    {
        PresetFile? file = null;
        try
        {
            if (File.Exists(FilePath))
                file = JsonSerializer.Deserialize(File.ReadAllText(FilePath), PresetJson.Default.PresetFile);
        }
        catch (Exception e) when (e is JsonException or IOException)
        {
            // Keep the unreadable file instead of overwriting it on the next save.
            try { File.Copy(FilePath, FilePath + ".bak", true); } catch (IOException) { }
        }
        file ??= new PresetFile();
        if (file.Presets.Count == 0) file.Presets.Add(new Preset { Name = "Default", Desktop = true });
        return file;
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, PresetJson.Default.PresetFile));
        File.Move(tmp, FilePath, true); // atomic replace: a crash mid-write never leaves a half file
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true)]
[JsonSerializable(typeof(PresetFile))]
partial class PresetJson : JsonSerializerContext;
