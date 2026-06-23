// Small 2D polygon helpers for in-app booth editing (splitting a booth in half).
export type Pt = [number, number];

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function centroid(poly: Pt[]): Pt {
  // Area-weighted centroid; falls back to vertex average for degenerate polys.
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(poly: Pt[]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    minx: Math.min(...xs),
    maxx: Math.max(...xs),
    miny: Math.min(...ys),
    maxy: Math.max(...ys),
  };
}

/**
 * Clip a polygon to one side of an axis-aligned line (Sutherland–Hodgman against a
 * single half-plane). `axis` 'x' or 'y'; `keepBelow` keeps the side with coord <= value.
 * Exact for convex booths (the common rectangular case).
 */
function clipHalfPlane(poly: Pt[], axis: "x" | "y", value: number, keepBelow: boolean): Pt[] {
  const ax = axis === "x" ? 0 : 1;
  const inside = (p: Pt) => (keepBelow ? p[ax] <= value : p[ax] >= value);
  const intersect = (a: Pt, b: Pt): Pt => {
    const t = (value - a[ax]) / (b[ax] - a[ax]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const out: Pt[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i];
    const prev = poly[(i + n - 1) % n];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

/**
 * Split a booth polygon into two halves. Direction "auto" cuts across the longer side
 * (so a wide booth splits left/right, a tall one top/bottom). Returns two polygons.
 */
export function splitPolygon(
  poly: Pt[],
  direction: "auto" | "vertical" | "horizontal" = "auto",
): [Pt[], Pt[]] {
  const { minx, maxx, miny, maxy } = bbox(poly);
  const w = maxx - minx;
  const h = maxy - miny;
  // "vertical" cut = a vertical line (splits left|right) -> use x axis.
  const useX = direction === "vertical" || (direction === "auto" && w >= h);
  if (useX) {
    const mid = (minx + maxx) / 2;
    return [clipHalfPlane(poly, "x", mid, true), clipHalfPlane(poly, "x", mid, false)];
  }
  const mid = (miny + maxy) / 2;
  return [clipHalfPlane(poly, "y", mid, true), clipHalfPlane(poly, "y", mid, false)];
}
