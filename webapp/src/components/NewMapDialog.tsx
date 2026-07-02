"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { createMapFromUpload } from "@/lib/maps";

/* Modal to create a new map by uploading a CAD file. The file is stored and the map
   is created in "processing" state (server-side DWG→SVG conversion is wired later). */
export function NewMapDialog({ onClose }: { onClose: () => void }) {
  const { identity } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!identity || !file) return;
    setBusy(true);
    try {
      const id = await createMapFromUpload(identity, title.trim() || file.name, file);
      router.push(`/map/${id}`);
    } catch (e) {
      setBusy(false);
      alert("Upload failed: " + e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4"
      onClick={busy ? undefined : onClose} // not dismissible mid-upload — it would navigate later anyway
    >
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-4">New map</h2>

        <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
          Title
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Plaza Level 2027"
          className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
        />

        <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
          CAD file
        </label>
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full border border-dashed border-[color:var(--color-line)] rounded-md px-3 py-6 text-sm text-[color:var(--color-ink-soft)] hover:bg-[#f8f9fa] hover:border-[color:var(--color-accent)] transition"
        >
          {file ? (
            <span className="text-[color:var(--color-ink)]">{file.name}</span>
          ) : (
            <>Click to choose a .dwg / .dxf file</>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".dwg,.dxf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <p className="text-xs text-[color:var(--color-ink-soft)] mt-3 leading-relaxed">
          The floorplan is rendered from the CAD file automatically — this takes about
          10–20 seconds, and you’ll be taken straight to the map.
        </p>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Uploading…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
