using CloakDesk;
using static CloakDesk.CurtainMath;

// dotnet run: exits non-zero on the first failed check.
var screen = new Rect(0, 0, 100, 100);
long Area(List<Rect> rs) => rs.Sum(r => (long)(r.Right - r.Left) * (r.Bottom - r.Top));
void Check(bool ok, string what) { if (!ok) { Console.Error.WriteLine($"FAIL: {what}"); Environment.Exit(1); } }

// Cloaked window alone: curtained fully.
Check(Area(Curtains([new(new(10, 10, 50, 50), true)], screen)) == 1600, "lone cloaked window");

// Uncloaked window above a cloaked one: overlap stays visible.
var c = Curtains([new(new(30, 30, 70, 70), false), new(new(10, 10, 50, 50), true)], screen);
Check(Area(c) == 1600 - 400, "uncloaked window above punches a hole");
Check(c.All(r => r.Intersect(new(30, 30, 70, 70)).IsEmpty), "no curtain over the uncloaked window");

// Cloaked window above an uncloaked one: fully curtained.
Check(Area(Curtains([new(new(10, 10, 50, 50), true), new(new(30, 30, 70, 70), false)], screen)) == 1600, "cloaked on top");

// Fully covered cloaked window: nothing to curtain.
Check(Curtains([new(screen, false), new(new(10, 10, 50, 50), true)], screen).Count == 0, "fully covered");

// Clipped to the screen.
Check(Area(Curtains([new(new(-50, -50, 20, 20), true)], screen)) == 400, "clipped to bounds");

// Subtract pieces never overlap and cover exactly a minus b.
var pieces = new List<Rect>();
Subtract(new(0, 0, 10, 10), new(3, 3, 6, 6), pieces);
Check(pieces.Count == 4 && Area(pieces) == 91, "subtract middle");

Console.WriteLine("CurtainMath: all checks passed");
