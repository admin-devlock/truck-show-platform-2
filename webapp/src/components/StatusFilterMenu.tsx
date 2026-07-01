"use client";

import { useMemo, useState } from "react";
import type { StatusType } from "@/lib/maps";

/**
 * Google-Docs-style checklist filter for search: every status is individually
 * togglable, and clicking a status type toggles all of its statuses at once (all on /
 * all off). `selected` is the list of enabled statusIds (empty = no filter).
 */
export function StatusFilterMenu({
  statusTypes,
  selected,
  onChange,
}: {
  statusTypes: StatusType[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const sel = useMemo(() => new Set(selected), [selected]);

  const toggleStatus = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
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
    onChange([...next]);
  };

  const active = selected.length > 0;
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
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
        {active && <span className="tabular-nums">{selected.length}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-40 w-56 card p-1 max-h-[18rem] overflow-auto">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[11px] font-medium text-[color:var(--color-ink-soft)] uppercase tracking-wide">
                Filter by status
              </span>
              {active && (
                <button
                  onClick={() => onChange([])}
                  className="text-[11px] text-[color:var(--color-accent)] hover:underline"
                >
                  Clear
                </button>
              )}
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
