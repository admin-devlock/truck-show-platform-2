"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  importExhibitors,
  copyAssignmentsFromMap,
  subscribeMaps,
  getLevelsOnce,
  type MapDoc,
  type Level,
} from "@/lib/maps";

/**
 * Two ways to fill in exhibitor names in bulk:
 *  - "Paste / upload" — a CSV/TSV of `booth, exhibitor` rows (paste or .csv file).
 *  - "Copy from map"  — copy another map's assignments (optionally its statuses too).
 * Assignments are keyed by booth number, so they line up with this map's booths.
 */
export function ExhibitorImportDialog({
  mapId,
  levelId,
  boothNumbers,
  onClose,
}: {
  mapId: string;
  levelId: string;
  boothNumbers: string[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"paste" | "copy">("paste");
  const numberSet = useMemo(() => new Set(boothNumbers), [boothNumbers]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-4">Import exhibitors</h2>

        <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-sm mb-5 w-fit">
          {([["paste", "Paste / upload"], ["copy", "Copy from a map"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`px-3 py-1.5 ${
                tab === v
                  ? "bg-[color:var(--color-accent)] text-white"
                  : "text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "paste" ? (
          <PasteTab mapId={mapId} levelId={levelId} numberSet={numberSet} onClose={onClose} />
        ) : (
          <CopyTab mapId={mapId} levelId={levelId} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

/** Parse `booth, exhibitor` rows from pasted text. Accepts comma OR tab separators,
 *  skips blank lines and an optional header row. */
function parseRows(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes("\t") ? "\t" : ",";
    const idx = line.indexOf(sep);
    if (idx === -1) continue;
    const num = line.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    const name = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!num) continue;
    // Skip a header row like "booth, exhibitor".
    if (/^(booth|stand|space|no\.?|number)$/i.test(num) && !out[num]) continue;
    out[num] = name;
  }
  return out;
}

function PasteTab({
  mapId,
  levelId,
  numberSet,
  onClose,
}: {
  mapId: string;
  levelId: string;
  numberSet: Set<string>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseRows(text), [text]);
  const entries = Object.entries(parsed);
  const matched = entries.filter(([num]) => numberSet.has(num)).length;
  const unmatched = entries.length - matched;

  const apply = async () => {
    if (!entries.length) return;
    setBusy(true);
    try {
      await importExhibitors(mapId, levelId, parsed);
      onClose();
    } catch (e) {
      setBusy(false);
      alert("Import failed: " + e);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-[color:var(--color-ink-soft)]">
          Rows of “booth, exhibitor”
        </label>
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs text-[color:var(--color-accent)] hover:underline"
        >
          Upload .csv
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={"301, Acme Trucks\n310, Volvo\n311, Kenworth"}
        className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-y"
      />

      {entries.length > 0 && (
        <div className="text-xs text-[color:var(--color-ink-soft)] mt-2">
          {entries.length} {entries.length === 1 ? "row" : "rows"} · {matched} match this map
          {unmatched > 0 && ` · ${unmatched} not currently on the map (kept anyway)`}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[color:var(--color-line)]">
        <button onClick={onClose} disabled={busy} className="btn btn-ghost">
          Cancel
        </button>
        <button onClick={apply} disabled={busy || !entries.length} className="btn btn-primary disabled:opacity-50">
          {busy ? "Importing…" : `Import ${entries.length || ""} names`}
        </button>
      </div>
    </>
  );
}

function CopyTab({ mapId, levelId, onClose }: { mapId: string; levelId: string; onClose: () => void }) {
  const [maps, setMaps] = useState<MapDoc[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourceLevels, setSourceLevels] = useState<Level[]>([]);
  const [sourceLevelId, setSourceLevelId] = useState("");
  const [includeStatuses, setIncludeStatuses] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeMaps((m) => setMaps(m.filter((x) => x.id !== mapId))), [mapId]);

  // Load the chosen source map's levels so the user can pick which one to copy from.
  useEffect(() => {
    setSourceLevels([]);
    setSourceLevelId("");
    const m = maps.find((x) => x.id === sourceId);
    if (!m) return;
    let alive = true;
    getLevelsOnce(m).then((lv) => {
      if (!alive) return;
      setSourceLevels(lv);
      setSourceLevelId(lv[0]?.id ?? "");
    });
    return () => {
      alive = false;
    };
  }, [sourceId, maps]);

  const copy = async () => {
    if (!sourceId || !sourceLevelId) return;
    setBusy(true);
    try {
      const n = await copyAssignmentsFromMap(mapId, levelId, sourceId, sourceLevelId, includeStatuses);
      onClose();
      // tiny confirmation, since the dialog closes
      setTimeout(() => alert(`Copied ${n} assignment${n === 1 ? "" : "s"}.`), 0);
    } catch (e) {
      setBusy(false);
      alert("Copy failed: " + e);
    }
  };

  return (
    <>
      <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
        Copy assignments from
      </label>
      <select
        value={sourceId}
        onChange={(e) => setSourceId(e.target.value)}
        className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 outline-none focus:border-[color:var(--color-accent)] bg-white"
      >
        <option value="">Choose a map…</option>
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title}
          </option>
        ))}
      </select>

      {sourceLevels.length > 1 && (
        <>
          <label className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">
            From level
          </label>
          <select
            value={sourceLevelId}
            onChange={(e) => setSourceLevelId(e.target.value)}
            className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 outline-none focus:border-[color:var(--color-accent)] bg-white"
          >
            {sourceLevels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={includeStatuses}
          onChange={(e) => setIncludeStatuses(e.target.checked)}
        />
        Also copy status types and each booth’s status
      </label>

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[color:var(--color-line)]">
        <button onClick={onClose} disabled={busy} className="btn btn-ghost">
          Cancel
        </button>
        <button onClick={copy} disabled={busy || !sourceId || !sourceLevelId} className="btn btn-primary disabled:opacity-50">
          {busy ? "Copying…" : "Copy"}
        </button>
      </div>
    </>
  );
}
