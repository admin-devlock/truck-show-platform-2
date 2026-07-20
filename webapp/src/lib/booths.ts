// Apply in-app booth edits (splits) to the CAD-derived booth list, producing the
// "effective" booths the viewer actually shows/searches/exports. Keeping this as a
// pure transform means splits never mutate the stored render.
import type { Booth } from "@/components/PanZoom";
import type { BoothSplit } from "@/lib/maps";

/** Client-facing word for a booth's kind ("built" is called a shell booth). */
export function boothKindLabel(kind: string): string {
  switch (kind) {
    case "built":
      return "Shell";
    case "space_only":
      return "Space only";
    case "split":
      return "Split booth";
    default:
      return "Label";
  }
}

/**
 * Human word for a non-rectangular booth's footprint, or null for rectangles.
 * A rectilinear polygon with exactly 6 corners is always an L-shape (e.g. a corner
 * booth with a cut-out); anything else irregular gets the generic word. For these
 * booths a single "w × d" can't describe the outline — callers should qualify it.
 */
export function boothShape(b: Booth): "L-shaped" | "irregular" | null {
  if (!b.irregular) return null;
  const pts = b.polygon ?? [];
  const n = pts.length;
  if (n < 3) return "irregular";
  let corners = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i + n - 1) % n];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[(i + 1) % n];
    // count only real corners — CAD polygons sometimes carry collinear midpoints
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e3) corners++;
  }
  return corners === 6 ? "L-shaped" : "irregular";
}

export function applyBoothSplits(
  booths: Booth[] | undefined,
  splits: Record<string, BoothSplit>,
): Booth[] | undefined {
  if (!booths) return booths;
  if (!splits || Object.keys(splits).length === 0) return booths;
  const out: Booth[] = [];
  for (const b of booths) {
    const split = b.number ? splits[b.number] : undefined;
    if (split?.parts?.length) {
      for (const p of split.parts) {
        const poly: [number, number][] = [];
        for (let i = 0; i + 1 < p.polygon.length; i += 2) poly.push([p.polygon[i], p.polygon[i + 1]]);
        out.push({
          number: p.number,
          kind: "split",
          width_m: p.width_m,
          depth_m: p.depth_m,
          area_m2: p.area_m2,
          irregular: false,
          centroid: p.centroid,
          polygon: poly,
          splitSource: b.number,
        });
      }
    } else {
      out.push(b);
    }
  }
  return out;
}
