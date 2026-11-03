using System.Diagnostics;
using System.Runtime.InteropServices;
using SharpGen.Runtime;
using Vortice.Direct2D1;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;
using Vortice.WIC;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using WinRT;
using D2DPixelFormat = Vortice.DCommon.PixelFormat;
using D3DLevel = Vortice.Direct3D.FeatureLevel;

namespace CloakDesk;

/// What the compositor needs from a preset. Immutable, swapped atomically from the UI thread.
sealed record Look(HashSet<string> Apps, bool Desktop, Color4 Color, Look.Picture? Image)
{
    public sealed record Picture(string Path, byte[] Pixels, int Width, int Height);

    static Picture? s_cache;

    public static Look From(Preset p)
    {
        var (r, g, b) = p.Rgb();
        return new(new(p.Apps), p.Desktop, new Color4(r / 255f, g / 255f, b / 255f, 1f), Decode(p.Image));
    }

    /// Decodes on the UI thread (COM is ready there), cached so editing other fields doesn't re-decode.
    static Picture? Decode(string? path)
    {
        if (path is null) return null;
        if (s_cache?.Path == path) return s_cache;
        try
        {
            using var wic = new IWICImagingFactory();
            using var decoder = wic.CreateDecoderFromFileName(path, FileAccess.Read, DecodeOptions.CacheOnLoad);
            using var frame = decoder.GetFrame(0);
            using var bgra = wic.CreateFormatConverter();
            bgra.Initialize(frame, Vortice.WIC.PixelFormat.Format32bppPBGRA);
            var size = bgra.Size;
            var pixels = new byte[size.Width * size.Height * 4];
            bgra.CopyPixels((uint)size.Width * 4, pixels);
            return s_cache = new(path, pixels, size.Width, size.Height);
        }
        catch (SharpGenException e) { Debug.WriteLine(e); return null; } // missing or unreadable image: fall back to color
    }
}

/// Captures the primary monitor, paints curtains over cloaked windows, shows it in the "Cloak Desk Stage"
/// window that the user shares. All GPU: one texture copy + rectangle fills per frame.
sealed unsafe class Stage : IDisposable
{
    const int Pad = 6; // curtain margin so a fast-dragged window doesn't leak an edge for a frame
    const DirectXPixelFormat CaptureFormat = DirectXPixelFormat.B8G8R8A8UIntNormalized;

    public event Action? Closed;
    public Look Look { get => _look; set => _look = value; }

    readonly nint _hwnd;
    readonly ID3D11Device _device;
    readonly ID3D11DeviceContext _context;
    readonly IDXGISwapChain1 _swap;
    readonly ID2D1DeviceContext _d2d;
    readonly IDirect3DDevice _winrtDevice;
    readonly Direct3D11CaptureFramePool _pool;
    readonly GraphicsCaptureSession _session;
    readonly GCHandle _self;
    readonly Lock _lock = new();
    readonly uint _myPid = (uint)Environment.ProcessId;
    readonly Dictionary<uint, string> _names = [];
    readonly List<CurtainMath.Layer> _layers = [];
    volatile Look _look;
    Look _enumLook;
    CurtainMath.Rect _monitor;
    SizeInt32 _size;
    ID2D1Bitmap? _image;
    Look.Picture? _imageSource;
    int _frames;
    bool _disposed;

    public Stage(Look look)
    {
        if (!GraphicsCaptureSession.IsSupported()) throw new NotSupportedException("Screen capture needs Windows 10 version 2004 or later.");
        _look = _enumLook = look;
        _self = GCHandle.Alloc(this);
        try
        {
            var mi = Native.PrimaryMonitor(out var hmon);
            _monitor = ToRect(mi.rcMonitor);

            D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport, [D3DLevel.Level_11_1, D3DLevel.Level_11_0, D3DLevel.Level_10_1, D3DLevel.Level_10_0], out _device!, out _context!).CheckError();
            using (var mt = _device.QueryInterface<ID3D11Multithread>()) mt.SetMultithreadProtected(true); // shared with the capture thread
            using var dxgiDevice = _device.QueryInterface<IDXGIDevice>();
            Marshal.ThrowExceptionForHR(Native.CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.NativePointer, out var inspectable));
            _winrtDevice = MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
            Marshal.Release(inspectable);

            var item = CaptureItemForMonitor(hmon);
            _size = item.Size;

            var work = mi.rcWork;
            _hwnd = Native.CreateWindow("CloakDeskStage", "Cloak Desk Stage", Native.WS_OVERLAPPEDWINDOW, 0,
                work.Left + 48, work.Top + 48, (work.Right - work.Left) / 2, (work.Bottom - work.Top) / 2, OnMessage);

