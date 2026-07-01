"use client";

import { useEffect, useState } from "react";
import {
  saveStatusTypes,
  setActiveStatusType,
  getBoothDataOnce,
  subscribeMaps,
  type StatusType,
  type BoothStatus,
  type MapDoc,
} from "@/lib/maps";

const PALETTE = [
  "#1e8e3e", "#188038", "#1a73e8", "#e37400", "#f9ab00",
  "#d93025", "#c5221f", "#9334e6", "#129eaf", "#5f6368",
];
const uid = () => Math.random().toString(36).slice(2, 9);

export function StatusManager({
  mapId,
  statusTypes,
  activeStatusTypeId,
  onClose,
}: {
  mapId: string;
  statusTypes: StatusType[];
  activeStatusTypeId: string | null;
  onClose: () => void;
}) {
  const [types, setTypes] = useState<StatusType[]>(() =>
    JSON.parse(JSON.stringify(statusTypes)),
  );
  // Which status type's colours are shown on the map — one at a time (or none).
  const [shownId, setShownId] = useState<string | null>(activeStatusTypeId);
  const [busy, setBusy] = useState(false);

  // Copy-from-another-map picker.
  const [copyOpen, setCopyOpen] = useState(false);
  const [maps, setMaps] = useState<MapDoc[]>([]);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  useEffect(() => subscribeMaps((m) => setMaps(m.filter((x) => x.id !== mapId))), [mapId]);

  const update = (next: StatusType[]) => setTypes(next);

  const addType = () =>
    update([...types, { id: uid(), name: "New status type", statuses: [] }]);
  const removeType = (ti: number) => {
    if (types[ti].id === shownId) setShownId(null);
    update(types.filter((_, i) => i !== ti));
  };
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

  // Bring in another map's status types — add those we don't already have (by name).
  const copyFrom = async (sourceId: string) => {
    if (!sourceId) return;
    setCopyBusy(true);
    setCopyNote(null);
    try {
      const { statusTypes: src } = await getBoothDataOnce(sourceId, "main");
      const have = new Set(types.map((t) => t.name.trim().toLowerCase()));
      const incoming = src.filter((t) => !have.has(t.name.trim().toLowerCase()));
      if (incoming.length) update([...types, ...JSON.parse(JSON.stringify(incoming))]);
      setCopyNote(
        incoming.length
          ? `Added ${incoming.length} status type${incoming.length === 1 ? "" : "s"}.`
          : src.length
            ? "That map’s status types are already here."
            : "That map has no status types.",
      );
    } catch {
      setCopyNote("Couldn’t read that map’s statuses.");
    } finally {
      setCopyBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveStatusTypes(mapId, types);
      // Persist which type's colours are shown (one at a time). Guard against a shown
      // type that was removed during editing.
      const validShown = types.some((t) => t.id === shownId) ? shownId : null;
      await setActiveStatusType(mapId, validShown);
      onClose();
    } catch (e) {
      setBusy(false);
      alert("Couldn’t save: " + e);
    }
  };

  // Single-select: showing one type's colours unselects any other.
  const toggleShown = (id: string) => setShownId((cur) => (cur === id ? null : id));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-5">Status types</h2>

        {types.length === 0 && !copyOpen && (
          <div className="border border-dashed border-[color:var(--color-line)] rounded-lg py-8 text-center mb-4">
            <div className="text-sm text-[color:var(--color-ink-soft)] mb-3">No status types yet.</div>
            <div className="flex items-center justify-center gap-2">
              <button onClick={addType} className="btn btn-primary">
                Add status type
              </button>
              {maps.length > 0 && (
                <button onClick={() => setCopyOpen(true)} className="btn btn-ghost">
                  Copy from a map
                </button>
              )}
            </div>
          </div>
        )}

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
                  onClick={() => toggleShown(t.id)}
                  disabled={t.statuses.length === 0}
                  aria-pressed={shownId === t.id}
                  title="Show this status type’s colours on the map (one type at a time)"
                  className={`text-xs px-2 py-1 rounded-md border flex items-center gap-1 disabled:opacity-40 ${
                    shownId === t.id
                      ? "bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]"
                      : "text-[color:var(--color-ink-soft)] border-[color:var(--color-line)] hover:bg-[#f1f3f4]"
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {shownId === t.id ? "Shown on map" : "Show on map"}
                </button>
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

        {(types.length > 0 || copyOpen) && (
          <div className="flex items-center gap-4 mt-4">
            <button onClick={addType} className="text-sm text-[color:var(--color-accent)] hover:underline">
              + Add status type
            </button>
            {maps.length > 0 && (
              <button
                onClick={() => setCopyOpen((v) => !v)}
                className="text-sm text-[color:var(--color-accent)] hover:underline"
              >
                Copy from a map
              </button>
            )}
          </div>
        )}

        {copyOpen && (
          <div className="mt-3 border border-[color:var(--color-line)] rounded-lg p-3 bg-[#f8f9fa]">
            <div className="flex items-center gap-2">
              <select
                defaultValue=""
                onChange={(e) => copyFrom(e.target.value)}
                disabled={copyBusy}
                className="flex-1 border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm bg-white outline-none focus:border-[color:var(--color-accent)]"
              >
                <option value="">Choose a map…</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setCopyOpen(false);
                  setCopyNote(null);
                }}
                aria-label="Close"
                className="h-8 w-8 grid place-items-center rounded-full hover:bg-[#eceff1] text-[color:var(--color-ink-soft)]"
              >
                ×
              </button>
            </div>
            {(copyBusy || copyNote) && (
              <div className="text-xs text-[color:var(--color-ink-soft)] mt-2">
                {copyBusy ? "Copying…" : copyNote}
              </div>
            )}
          </div>
        )}

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
