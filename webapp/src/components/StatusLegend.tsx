"use client";

import { useMemo } from "react";
import type { Booth } from "./PanZoom";
import type { BoothAssignment, StatusType } from "@/lib/maps";

/**
 * Floating legend shown while a status type is the map's highlight lens. Lists the
 * type's statuses with their colour + a live count of booths in each (across the whole
 * map — assignments are map-wide), and a "Clear" that drops the highlight.
 */
export function StatusLegend({
  type,
  booths,
  assignments,
  onClear,
}: {
  type: StatusType;
  booths: Booth[];
  assignments: Record<string, BoothAssignment>;
  onClear: () => void;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    let none = 0;
    const ids = new Set(type.statuses.map((s) => s.id));
    for (const b of booths) {
      if (!b.number) continue;
      const sid = assignments[b.number]?.statusId;
      if (sid && ids.has(sid)) c[sid] = (c[sid] ?? 0) + 1;
      else none += 1;
    }
    return { c, none };
  }, [booths, assignments, type]);

  return (
    <div className="absolute bottom-5 left-5 z-20 card p-3 w-56">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium truncate">{type.name}</span>
        <button
          onClick={onClear}
          className="text-xs text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)] shrink-0"
        >
          Clear
        </button>
      </div>
      <ul className="space-y-1.5">
        {type.statuses.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-xs">
            <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-[color:var(--color-ink-soft)] tabular-nums">{counts.c[s.id] ?? 0}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-xs pt-1 border-t border-[color:var(--color-line)]">
          <span className="h-3 w-3 rounded-sm shrink-0 border border-[color:var(--color-line)]" />
          <span className="flex-1 truncate text-[color:var(--color-ink-soft)]">No status</span>
          <span className="text-[color:var(--color-ink-soft)] tabular-nums">{counts.none}</span>
        </li>
      </ul>
    </div>
  );
}
