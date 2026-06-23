"use client";

import { useState } from "react";
import { saveStatusTypes, type StatusType, type BoothStatus } from "@/lib/maps";

const PALETTE = [
  "#1e8e3e", "#188038", "#1a73e8", "#e37400", "#f9ab00",
  "#d93025", "#c5221f", "#9334e6", "#129eaf", "#5f6368",
];
const uid = () => Math.random().toString(36).slice(2, 9);

// A starter template matching the brief's example.
const TEMPLATE: StatusType = {
  id: uid(),
  name: "Compliance",
  statuses: [
    { id: uid(), name: "In Progress", color: "#f9ab00" },
    { id: uid(), name: "Neighbour", color: "#1a73e8" },
    { id: uid(), name: "Plan Issues", color: "#d93025" },
    { id: uid(), name: "Plan Approved", color: "#1e8e3e" },
  ],
};

export function StatusManager({
  mapId,
  statusTypes,
  onClose,
}: {
  mapId: string;
  statusTypes: StatusType[];
  onClose: () => void;
}) {
  const [types, setTypes] = useState<StatusType[]>(() =>
    JSON.parse(JSON.stringify(statusTypes)),
  );
  const [busy, setBusy] = useState(false);

  const update = (next: StatusType[]) => setTypes(next);

  const addType = () =>
    update([...types, { id: uid(), name: "New status type", statuses: [] }]);
  const addTemplate = () => update([...types, { ...TEMPLATE, id: uid() }]);
  const removeType = (ti: number) => update(types.filter((_, i) => i !== ti));
  const renameType = (ti: number, name: string) =>
    update(types.map((t, i) => (i === ti ? { ...t, name } : t)));

  const addStatus = (ti: number) =>
    update(
      types.map((t, i) =>
        i === ti
          ? {
              ...t,
              statuses: [
                ...t.statuses,
                { id: uid(), name: "New status", color: PALETTE[t.statuses.length % PALETTE.length] },
              ],
            }
          : t,
      ),
    );
  const editStatus = (ti: number, si: number, patch: Partial<BoothStatus>) =>
    update(
      types.map((t, i) =>
        i === ti
          ? { ...t, statuses: t.statuses.map((s, j) => (j === si ? { ...s, ...patch } : s)) }
          : t,
      ),
    );
  const removeStatus = (ti: number, si: number) =>
    update(
      types.map((t, i) =>
        i === ti ? { ...t, statuses: t.statuses.filter((_, j) => j !== si) } : t,
      ),
    );

  const save = async () => {
    setBusy(true);
    try {
      await saveStatusTypes(mapId, types);
      onClose();
    } catch (e) {
      setBusy(false);
      alert("Couldn’t save: " + e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-1">Status types</h2>
        <p className="text-sm text-[color:var(--color-ink-soft)] mb-5">
          Define categories (e.g. Compliance) and the statuses within them. Each booth can
          be given one status per type.
        </p>

        <div className="space-y-5">
          {types.map((t, ti) => (
            <div key={t.id} className="border border-[color:var(--color-line)] rounded-lg p-3">
              <div className="flex items-center gap-2 mb-3">
                <input
                  value={t.name}
                  onChange={(e) => renameType(ti, e.target.value)}
                  className="flex-1 font-medium text-sm border-b border-transparent hover:border-[color:var(--color-line)] focus:border-[color:var(--color-accent)] outline-none py-1"
                />
                <button
                  onClick={() => removeType(ti)}
                  className="text-xs text-[color:var(--color-ink-soft)] hover:text-[#c5221f]"
                >
                  Remove
                </button>
              </div>
              <div className="space-y-2">
                {t.statuses.map((s, si) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={s.color}
                      onChange={(e) => editStatus(ti, si, { color: e.target.value })}
                      className="h-7 w-7 rounded cursor-pointer border border-[color:var(--color-line)] bg-transparent p-0"
                      title="Colour"
                    />
                    <input
                      value={s.name}
                      onChange={(e) => editStatus(ti, si, { name: e.target.value })}
                      className="flex-1 text-sm border border-[color:var(--color-line)] rounded px-2 py-1 outline-none focus:border-[color:var(--color-accent)]"
                    />
                    <button
                      onClick={() => removeStatus(ti, si)}
                      aria-label="Remove status"
                      className="h-7 w-7 grid place-items-center rounded-full hover:bg-[#f1f3f4] text-[color:var(--color-ink-soft)]"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button onClick={() => addStatus(ti)} className="text-sm text-[color:var(--color-accent)] hover:underline">
                  + Add status
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={addType} className="text-sm text-[color:var(--color-accent)] hover:underline">
            + Add status type
          </button>
          {types.length === 0 && (
            <button onClick={addTemplate} className="text-sm text-[color:var(--color-accent)] hover:underline">
              + Add example (Compliance)
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[color:var(--color-line)]">
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
