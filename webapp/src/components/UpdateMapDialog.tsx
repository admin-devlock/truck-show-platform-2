"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  createMapFromRevision,
  getLevelsOnce,
  prepareMapRevision,
  type Level,
  type MapDoc,
  type PreparedMapRevision,
} from "@/lib/maps";

export function UpdateMapDialog({ maps, onClose }: { maps: MapDoc[]; onClose: () => void }) {
  const { identity } = useAuth();
  const router = useRouter();
  const [sourceId, setSourceId] = useState(maps[0]?.id ?? "");
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelId, setLevelId] = useState("");
  const [title, setTitle] = useState(maps[0] ? `${maps[0].title} (updated)` : "");
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedMapRevision | null>(null);
  const [busy, setBusy] = useState<"analyze" | "create" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const source = useMemo(() => maps.find((map) => map.id === sourceId) ?? null, [maps, sourceId]);

  useEffect(() => {
    if (sourceId || !maps[0]) return;
    setSourceId(maps[0].id);
    setTitle(`${maps[0].title} (updated)`);
  }, [maps, sourceId]);

  useEffect(() => {
    let active = true;
    setLevels([]);
    setLevelId("");
    setPrepared(null);
    if (!source) return;
    void getLevelsOnce(source)
      .then((next) => {
        if (!active) return;
        setLevels(next);
        setLevelId(next[0]?.id ?? "");
      })
      .catch((error) => {
        if (!active) return;
        alert("Couldn’t load the source levels: " + (error instanceof Error ? error.message : error));
      });
    return () => {
      active = false;
    };
    // Reload only when the selected map changes. Live dashboard snapshots recreate the
    // MapDoc object and must not erase a completed preview for the same source id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  const analyze = async () => {
    if (!source || !levelId || !file) return;
    setBusy("analyze");
    try {
      setPrepared(await prepareMapRevision(source, levelId, file));
    } catch (error) {
      alert("Couldn’t analyze the revision: " + (error instanceof Error ? error.message : error));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!identity || !prepared) return;
    setBusy("create");
    try {
      const id = await createMapFromRevision(identity, title, prepared);
      router.push(`/map/${id}`);
    } catch (error) {
      setBusy(null);
      alert("Couldn’t create the updated map: " + (error instanceof Error ? error.message : error));
    }
  };

  const dirty = !!file || !!prepared || title !== (source ? `${source.title} (updated)` : "");
  const dismiss = () => {
    if (busy) return;
    if (dirty && !confirm("Discard this revision import?")) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={dismiss}>
      <div className="card w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-medium">Create map from updated CAD</h2>
        <p className="text-xs text-[color:var(--color-ink-soft)] mt-1 mb-5 leading-relaxed">
          Clones an existing map, replaces one level, and transfers booth data by physical position.
          The source is backed up first and is never changed.
        </p>

        <label htmlFor="revision-source" className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">Source map</label>
        <select
          id="revision-source"
          value={sourceId}
          disabled={!!busy}
          onChange={(event) => {
            const map = maps.find((item) => item.id === event.target.value);
            setSourceId(event.target.value);
            setTitle(map ? `${map.title} (updated)` : "");
            setPrepared(null);
          }}
          className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 bg-white"
        >
          {maps.map((map) => <option key={map.id} value={map.id}>{map.title}</option>)}
        </select>

        <label htmlFor="revision-level" className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">Level being updated</label>
        <select
          id="revision-level"
          value={levelId}
          disabled={!!busy || !levels.length}
          onChange={(event) => {
            setLevelId(event.target.value);
            setPrepared(null);
          }}
          className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 bg-white"
        >
          {levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
        </select>

        <label htmlFor="revision-title" className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">New map title</label>
        <input
          id="revision-title"
          value={title}
          disabled={!!busy}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full border border-[color:var(--color-line)] rounded-md px-3 py-2 text-sm mb-4 outline-none focus:border-[color:var(--color-accent)]"
        />

        <label htmlFor="revision-file" className="block text-xs font-medium text-[color:var(--color-ink-soft)] mb-1">Updated CAD file</label>
        <button
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
          className="w-full border border-dashed border-[color:var(--color-line)] rounded-md px-3 py-5 text-sm text-[color:var(--color-ink-soft)] hover:bg-[#f8f9fa]"
        >
          {file ? <span className="text-[color:var(--color-ink)]">{file.name}</span> : "Click to choose a .dwg file"}
        </button>
        <input
          ref={fileRef}
          id="revision-file"
          type="file"
          accept=".dwg"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPrepared(null);
          }}
        />

        {prepared && <RevisionPreview prepared={prepared} />}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={dismiss} disabled={!!busy} className="btn btn-ghost">Cancel</button>
          {!prepared ? (
            <button
              onClick={analyze}
              disabled={!source || !levelId || !file || !!busy}
              className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === "analyze" ? "Backing up & analyzing…" : "Back up & analyze"}
            </button>
          ) : (
            <button onClick={create} disabled={!!busy || !title.trim()} className="btn btn-primary disabled:opacity-50">
              {busy === "create" ? "Creating new map…" : "Create new map"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RevisionPreview({ prepared }: { prepared: PreparedMapRevision }) {
  const { report } = prepared;
  const warnings = report.unmatchedOld.length + report.unmatchedNew.length + report.conflicts.length;
  return (
    <div className="mt-5 rounded-md border border-[color:var(--color-line)] bg-[#f8f9fa] p-4 text-xs">
      <div className="font-medium text-sm mb-2">Position-match preview</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[color:var(--color-ink-soft)]">
        <span>Old positioned booths</span><span className="text-[color:var(--color-ink)]">{report.oldNumberedBooths}</span>
        <span>New positioned booths</span><span className="text-[color:var(--color-ink)]">{report.newNumberedBooths}</span>
        <span>Old positions matched</span><span className="text-[color:var(--color-ink)]">{report.matchedOldBooths}</span>
        <span>Splits / merges</span><span className="text-[color:var(--color-ink)]">{report.splitBooths} / {report.mergedBooths}</span>
        <span>Assignments carried</span><span className="text-[color:var(--color-ink)]">{report.assignmentsTransferred} of {report.assignmentsFound}</span>
      </div>
      {warnings === 0 ? (
        <div className="mt-3 text-[#137333]">All positioned booth data has a clear destination.</div>
      ) : (
        <div className="mt-3 rounded border border-[#f9ab00] bg-[#fef7e0] p-2.5 text-[#7a4f01] leading-relaxed">
          {report.unmatchedOld.length > 0 && <div>Unmatched old booths: {report.unmatchedOld.join(", ")}</div>}
          {report.unmatchedNew.length > 0 && <div>New booths with no old position: {report.unmatchedNew.join(", ")}</div>}
          {report.conflicts.map((conflict) => (
            <div key={conflict.to}>
              New booth {conflict.to} overlaps old booths {conflict.from.join(" + ")}; data from {conflict.chosen} will be used.
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-[color:var(--color-ink-soft)]">
        A verified source backup has been saved. Creating continues into a separate map.
      </div>
    </div>
  );
}
