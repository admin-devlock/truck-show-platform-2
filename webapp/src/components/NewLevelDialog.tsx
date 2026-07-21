"use client";

import { useRef, useState } from "react";
import { addLevel, type MapDoc } from "@/lib/maps";

/** Add another CAD floorplan (a "level") to an existing map. */
export function NewLevelDialog({
  map,
  onClose,
  onAdded,
}: {
  map: MapDoc;
  onClose: () => void;
  onAdded: (levelId: string) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const levelId = await addLevel(map, name.trim() || file.name, file);
      onAdded(levelId);
      onClose();
    } catch (e) {
      setBusy(false);
      alert("Couldn’t add level: " + e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      onClick={busy ? undefined : onClose} // match the disabled Cancel — no mid-add dismissal
    >
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-4">Add a level</h2>

        <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
          Level name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mezzanine"
          className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
        />

        <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
          CAD file
        </label>
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full border border-dashed border-[color:var(--color-line)] rounded-md px-3 py-6 text-sm text-[color:var(--color-ink-soft)] hover:bg-[#f8f9fa] hover:border-[color:var(--color-accent)] transition"
        >
          {file ? <span className="text-[color:var(--color-ink)]">{file.name}</span> : <>Click to choose a .dwg file</>}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".dwg"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Adding…" : "Add level"}
          </button>
        </div>
      </div>
    </div>
  );
}
