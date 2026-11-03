namespace CloakDesk;

/// Notification-area icon, its menu, and the global hotkeys. Owns one hidden Win32 window.
public sealed unsafe partial class Tray : IDisposable
{
    const uint CallbackMessage = Native.WM_APP + 1;
    const uint NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIF_MESSAGE = 1, NIF_ICON = 2, NIF_TIP = 4;
    const int HotkeyCloak = 1, HotkeyHide = 2;

    readonly App _app;
    readonly nint _hwnd, _iconOff, _iconOn;
    readonly uint _taskbarCreated;

    public string? HotkeyError { get; }

    public Tray(App app)
    {
        _app = app;
        _iconOff = LoadIcon("CloakDesk.ico");
        _iconOn = LoadIcon("CloakDeskOn.ico");
        _taskbarCreated = Native.RegisterWindowMessageW("TaskbarCreated");
        _hwnd = Native.CreateWindow("CloakDeskTray", "Cloak Desk", 0, 0, 0, 0, 0, 0, OnMessage);
        Notify(NIM_ADD);

        const uint mods = Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT;
        var taken = new List<string>();
        if (Native.RegisterHotKey(_hwnd, HotkeyCloak, mods, 'C') == 0) taken.Add("Ctrl+Alt+C");
        if (Native.RegisterHotKey(_hwnd, HotkeyHide, mods, 'H') == 0) taken.Add("Ctrl+Alt+H");
        if (taken.Count > 0) HotkeyError = $"{string.Join(" and ", taken)} is already used by another app.";
    }

    static nint LoadIcon(string file)
    {
        int size = Native.GetSystemMetrics(49 /* SM_CXSMICON */);
        return Native.LoadImageW(0, Path.Combine(AppContext.BaseDirectory, "Assets", file), 1 /* IMAGE_ICON */, size, size, 0x10 /* LR_LOADFROMFILE */);
    }

    public void Update() => Notify(NIM_MODIFY);

    void Notify(uint message)
    {
        var data = new Native.NOTIFYICONDATAW
        {
            cbSize = sizeof(Native.NOTIFYICONDATAW),
            hWnd = _hwnd,
            uID = 1,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage = CallbackMessage,
            hIcon = _app.IsCloaked ? _iconOn : _iconOff,
        };
        Native.CopyTo(data.szTip, 128, _app.IsCloaked ? $"Cloak Desk: on ({_app.Presets.Current.Name})" : "Cloak Desk: off");
        Native.Shell_NotifyIconW(message, &data);
    }

    nint? OnMessage(uint msg, nint w, nint l)
    {
        if (msg == _taskbarCreated) { Notify(NIM_ADD); return 0; } // Explorer restarted
        if (msg == Native.WM_HOTKEY)
        {
            if (w == HotkeyCloak) _app.ToggleCloak();
            else if (w == HotkeyHide) _app.ToggleForegroundApp();
            return 0;
        }
        if (msg == CallbackMessage)
        {
            if ((uint)l == Native.WM_LBUTTONUP) _app.ShowWindow();
            else if ((uint)l == Native.WM_RBUTTONUP) ShowMenu();
            return 0;
        }
        return null;
    }

    void ShowMenu()
    {
        const uint MF_STRING = 0, MF_CHECKED = 8, MF_SEPARATOR = 0x800, TPM_RIGHTBUTTON = 2, TPM_RETURNCMD = 0x100;
        const int Open = 1, Cloak = 2, Exit = 3, FirstPreset = 100;

        nint menu = Native.CreatePopupMenu();
        Native.AppendMenuW(menu, MF_STRING, Open, "Open Cloak Desk");
        Native.AppendMenuW(menu, MF_STRING | (_app.IsCloaked ? MF_CHECKED : 0), Cloak, "Cloak\tCtrl+Alt+C");
        Native.AppendMenuW(menu, MF_SEPARATOR, 0, null);
        var presets = _app.Presets.Presets;
        for (int i = 0; i < presets.Count; i++)
            Native.AppendMenuW(menu, MF_STRING | (i == _app.Presets.Active ? MF_CHECKED : 0), (nuint)(FirstPreset + i), presets[i].Name.Replace("&", "&&"));
        Native.AppendMenuW(menu, MF_SEPARATOR, 0, null);
        Native.AppendMenuW(menu, MF_STRING, Exit, "Exit");

        Native.GetCursorPos(out var p);
        Native.SetForegroundWindow(_hwnd); // required so the menu closes when clicking elsewhere
        int cmd = Native.TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, p.X, p.Y, 0, _hwnd, 0);
        Native.PostMessageW(_hwnd, Native.WM_NULL, 0, 0);
        Native.DestroyMenu(menu);

        switch (cmd)
        {
            case Open: _app.ShowWindow(); break;
            case Cloak: _app.ToggleCloak(); break;
            case Exit: _app.Quit(); break;
            case >= FirstPreset: _app.SelectPreset(cmd - FirstPreset); break;
        }
    }

    public void Dispose()
    {
        Notify(NIM_DELETE);
        Native.UnregisterHotKey(_hwnd, HotkeyCloak);
        Native.UnregisterHotKey(_hwnd, HotkeyHide);
        Native.DestroyWindow(_hwnd);
        Native.DestroyIcon(_iconOff);
        Native.DestroyIcon(_iconOn);
    }
}
