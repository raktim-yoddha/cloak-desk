using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace CloakDesk;

/// Win32 calls and a tiny window helper. Hand-written imports keep the exe small (no CsWin32/WinForms).
static unsafe partial class Native
{
    public const uint WM_CLOSE = 0x0010, WM_HOTKEY = 0x0312, WM_NULL = 0, WM_NCDESTROY = 0x0082,
        WM_LBUTTONUP = 0x0202, WM_RBUTTONUP = 0x0205, WM_APP = 0x8000;
    public const uint WS_OVERLAPPEDWINDOW = 0x00CF0000, WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20;
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
    public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_NOREPEAT = 0x4000;
    public const int GWL_EXSTYLE = -20;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    [StructLayout(LayoutKind.Sequential)]
    struct WNDCLASSEXW
    {
        public int cbSize; public uint style;
        public delegate* unmanaged<nint, uint, nint, nint, nint> lpfnWndProc;
        public int cbClsExtra, cbWndExtra; public nint hInstance, hIcon, hCursor, hbrBackground;
        public char* lpszMenuName, lpszClassName; public nint hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct NOTIFYICONDATAW
    {
        public int cbSize; public nint hWnd; public uint uID, uFlags, uCallbackMessage; public nint hIcon;
        public fixed char szTip[128];
        public uint dwState, dwStateMask;
        public fixed char szInfo[256];
        public uint uVersion;
        public fixed char szInfoTitle[64];
        public uint dwInfoFlags; public Guid guidItem; public nint hBalloonIcon;
    }

