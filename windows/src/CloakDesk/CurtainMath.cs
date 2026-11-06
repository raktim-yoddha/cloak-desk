namespace CloakDesk;

/// Pure rectangle logic for curtains. No Windows types, so tests/CurtainMath.Check can link it directly.
public static class CurtainMath
{
    public readonly record struct Rect(int Left, int Top, int Right, int Bottom)
    {
        public bool IsEmpty => Right <= Left || Bottom <= Top;
        public Rect Inflate(int n) => new(Left - n, Top - n, Right + n, Bottom + n);
        public Rect Intersect(Rect o) => new(Math.Max(Left, o.Left), Math.Max(Top, o.Top), Math.Min(Right, o.Right), Math.Min(Bottom, o.Bottom));
    }

    /// Windows in z-order, topmost first. Cloaked = curtain it; otherwise it hides whatever is below it.
    public readonly record struct Layer(Rect Rect, bool Cloaked);

    /// Curtain rects: every cloaked window minus the uncloaked windows above it, clipped to bounds.
    public static List<Rect> Curtains(IReadOnlyList<Layer> topToBottom, Rect bounds)
    {
        var curtains = new List<Rect>();
        var above = new List<Rect>();
        var pieces = new List<Rect>();
        var next = new List<Rect>();
        foreach (var layer in topToBottom)
        {
            var r = layer.Rect.Intersect(bounds);
            if (r.IsEmpty) continue;
            if (!layer.Cloaked) { above.Add(r); continue; }

            pieces.Clear();
            pieces.Add(r);
            foreach (var o in above)
            {
                next.Clear();
                foreach (var p in pieces) Subtract(p, o, next);
                (pieces, next) = (next, pieces);
                if (pieces.Count == 0) break;
            }
            curtains.AddRange(pieces);
        }
        return curtains;
    }

    /// a minus b, as up to four non-overlapping rects appended to output.
    public static void Subtract(Rect a, Rect b, List<Rect> output)
    {
        var i = a.Intersect(b);
        if (i.IsEmpty) { output.Add(a); return; }
        if (a.Top < i.Top) output.Add(a with { Bottom = i.Top });
        if (i.Bottom < a.Bottom) output.Add(a with { Top = i.Bottom });
        if (a.Left < i.Left) output.Add(new(a.Left, i.Top, i.Left, i.Bottom));
        if (i.Right < a.Right) output.Add(new(i.Right, i.Top, a.Right, i.Bottom));
    }
}
