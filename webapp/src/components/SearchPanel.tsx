"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Booth } from "./PanZoom";
import type { BoothAssignment, StatusType } from "@/lib/maps";
import { StatusFilterMenu, NO_STATUS_ID } from "./StatusFilterMenu";

/** A booth in the cross-level search index, tagged with the level it lives on. */
export type SearchBooth = {
  booth: Booth;
  levelId: string;
  levelName: string;
  levelIndex: number;
};

/**
 * Floating search panel. Searches booths across ALL levels of the map (by number /
 * exhibitor name and/or a chosen status). Picking a result on another level switches to
 * it. Matches are reported up (`onResults`) as indices into `booths`.
 */
export function SearchPanel({
  booths,
  multiLevel,
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
  booths: SearchBooth[];
  multiLevel: boolean;
  assignments: Record<string, BoothAssignment>;
  statusTypes: StatusType[];
  query: string;
  view: "list" | "map";
  statusFilter: string[];
  onQueryChange: (q: string) => void;
  onViewChange: (v: "list" | "map") => void;
  onStatusFilterChange: (s: string[]) => void;
  onResults: (indices: number[]) => void;
  onPick: (index: number) => void;
  onFrameAll: (indices: number[]) => void;
  onClose: () => void;
}) {
  const q = query;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const hasStatuses = statusTypes.some((t) => t.statuses.length > 0);
  const filterSet = useMemo(() => new Set(statusFilter), [statusFilter]);
  const searching = q.trim() !== "" || filterSet.size > 0;

  const statusInfo = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    statusTypes.forEach((t) => t.statuses.forEach((s) => m.set(s.id, { name: s.name, color: s.color })));
    return m;
  }, [statusTypes]);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term && filterSet.size === 0) return [] as number[];
    const out: number[] = [];
    booths.forEach((sb, i) => {
      const b = sb.booth;
      const num = (b.number ?? "").toLowerCase();
      const name = (b.number ? assignments[b.number]?.exhibitor : "")?.toLowerCase() ?? "";
      const textOk = !term || num.includes(term) || name.includes(term);
      const sid = b.number ? assignments[b.number]?.statusId : undefined;
      // Empty filter = all on. Otherwise a booth passes iff its status (or the
      // "no status" category) is among the still-checked ones.
      const statusOk = filterSet.size === 0 || filterSet.has(sid ?? NO_STATUS_ID);
      if (textOk && statusOk) out.push(i);
    });
    return out.sort((a, b) => {
      const na = booths[a].booth.number ?? "";
      const nb = booths[b].booth.number ?? "";
      return na.localeCompare(nb, undefined, { numeric: true });
    });
  }, [q, filterSet, booths, assignments]);

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
            <StatusFilterMenu
              statusTypes={statusTypes}
              selected={statusFilter}
              onChange={onStatusFilterChange}
            />
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
            {multiLevel && <span className="text-[color:var(--color-ink-soft)]"> · all levels</span>}
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
                const sb = booths[i];
                const b = sb.booth;
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
                        <span className="block text-xs text-[color:var(--color-ink-soft)]">
                          {multiLevel && <span>{sb.levelName}</span>}
                          {multiLevel && b.width_m != null && " · "}
                          {b.width_m != null && `${b.width_m} × ${b.depth_m} m`}
                        </span>
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
            ? `Highlighted ${matches.length} ${matches.length === 1 ? "booth" : "booths"} across the map.`
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
