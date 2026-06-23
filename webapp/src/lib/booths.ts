// Apply in-app booth edits (splits) to the CAD-derived booth list, producing the
// "effective" booths the viewer actually shows/searches/exports. Keeping this as a
// pure transform means splits never mutate the stored render.
import type { Booth } from "@/components/PanZoom";
import type { BoothSplit } from "@/lib/maps";

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
