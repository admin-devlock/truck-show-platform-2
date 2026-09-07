"use client";

import { useEffect, useMemo, useState } from "react";
import type { Booth } from "./PanZoom";
import type { BoothAssignment, StatusType } from "@/lib/maps";
import { statusIdForType } from "@/lib/statuses";

const MINIMIZED_STORAGE_KEY = "truckshow.statusLegend.minimized";

/** All visible status types, ordered so the first assigned type controls booth colour. */
export function StatusLegend({
  types,
  booths,
  assignments,
  onClear,
  onReorder,
}: {
  types: StatusType[];
  booths: Booth[];
  assignments: Record<string, BoothAssignment>;
  onClear: () => void;
  onReorder: (typeIds: string[]) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MINIMIZED_STORAGE_KEY);
      if (saved !== null) setMinimized(saved === "true");
    } catch {
      // Storage may be unavailable; the current-page control still works.
    }
  }, []);

  const toggleMinimized = () => {
    setMinimized((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MINIMIZED_STORAGE_KEY, String(next));
      } catch {
        // Keep the in-memory toggle working even when storage is unavailable.
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    const result = new Map<string, { statuses: Record<string, number>; none: number }>();
    for (const type of types) {
      const statuses: Record<string, number> = {};
      let none = 0;
      for (const booth of booths) {
        if (!booth.number) continue;
        const statusId = statusIdForType(assignments[booth.number], type);
        if (statusId) statuses[statusId] = (statuses[statusId] ?? 0) + 1;
        else none += 1;
      }
      result.set(type.id, { statuses, none });
    }
    return result;
  }, [booths, assignments, types]);

  const dropBefore = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const originalIds = types.map((type) => type.id);
    const sourceIndex = originalIds.indexOf(draggingId);
    const targetIndex = originalIds.indexOf(targetId);
    const ids = originalIds.filter((id) => id !== draggingId);
    const insertionIndex = ids.indexOf(targetId) + (sourceIndex < targetIndex ? 1 : 0);
    ids.splice(insertionIndex, 0, draggingId);
    setDraggingId(null);
    onReorder(ids);
  };

  return (
    <div
      className={`absolute bottom-5 left-5 z-20 card p-3 ${
        minimized ? "w-auto min-w-44" : "w-64 max-h-[calc(100vh-8rem)] overflow-auto"
      }`}
    >
      <div className={`flex items-center justify-between gap-2 ${minimized ? "" : "mb-1"}`}>
        <span className="text-xs font-medium truncate">Status priority</span>
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
          <button type="button" onClick={onClear} className="text-xs text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-accent)] shrink-0">
            Clear
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {types.length > 1 && (
            <p className="text-[10px] text-[color:var(--color-ink-soft)] mb-2">
              Drag to reorder · top colour wins
            </p>
          )}
          <div className="space-y-2">
            {types.map((type, index) => {
              const typeCounts = counts.get(type.id);
              return (
                <section
                  key={type.id}
                  draggable={types.length > 1}
                  onDragStart={(event) => {
                    setDraggingId(type.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", type.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropBefore(type.id);
                  }}
                  className={`rounded-md border border-[color:var(--color-line)] p-2 transition-opacity ${draggingId === type.id ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {types.length > 1 && (
                      <span className="cursor-grab text-[color:var(--color-ink-soft)] select-none" title="Drag to change priority">⠿</span>
                    )}
                    <span className="text-xs font-medium flex-1 truncate" title={type.name}>{type.name}</span>
                    {types.length > 1 && (
                      <span className="text-[10px] text-[color:var(--color-ink-soft)] tabular-nums">{index + 1}</span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {type.statuses.map((status) => (
                      <li key={status.id} className="flex items-center gap-2 text-xs">
                        <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: status.color }} />
                        <span className="flex-1 truncate">{status.name}</span>
                        <span className="text-[color:var(--color-ink-soft)] tabular-nums">{typeCounts?.statuses[status.id] ?? 0}</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-2 text-xs pt-1 border-t border-[color:var(--color-line)]">
                      <span className="h-3 w-3 rounded-sm shrink-0 border border-[color:var(--color-line)]" />
                      <span className="flex-1 truncate text-[color:var(--color-ink-soft)]">No status</span>
                      <span className="text-[color:var(--color-ink-soft)] tabular-nums">{typeCounts?.none ?? 0}</span>
                    </li>
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
