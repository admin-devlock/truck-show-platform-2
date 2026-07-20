"use client";

import { useMemo, useRef, useState } from "react";
import type { StatusType, BoothKindFilter } from "@/lib/maps";
import { boothKindLabel } from "@/lib/booths";

const MENU_W = 224; // px (w-56)

// Pseudo-id for "booth has no status", so unstatused booths are their own togglable
// filter category (shared with SearchPanel's matching).
export const NO_STATUS_ID = "__no_status__";

const ALL_KINDS: BoothKindFilter[] = ["built", "space_only"];

/**
 * Google-Docs-style checklist filter for search: booth type (shell / space only) and
 * every status are individually togglable; clicking a status type toggles all of its
 * statuses at once. Everything starts ON — an empty selection is the canonical
 * "all on / no filter" state (so an empty query still matches nothing until the user
 * narrows). Unchecking makes the selection the explicit still-on list; re-checking
 * everything canonicalises back to [].
 */
export function StatusFilterMenu({
  statusTypes,
  selected,
  onChange,
  kindSelected,
  onKindChange,
}: {
  statusTypes: StatusType[];
  selected: string[];
  onChange: (next: string[]) => void;
  kindSelected: BoothKindFilter[];
  onKindChange: (next: BoothKindFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const allIds = useMemo(
    () => [...statusTypes.flatMap((t) => t.statuses.map((s) => s.id)), NO_STATUS_ID],
    [statusTypes],
  );
  // Effective checked sets: empty selection means "all on".
  const sel = useMemo(() => new Set(selected.length ? selected : allIds), [selected, allIds]);
  const kindSel = useMemo(
    () => new Set<BoothKindFilter>(kindSelected.length ? kindSelected : ALL_KINDS),
    [kindSelected],
  );

  const toggleKind = (k: BoothKindFilter) => {
    const next = new Set(kindSel);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onKindChange(ALL_KINDS.every((x) => next.has(x)) ? [] : [...next]);
  };

  // Position the menu with fixed coords from the button, so it isn't clipped by the
  // search panel's overflow.
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_W) });
    setOpen(true);
  };

  // Emit the new set, collapsing "everything checked" back to [] (the all-on default).
  const emit = (next: Set<string>) =>
    onChange(allIds.every((id) => next.has(id)) ? [] : [...next]);

  const toggleStatus = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(next);
  };
  const typeState = (t: StatusType): "on" | "off" | "some" => {
    const ids = t.statuses.map((s) => s.id);
    const on = ids.filter((id) => sel.has(id)).length;
    return on === 0 ? "off" : on === ids.length ? "on" : "some";
  };
  const toggleType = (t: StatusType) => {
    const ids = t.statuses.map((s) => s.id);
    const allOn = ids.every((id) => sel.has(id));
    const next = new Set(sel);
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    emit(next);
  };

  const active = selected.length > 0 || kindSelected.length > 0;
  const badge = selected.length + kindSelected.length;
  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label="Filter by status"
        className={`h-7 pl-1.5 pr-1 rounded-md border flex items-center gap-1 text-xs ${
          active
            ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]"
            : "border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        {active && <span className="tabular-nums">{badge}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
            className="fixed z-50 card p-1 max-h-[18rem] overflow-auto"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[11px] font-medium text-[color:var(--color-ink-soft)] uppercase tracking-wide">
                Filter booths
              </span>
              {active && (
                <button
                  onClick={() => {
                    onChange([]);
                    onKindChange([]);
                  }}
                  className="text-[11px] text-[color:var(--color-accent)] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="py-0.5">
              <div className="px-2 pt-1 text-[11px] text-[color:var(--color-ink-soft)]">Booth type</div>
              {ALL_KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleKind(k)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#f1f3f4] text-left"
                >
                  <Check state={kindSel.has(k) ? "on" : "off"} />
                  <span className="text-xs">{boothKindLabel(k)}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-[color:var(--color-line)] mt-1 pt-1">
              <div className="px-2 pt-0.5 text-[11px] text-[color:var(--color-ink-soft)]">Status</div>
            </div>
            {statusTypes.map((t) => (
              <div key={t.id} className="py-0.5">
                <button
                  onClick={() => toggleType(t)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#f1f3f4] text-left"
                >
                  <Check state={typeState(t)} />
                  <span className="text-xs font-medium truncate">{t.name}</span>
                </button>
                {t.statuses.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleStatus(s.id)}
                    className="w-full flex items-center gap-2 pl-7 pr-2 py-1.5 rounded-md hover:bg-[#f8f9fa] text-left"
                  >
                    <Check state={sel.has(s.id) ? "on" : "off"} />
                    <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="text-xs truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="border-t border-[color:var(--color-line)] mt-1 pt-1">
              <button
                onClick={() => toggleStatus(NO_STATUS_ID)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#f1f3f4] text-left"
              >
                <Check state={sel.has(NO_STATUS_ID) ? "on" : "off"} />
                <span className="h-3 w-3 rounded-sm shrink-0 border border-[color:var(--color-line)] bg-white" />
                <span className="text-xs truncate text-[color:var(--color-ink-soft)]">No status</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Check({ state }: { state: "on" | "off" | "some" }) {
  const filled = state !== "off";
  return (
    <span
      className={`h-4 w-4 rounded-[3px] border grid place-items-center shrink-0 ${
        filled
          ? "bg-[color:var(--color-accent)] border-[color:var(--color-accent)]"
          : "bg-white border-[color:var(--color-line)]"
      }`}
    >
      {state === "on" && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {state === "some" && <span className="h-[2px] w-2 bg-white rounded-full" />}
    </span>
  );
}
