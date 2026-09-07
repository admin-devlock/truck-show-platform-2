"use client";

import { useEffect, useMemo, useState } from "react";
import type { Booth } from "./PanZoom";
import type { BoothAssignment, StatusType } from "@/lib/maps";

const MINIMIZED_STORAGE_KEY = "truckshow.statusLegend.minimized";

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
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MINIMIZED_STORAGE_KEY);
      if (saved !== null) setMinimized(saved === "true");
    } catch {
      // Storage can be unavailable in privacy-restricted browsers; the legend still
      // works for the current page in that case.
    }
  }, []);

  const toggleMinimized = () => {
    setMinimized((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MINIMIZED_STORAGE_KEY, String(next));
      } catch {
        // Keep the in-memory toggle working even if persistence is unavailable.
      }
      return next;
    });
  };

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
    <div className={`absolute bottom-5 left-5 z-20 card p-3 ${minimized ? "w-auto min-w-40" : "w-56"}`}>
      <div className={`flex items-center justify-between gap-2 ${minimized ? "" : "mb-2"}`}>
        <span className="text-xs font-medium truncate" title={type.name}>{type.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={toggleMinimized}
            aria-label={minimized ? "Expand status legend" : "Minimize status legend"}
            aria-expanded={!minimized}
            title={minimized ? "Expand" : "Minimize"}
            className="h-5 w-5 grid place-items-center rounded-sm text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4] hover:text-[color:var(--color-accent)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {minimized ? <polyline points="3 7 6 4 9 7" /> : <polyline points="3 5 6 8 9 5" />}
            </svg>
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)] shrink-0"
          >
            Clear
          </button>
        </div>
      </div>
      {!minimized && (
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
      )}
    </div>
  );
}