            using var adapter = dxgiDevice.GetAdapter();
            using var factory = adapter.GetParent<IDXGIFactory2>();
            _swap = factory.CreateSwapChainForHwnd(_device, _hwnd, new SwapChainDescription1
            {
                Width = (uint)_size.Width,
                Height = (uint)_size.Height,
                Format = Format.B8G8R8A8_UNorm,
                BufferCount = 2,
                BufferUsage = Usage.RenderTargetOutput,
                SwapEffect = SwapEffect.FlipDiscard,
                Scaling = Scaling.Stretch,
                AlphaMode = Vortice.DXGI.AlphaMode.Ignore,
                SampleDescription = new(1, 0),
            });

            using var d2dDevice = D2D1.D2D1CreateDevice(dxgiDevice, null);
            _d2d = d2dDevice.CreateDeviceContext(DeviceContextOptions.None);

            _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_winrtDevice, CaptureFormat, 2, _size);
            _pool.FrameArrived += OnFrame;
            _session = _pool.CreateCaptureSession(item);
            try { _session.IsBorderRequired = false; } catch (Exception) { } // Windows 11 only; the yellow border is harmless

            // Show without stealing focus, behind everything: it only needs to exist for the share picker.
            Native.ShowWindow(_hwnd, 4 /* SW_SHOWNOACTIVATE */);
            Native.SetWindowPos(_hwnd, 1 /* HWND_BOTTOM */, 0, 0, 0, 0, 0x13 /* NOSIZE|NOMOVE|NOACTIVATE */);
            _session.StartCapture();
        }
        catch
        {
            // Release whatever got created before the failure, so a failed start doesn't leak a D3D device.
            _session?.Dispose();
            _pool?.Dispose();
            _d2d?.Dispose();
            _swap?.Dispose();
            _winrtDevice?.Dispose();
            _context?.Dispose();
            _device?.Dispose();
            if (_hwnd != 0) Native.DestroyWindow(_hwnd);
            _self.Free();
            throw;
        }
    }

    nint? OnMessage(uint msg, nint w, nint l)
    {
        if (msg != Native.WM_CLOSE) return null;
        Closed?.Invoke();
        return 0;
    }

    void OnFrame(Direct3D11CaptureFramePool pool, object args)
    {
        lock (_lock)
        {
            if (_disposed) return;
            using var frame = pool.TryGetNextFrame();
            if (frame is null) return;
            try
            {
                if (frame.ContentSize.Width != _size.Width || frame.ContentSize.Height != _size.Height)
                {
                    // Resolution changed: resize everything, skip this frame.
                    _size = frame.ContentSize;
                    _monitor = ToRect(Native.PrimaryMonitor(out _).rcMonitor);
                    pool.Recreate(_winrtDevice, CaptureFormat, 2, _size);
                    _swap.ResizeBuffers(2, (uint)_size.Width, (uint)_size.Height, Format.B8G8R8A8_UNorm, SwapChainFlags.None).CheckError();
                    return;
                }
                Render(frame);
            }
            // ponytail: a lost device (driver update, GPU reset) just drops frames; toggling the cloak recovers.
            catch (Exception e) when (e is SharpGenException or COMException) { Debug.WriteLine(e); }
        }
    }

    void Render(Direct3D11CaptureFrame frame)
    {
        var look = _look;
        using var back = _swap.GetBuffer<ID3D11Texture2D>(0);
        using (var src = Texture(frame.Surface))
        {
            var d = src.Description;
            var w = Math.Min((int)d.Width, _size.Width);
            var h = Math.Min((int)d.Height, _size.Height);
            _context.CopySubresourceRegion(back, 0, 0, 0, 0, src, 0, new Box(0, 0, 0, w, h, 1));
        }

        var curtains = CurtainMath.Curtains(Layers(look), _monitor);

        using var surface = back.QueryInterface<IDXGISurface>();
        using var target = _d2d.CreateBitmapFromDxgiSurface(surface, new BitmapProperties1(
            new D2DPixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Ignore), 96, 96,
            BitmapOptions.Target | BitmapOptions.CannotDraw));
        _d2d.Target = target;
        _d2d.BeginDraw();
        var image = ImageFor(look.Image);
        using var brush = image is null ? _d2d.CreateSolidColorBrush(look.Color) : null;
        foreach (var c in curtains)
        {
            var r = new Rect(c.Left - _monitor.Left, c.Top - _monitor.Top, c.Right - c.Left, c.Bottom - c.Top);
            if (image is null) _d2d.FillRectangle(r, brush!);
            else _d2d.DrawBitmap(image, r, 1f, Vortice.Direct2D1.BitmapInterpolationMode.Linear, null);
        }
        _d2d.EndDraw();
        _d2d.Target = null;
        _swap.Present(0, PresentFlags.None);
    }

    ID2D1Bitmap? ImageFor(Look.Picture? picture)
    {
        if (picture == _imageSource) return _image;
        _image?.Dispose();
        _image = null;
        _imageSource = picture;
        if (picture is null) return null;
        fixed (byte* p = picture.Pixels)
        {
            _image = _d2d.CreateBitmap(new SizeI(picture.Width, picture.Height), (nint)p, (uint)picture.Width * 4,
                new BitmapProperties1(new D2DPixelFormat(Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied)));
        }
        return _image;
    }

    /// Visible top-level windows, topmost first, tagged cloaked or not.
    List<CurtainMath.Layer> Layers(Look look)
    {
        if (++_frames % 120 == 0) _names.Clear(); // process ids get reused
        _layers.Clear();
        _enumLook = look;
        Native.EnumWindows(&EnumProc, GCHandle.ToIntPtr(_self));
        return _layers;
    }

    [UnmanagedCallersOnly]
    static int EnumProc(nint hwnd, nint self)
    {
        ((Stage)GCHandle.FromIntPtr(self).Target!).Add(hwnd);
        return 1;
    }

    void Add(nint hwnd)
    {
        if (Native.IsWindowVisible(hwnd) == 0 || Native.IsIconic(hwnd) != 0) return;
        int cloaked;
        if (Native.DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, &cloaked, 4) == 0 && cloaked != 0) return; // other virtual desktop
        Native.RECT r;
        if (Native.DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, &r, sizeof(Native.RECT)) != 0) return;
        var rect = ToRect(r);
        if (rect.IsEmpty) return;

        if (hwnd == _hwnd) { _layers.Add(new(rect, true)); return; } // never mirror the Stage into itself
        Native.GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == _myPid) return; // the settings window is already excluded from capture

        var cls = Native.ClassName(hwnd);
        bool shell = cls is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd";
        bool hide = shell ? _enumLook.Desktop : _enumLook.Apps.Contains(Name(pid));
        if (hide) _layers.Add(new(rect.Inflate(Pad), true));
        // ponytail: layered / click-through windows may be see-through, so they never shield what's below.
        // Over-curtaining is the safe failure; a per-pixel alpha check would be the upgrade.
        else if ((Native.GetWindowLongPtrW(hwnd, Native.GWL_EXSTYLE) & (Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT)) == 0)
            _layers.Add(new(rect, false));
    }

    string Name(uint pid)
    {
        if (!_names.TryGetValue(pid, out var name)) _names[pid] = name = Native.ProcessName(pid);
        return name;
    }

    static CurtainMath.Rect ToRect(Native.RECT r) => new(r.Left, r.Top, r.Right, r.Bottom);

    static GraphicsCaptureItem CaptureItemForMonitor(nint hmon)
    {
        const string cls = "Windows.Graphics.Capture.GraphicsCaptureItem";
        Guid interop = new("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"); // IGraphicsCaptureItemInterop
        Guid itemIid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");  // IGraphicsCaptureItem
        Marshal.ThrowExceptionForHR(Native.WindowsCreateString(cls, cls.Length, out var name));
        try
        {
            Marshal.ThrowExceptionForHR(Native.RoGetActivationFactory(name, &interop, out var factory));
            try
            {
                nint item;
                var createForMonitor = (delegate* unmanaged[Stdcall]<nint, nint, Guid*, nint*, int>)(*(void***)factory)[4];
                Marshal.ThrowExceptionForHR(createForMonitor(factory, hmon, &itemIid, &item));
                try { return GraphicsCaptureItem.FromAbi(item); }
                finally { Marshal.Release(item); }
            }
            finally { Marshal.Release(factory); }
        }
        finally { Native.WindowsDeleteString(name); }
    }

    static ID3D11Texture2D Texture(IDirect3DSurface surface)
    {
        Guid access = new("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"); // IDirect3DDxgiInterfaceAccess
        Guid texture = new("6F15AAF2-D208-4E89-9AB4-489535D34F9C"); // ID3D11Texture2D
        nint unknown = MarshalInterface<IDirect3DSurface>.FromManaged(surface);
        try
        {
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(unknown, in access, out nint accessPtr));
            try
            {
                nint tex;
                var getInterface = (delegate* unmanaged[Stdcall]<nint, Guid*, nint*, int>)(*(void***)accessPtr)[3];
                Marshal.ThrowExceptionForHR(getInterface(accessPtr, &texture, &tex));
                return new ID3D11Texture2D(tex); // takes ownership of the reference
            }
            finally { Marshal.Release(accessPtr); }
        }
        finally { Marshal.Release(unknown); }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
        }
        _session.Dispose();
        _pool.Dispose();
        _image?.Dispose();
        _d2d.Dispose();
        _swap.Dispose();
        _winrtDevice.Dispose();
        _context.Dispose();
        _device.Dispose();
        _self.Free();
        Native.DestroyWindow(_hwnd);
    }
}
