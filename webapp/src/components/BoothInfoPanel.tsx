"use client";

import { useEffect, useState } from "react";
import type { Booth } from "./PanZoom";
import {
  setBoothExhibitor,
  setBoothStatus,
  splitBooth,
  unsplitBooth,
  type BoothAssignment,
  type StatusType,
  type SplitPart,
} from "@/lib/maps";
import { splitPolygon, polygonArea, centroid, bbox, type Pt } from "@/lib/geometry";

/* Slide-in panel: selected booth details + editable exhibitor name and status. */
export function BoothInfoPanel({
  mapId,
  levelId,
  booth,
  assignment,
  statusTypes,
  onClose,
}: {
  mapId: string;
  levelId: string;
  booth: Booth;
  assignment: BoothAssignment | undefined;
  statusTypes: StatusType[];
  onClose: () => void;
}) {
  const kindLabel =
    booth.kind === "built" ? "Built booth" : booth.kind === "space_only" ? "Space only" : "Label";
  const canAssign = !!booth.number;
  const [name, setName] = useState(assignment?.exhibitor ?? "");
  useEffect(() => setName(assignment?.exhibitor ?? ""), [assignment?.exhibitor, booth.number]);

  const currentStatusId = assignment?.statusId ?? null;

  // Split-a-booth-in-half (adaptability when a booth is subdivided/relabelled).
  // Hidden for now — flip ENABLE_BOOTH_SPLIT to re-expose the "Split booth in half"
  // action. Existing split parts still show "Merge halves back" so none get stranded.
  const ENABLE_BOOTH_SPLIT = false;
  const isSplitPart = !!booth.splitSource;
  const canSplit =
    ENABLE_BOOTH_SPLIT && !!booth.number && !!booth.polygon?.length && booth.kind !== "split";
  const [splitting, setSplitting] = useState(false);
  const [numA, setNumA] = useState("");
  const [numB, setNumB] = useState("");
  const [dir, setDir] = useState<"auto" | "vertical" | "horizontal">("auto");
  useEffect(() => {
    setSplitting(false);
    if (booth.number) {
      setNumA(`${booth.number}A`);
      setNumB(`${booth.number}B`);
    }
  }, [booth.number]);

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const doSplit = async () => {
    if (!booth.number || !booth.polygon?.length) return;
    const poly = booth.polygon as Pt[];
    const [pa, pb] = splitPolygon(poly, dir);
    if (pa.length < 3 || pb.length < 3) return;
    const origArea = polygonArea(poly) || 1;
    const { minx, maxx, miny, maxy } = bbox(poly);
    const useX = dir === "vertical" || (dir === "auto" && maxx - minx >= maxy - miny);
    const mk = (pts: Pt[], number: string): SplitPart => ({
      number,
      polygon: pts.flat() as number[],
      centroid: centroid(pts),
      area_m2: booth.area_m2 != null ? r1((booth.area_m2 * polygonArea(pts)) / origArea) : null,
      width_m: useX ? (booth.width_m != null ? r1(booth.width_m / 2) : null) : booth.width_m,
      depth_m: useX ? booth.depth_m : booth.depth_m != null ? r1(booth.depth_m / 2) : null,
    });
    const a = (numA.trim() || `${booth.number}A`);
    const b = (numB.trim() || `${booth.number}B`);
    await splitBooth(mapId, levelId, booth.number, [mk(pa, a), mk(pb, b)], assignment);
    onClose();
  };
  const doMerge = async () => {
    if (booth.splitSource) {
      await unsplitBooth(mapId, levelId, booth.splitSource);
      onClose();
    }
  };

  const saveName = () => {
    if (canAssign && name !== (assignment?.exhibitor ?? "")) {
      setBoothExhibitor(mapId, levelId, booth.number!, name.trim());
    }
  };
  const pickStatus = (id: string | null) => {
    if (canAssign) setBoothStatus(mapId, levelId, booth.number!, currentStatusId === id ? null : id);
  };

  return (
    <div className="absolute top-4 right-4 w-72 card p-4 z-20">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-xs text-[color:var(--color-ink-soft)]">{kindLabel}</div>
          <div className="text-2xl font-medium leading-tight">{booth.number ?? "Unnumbered"}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-7 w-7 grid place-items-center rounded-full hover:bg-[#f1f3f4] text-[color:var(--color-ink-soft)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {booth.area_m2 != null && (
        <dl className="space-y-2 mb-4">
          <Row label="Dimensions" value={`${booth.width_m} × ${booth.depth_m} m`} />
          <Row label="Area" value={`${booth.area_m2} m²`} />
        </dl>
      )}

      {canAssign ? (
        <>
          <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
            Exhibitor
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="Unassigned"
            className="w-full border border-[color:var(--color-line)] rounded-md px-2.5 py-1.5 text-sm mb-4 outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
          />

          {statusTypes.length > 0 && (
            <div className="space-y-3">
              {statusTypes.map((t) => (
                <div key={t.id}>
                  <div className="text-xs font-medium text-[color:var(--color-ink-soft)] mb-1.5">{t.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.statuses.map((s) => {
                      const active = currentStatusId === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => pickStatus(s.id)}
                          className="text-xs px-2 py-1 rounded-full border transition"
                          style={{
                            borderColor: s.color,
                            background: active ? s.color : "transparent",
                            color: active ? "#fff" : s.color,
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-[color:var(--color-ink-soft)]">
          This number has no booth outline in the drawing, so it can’t be assigned.
        </p>
      )}

      {(isSplitPart || canSplit) && (
        <div className="mt-4 pt-3 border-t border-[color:var(--color-line)]">
          {isSplitPart ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[color:var(--color-ink-soft)]">
                Half of booth {booth.splitSource}
              </span>
              <button onClick={doMerge} className="text-xs text-[color:var(--color-accent)] hover:underline">
                Merge halves back
              </button>
            </div>
          ) : !splitting ? (
            <button
              onClick={() => setSplitting(true)}
              className="text-sm text-[color:var(--color-accent)] hover:underline"
            >
              Split booth in half
            </button>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[color:var(--color-ink-soft)]">Split into two booths</div>
              <div className="flex gap-2">
                <input
                  value={numA}
                  onChange={(e) => setNumA(e.target.value)}
                  className="w-1/2 border border-[color:var(--color-line)] rounded px-2 py-1 text-sm outline-none focus:border-[color:var(--color-accent)]"
                  placeholder="301A"
                />
                <input
                  value={numB}
                  onChange={(e) => setNumB(e.target.value)}
                  className="w-1/2 border border-[color:var(--color-line)] rounded px-2 py-1 text-sm outline-none focus:border-[color:var(--color-accent)]"
                  placeholder="301B"
                />
              </div>
              <select
                value={dir}
                onChange={(e) => setDir(e.target.value as typeof dir)}
                className="w-full border border-[color:var(--color-line)] rounded px-2 py-1 text-sm bg-white outline-none focus:border-[color:var(--color-accent)]"
              >
                <option value="auto">Split across the longer side</option>
                <option value="vertical">Split left / right</option>
                <option value="horizontal">Split top / bottom</option>
              </select>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setSplitting(false)} className="btn btn-ghost text-xs px-2 py-1">
                  Cancel
                </button>
                <button onClick={doSplit} className="btn btn-primary text-xs px-2 py-1">
                  Split
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-[color:var(--color-ink-soft)]">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  );
}
