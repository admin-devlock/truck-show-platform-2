"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Booth } from "./PanZoom";
import type { BoothAssignment, StatusType } from "@/lib/maps";

/**
 * Floating search panel for the viewer. Finds booths by booth number / exhibitor name
 * and/or by a chosen status (the filter select at the end of the bar). Matches are
 * reported up to the viewer (`onResults`) so PanZoom highlights them; the "map" view
 * frames them all.
 */
export function SearchPanel({
  booths,
  assignments,
  statusTypes,
  query,
  view,
  statusFilter,
  onQueryChange,
  onViewChange,
  onStatusFilterChange,
  onResults,
  onPick,
  onFrameAll,
  onClose,
}: {
  booths: Booth[];
  assignments: Record<string, BoothAssignment>;
  statusTypes: StatusType[];
  query: string;
  view: "list" | "map";
  statusFilter: string | null;
  onQueryChange: (q: string) => void;
  onViewChange: (v: "list" | "map") => void;
  onStatusFilterChange: (s: string | null) => void;
  onResults: (indices: number[]) => void;
  onPick: (index: number) => void;
  onFrameAll: (indices: number[]) => void;
  onClose: () => void;
}) {
  const q = query;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const hasStatuses = statusTypes.some((t) => t.statuses.length > 0);
  const searching = q.trim() !== "" || !!statusFilter;

  // statusId -> {name, color}
  const statusInfo = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    statusTypes.forEach((t) => t.statuses.forEach((s) => m.set(s.id, { name: s.name, color: s.color })));
    return m;
  }, [statusTypes]);

  // Matches: booth text (number/exhibitor) AND the status filter, when either is set.
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term && !statusFilter) return [] as number[];
    const out: number[] = [];
    booths.forEach((b, i) => {
      const num = (b.number ?? "").toLowerCase();
      const name = (b.number ? assignments[b.number]?.exhibitor : "")?.toLowerCase() ?? "";
      const textOk = !term || num.includes(term) || name.includes(term);
      const statusOk = !statusFilter || (!!b.number && assignments[b.number]?.statusId === statusFilter);
      if (textOk && statusOk) out.push(i);
    });
    return out.sort((a, b) => {
      const na = booths[a].number ?? "";
      const nb = booths[b].number ?? "";
      return na.localeCompare(nb, undefined, { numeric: true });
    });
  }, [q, statusFilter, booths, assignments]);

  // Report matches up so the map highlights them; frame them when in map view.
  useEffect(() => {
    onResults(matches);
    if (view === "map" && matches.length) onFrameAll(matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, view]);

  useEffect(() => () => onResults([]), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute top-4 left-4 z-20 w-96 card overflow-hidden flex flex-col max-h-[calc(100vh-7rem)]">
      <div className="p-2.5 border-b border-[color:var(--color-line)]">
        <div className="flex items-center gap-2">
          <svg className="shrink-0 text-[color:var(--color-ink-soft)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && matches.length) onPick(matches[0]);
            }}
            placeholder="Search exhibitor or booth #"
            className="flex-1 min-w-0 text-sm outline-none bg-transparent"
          />
          {hasStatuses && (
            <select
              value={statusFilter ?? ""}
              onChange={(e) => onStatusFilterChange(e.target.value || null)}
              title="Filter by status"
              className={`shrink-0 max-w-[8rem] text-xs rounded-md border px-1.5 py-1 outline-none cursor-pointer bg-transparent ${
                statusFilter
                  ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                  : "border-[color:var(--color-line)] text-[color:var(--color-ink-soft)]"
              }`}
            >
              <option value="">Any status</option>
              {statusTypes.map((t) => (
                <optgroup key={t.id} label={t.name}>
                  {t.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <button
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 h-6 w-6 grid place-items-center rounded-full hover:bg-[#f1f3f4] text-[color:var(--color-ink-soft)]"
          >
            ×
          </button>
        </div>
      </div>

      {searching && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--color-line)]">
          <span className="text-xs text-[color:var(--color-ink-soft)]">
            {matches.length} {matches.length === 1 ? "result" : "results"}
          </span>
          <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-xs">
            {(["list", "map"] as const).map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={`px-2.5 py-1 capitalize ${
                  view === v
                    ? "bg-[color:var(--color-accent)] text-white"
                    : "text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {searching && view === "list" && (
        <div className="overflow-auto">
          {matches.length === 0 ? (
            <div className="px-3 py-6 text-sm text-[color:var(--color-ink-soft)] text-center">
              No booths match.
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--color-line)]">
              {matches.map((i) => {
                const b = booths[i];
                const a = b.number ? assignments[b.number] : undefined;
                const st = a?.statusId ? statusInfo.get(a.statusId) : undefined;
                return (
                  <li key={i}>
                    <button
                      onClick={() => onPick(i)}
                      className="w-full text-left px-3 py-2 hover:bg-[#f8f9fa] flex items-center gap-2.5"
                    >
                      <span className="shrink-0 inline-grid place-items-center min-w-[2.75rem] h-7 px-1.5 rounded bg-[#f1f3f4] text-xs font-semibold tabular-nums">
                        {b.number ?? "—"}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate">
                          {a?.exhibitor?.trim() || (
                            <span className="text-[color:var(--color-ink-soft)] italic">Unassigned</span>
                          )}
                        </span>
                        {b.width_m != null && (
                          <span className="block text-xs text-[color:var(--color-ink-soft)]">
                            {b.width_m} × {b.depth_m} m
                          </span>
                        )}
                      </span>
                      {st && (
                        <span
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full text-white"
                          style={{ background: st.color }}
                        >
                          {st.name}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {searching && view === "map" && (
        <div className="px-3 py-3 text-xs text-[color:var(--color-ink-soft)] leading-relaxed">
          {matches.length
            ? `Highlighted ${matches.length} ${matches.length === 1 ? "booth" : "booths"} on the map.`
            : "No booths match."}
          {matches.length > 0 && (
            <button
              onClick={() => onFrameAll(matches)}
              className="block mt-2 text-[color:var(--color-accent)] hover:underline"
            >
              Re-centre on results
            </button>
          )}
        </div>
      )}
    </div>
  );
}