    // user32
    [LibraryImport("user32.dll")] private static partial ushort RegisterClassExW(WNDCLASSEXW* wc);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint CreateWindowExW(uint ex, string cls, string title, uint style, int x, int y, int w, int h, nint parent, nint menu, nint inst, nint param);
    [LibraryImport("user32.dll")] private static partial nint DefWindowProcW(nint h, uint m, nint w, nint l);
    [LibraryImport("user32.dll")] private static partial nint LoadCursorW(nint inst, nint name);
    [LibraryImport("user32.dll")] public static partial int DestroyWindow(nint h);
    [LibraryImport("user32.dll")] public static partial int ShowWindow(nint h, int cmd);
    [LibraryImport("user32.dll")] public static partial int SetWindowPos(nint h, nint after, int x, int y, int cx, int cy, uint flags);
    [LibraryImport("user32.dll")] public static partial int RegisterHotKey(nint h, int id, uint mods, uint vk);
    [LibraryImport("user32.dll")] public static partial int UnregisterHotKey(nint h, int id);
    [LibraryImport("user32.dll")] public static partial nint CreatePopupMenu();
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] public static partial int AppendMenuW(nint menu, uint flags, nuint id, string? text);
    [LibraryImport("user32.dll")] public static partial int TrackPopupMenu(nint menu, uint flags, int x, int y, int reserved, nint h, nint rect);
    [LibraryImport("user32.dll")] public static partial int DestroyMenu(nint menu);
    [LibraryImport("user32.dll")] public static partial int SetForegroundWindow(nint h);
    [LibraryImport("user32.dll")] public static partial nint GetForegroundWindow();
    [LibraryImport("user32.dll")] public static partial uint GetWindowThreadProcessId(nint h, out uint pid);
    [LibraryImport("user32.dll")] public static partial int PostMessageW(nint h, uint m, nint w, nint l);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] public static partial uint RegisterWindowMessageW(string name);
    [LibraryImport("user32.dll")] public static partial int GetCursorPos(out POINT p);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint LoadImageW(nint inst, string name, uint type, int cx, int cy, uint flags);
    [LibraryImport("user32.dll")] public static partial int DestroyIcon(nint icon);
    [LibraryImport("user32.dll")] public static partial int EnumWindows(delegate* unmanaged<nint, nint, int> cb, nint param);
    [LibraryImport("user32.dll")] public static partial int IsWindowVisible(nint h);
    [LibraryImport("user32.dll")] public static partial int IsIconic(nint h);
    [LibraryImport("user32.dll")] public static partial nint GetWindowLongPtrW(nint h, int index);
    [LibraryImport("user32.dll")] public static partial int GetClassNameW(nint h, char* buf, int max);
    [LibraryImport("user32.dll")] public static partial nint MonitorFromPoint(POINT p, uint flags);
    [LibraryImport("user32.dll")] public static partial int GetMonitorInfoW(nint mon, ref MONITORINFO mi);
    [LibraryImport("user32.dll")] public static partial int SetWindowDisplayAffinity(nint h, uint affinity);
    [LibraryImport("user32.dll")] public static partial uint GetDpiForWindow(nint h);
    [LibraryImport("user32.dll")] public static partial int GetSystemMetrics(int index);

    // shell32 / dwmapi / kernel32 / d3d11 / combase
    [LibraryImport("shell32.dll")] public static partial int Shell_NotifyIconW(uint msg, NOTIFYICONDATAW* data);
    [LibraryImport("dwmapi.dll")] public static partial int DwmGetWindowAttribute(nint h, uint attr, void* value, int size);
    [LibraryImport("dwmapi.dll")] public static partial int DwmSetWindowAttribute(nint h, uint attr, void* value, int size);

    /// Dark window frame regardless of the Windows light/dark setting: dark caption buttons and title bar,
    /// a #1D1D1D hairline border, and (optionally) a #0A0A0A caption. Ignored where unsupported (Windows 10).
    public static void DarkFrame(nint hwnd, bool caption)
    {
        int on = 1;
        DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &on, 4);
        uint border = 0x001D1D1D; // COLORREF is 0x00BBGGRR
        DwmSetWindowAttribute(hwnd, 34 /* DWMWA_BORDER_COLOR */, &border, 4);
        if (!caption) return;
        uint cap = 0x000A0A0A, text = 0x00EDEDED;
        DwmSetWindowAttribute(hwnd, 35 /* DWMWA_CAPTION_COLOR */, &cap, 4);
        DwmSetWindowAttribute(hwnd, 36 /* DWMWA_TEXT_COLOR */, &text, 4);
    }
    [LibraryImport("kernel32.dll")] public static partial nint OpenProcess(uint access, int inherit, uint pid);
    [LibraryImport("kernel32.dll")] public static partial int CloseHandle(nint h);
    [LibraryImport("kernel32.dll")] public static partial int QueryFullProcessImageNameW(nint proc, uint flags, char* buf, ref int size);
    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)] private static partial nint GetModuleHandleW(string? name);
    [LibraryImport("d3d11.dll")] public static partial int CreateDirect3D11DeviceFromDXGIDevice(nint dxgiDevice, out nint inspectable);
    [LibraryImport("combase.dll")] public static partial int RoGetActivationFactory(nint classId, Guid* iid, out nint factory);
    [LibraryImport("combase.dll", StringMarshalling = StringMarshalling.Utf16)] public static partial int WindowsCreateString(string s, int len, out nint hstring);
    [LibraryImport("combase.dll")] public static partial int WindowsDeleteString(nint hstring);

    public static void CopyTo(char* dst, int capacity, string s)
    {
        int n = Math.Min(s.Length, capacity - 1);
        s.AsSpan(0, n).CopyTo(new Span<char>(dst, capacity));
        dst[n] = '\0';
    }

    public static string ClassName(nint h)
    {
        char* buf = stackalloc char[64];
        int n = GetClassNameW(h, buf, 64);
        return new string(buf, 0, n);
    }

    /// Lowercase exe name without extension, or "" if the process can't be queried.
    public static string ProcessName(uint pid)
    {
        nint p = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, pid);
        if (p == 0) return "";
        try
        {
            char* buf = stackalloc char[520];
            int size = 520;
            if (QueryFullProcessImageNameW(p, 0, buf, ref size) == 0) return "";
            return Path.GetFileNameWithoutExtension(new string(buf, 0, size)).ToLowerInvariant();
        }
        finally { CloseHandle(p); }
    }

    public static MONITORINFO PrimaryMonitor(out nint hmon)
    {
        hmon = MonitorFromPoint(default, 1 /* MONITOR_DEFAULTTOPRIMARY */);
        var mi = new MONITORINFO { cbSize = sizeof(MONITORINFO) };
        GetMonitorInfoW(hmon, ref mi);
        return mi;
    }

    // ---- Minimal Win32 window: one shared WndProc, a handler per HWND. UI thread only. ----

    /// Return a value to handle the message, null to fall through to DefWindowProc.
    public delegate nint? Handler(uint msg, nint wParam, nint lParam);

    static readonly Dictionary<nint, Handler> s_handlers = [];
    static readonly HashSet<string> s_classes = [];

    public static nint CreateWindow(string cls, string title, uint style, uint exStyle, int x, int y, int w, int h, Handler handler)
    {
        nint inst = GetModuleHandleW(null);
        if (s_classes.Add(cls))
        {
            fixed (char* name = cls)
            {
                var wc = new WNDCLASSEXW
                {
                    cbSize = sizeof(WNDCLASSEXW),
                    lpfnWndProc = &WndProc,
                    hInstance = inst,
                    hCursor = LoadCursorW(0, 32512 /* IDC_ARROW */),
                    lpszClassName = name,
                };
                RegisterClassExW(&wc);
            }
        }
        nint hwnd = CreateWindowExW(exStyle, cls, title, style, x, y, w, h, 0, 0, inst, 0);
        s_handlers[hwnd] = handler;
        return hwnd;
    }

    [UnmanagedCallersOnly]
    static nint WndProc(nint hwnd, uint msg, nint w, nint l)
    {
        if (s_handlers.TryGetValue(hwnd, out var handler))
        {
            if (msg == WM_NCDESTROY) s_handlers.Remove(hwnd);
            try { if (handler(msg, w, l) is nint r) return r; }
            catch (Exception e) { Debug.WriteLine(e); } // never let an exception cross into user32
        }
        return DefWindowProcW(hwnd, msg, w, l);
    }
}
