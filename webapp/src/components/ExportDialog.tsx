"use client";

import { useState } from "react";
import type { Booth } from "./PanZoom";
import type { BoothAssignment, StatusType, MapDoc } from "@/lib/maps";
import {
  downloadBlob,
  safeName,
  svgToPngBlob,
  svgToPdfBlob,
  boothsToCsv,
} from "@/lib/export";
import { downloadMapBackup } from "@/lib/backup";

type Fmt = "svg" | "png" | "pdf" | "csv";

const FORMATS: { id: Fmt; label: string; desc: string }[] = [
  { id: "png", label: "PNG image", desc: "Floorplan picture, as currently shown" },
  { id: "svg", label: "SVG vector", desc: "Scalable floorplan, editable in design tools" },
  { id: "pdf", label: "PDF", desc: "Single-page document, good for printing" },
  { id: "csv", label: "CSV data", desc: "Booth, exhibitor, status & dimensions table" },
];

/** Download the map "as depicted right now" in a chosen format. */
export function ExportDialog({
  map,
  getSvg,
  booths,
  assignments,
  statusTypes,
  onClose,
}: {
  map: MapDoc;
  getSvg: () => string | null;
  booths: Booth[];
  assignments: Record<string, BoothAssignment>;
  statusTypes: StatusType[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<Fmt | "backup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = safeName(map.title);

  const run = async (fmt: Fmt) => {
    setError(null);
    setBusy(fmt);
    try {
      if (fmt === "csv") {
        const csv = boothsToCsv(booths, assignments, statusTypes);
        // Prepend a UTF-8 BOM so Excel reads non-ASCII (e.g. the m² header, accented
        // exhibitor names) correctly instead of as mojibake.
        downloadBlob(
          new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8" }),
          `${base}.csv`,
        );
      } else {
        const svg = getSvg();
        if (!svg) throw new Error("The floorplan isn’t ready yet.");
        if (fmt === "svg") {
          downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${base}.svg`);
        } else if (fmt === "png") {
          downloadBlob(await svgToPngBlob(svg), `${base}.png`);
        } else if (fmt === "pdf") {
          downloadBlob(await svgToPdfBlob(svg), `${base}.pdf`);
        }
      }
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-1">Download map</h2>
        <p className="text-sm text-[color:var(--color-ink-soft)] mb-5">
          Exports the map exactly as it looks now — exhibitor names and statuses included.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => run(f.id)}
              disabled={busy !== null}
              className="text-left border border-[color:var(--color-line)] rounded-lg p-3 hover:border-[color:var(--color-accent)] hover:bg-[#f8f9fa] transition disabled:opacity-50"
            >
              <div className="text-sm font-medium flex items-center gap-2">
                {f.label}
                {busy === f.id && (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-[color:var(--color-line)] border-t-[color:var(--color-accent)] animate-spin" />
                )}
              </div>
              <div className="text-xs text-[color:var(--color-ink-soft)] mt-1 leading-snug">{f.desc}</div>
            </button>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-[color:var(--color-line)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Full backup</div>
              <div className="text-xs text-[color:var(--color-ink-soft)] mt-0.5 leading-snug">
                Every level, exhibitor and status in one restorable JSON. Also auto-saved
                on the server so the map can be recovered after a failure.
              </div>
            </div>
            <button
              onClick={async () => {
                setError(null);
                setBusy("backup");
                try {
                  await downloadMapBackup(map);
                } catch (e) {
                  setError(String(e instanceof Error ? e.message : e));
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy !== null}
              className="btn btn-ghost shrink-0 disabled:opacity-50"
            >
              {busy === "backup" ? "Preparing…" : "Download backup"}
            </button>
          </div>
        </div>

        {error && <div className="text-xs text-[#c5221f] mt-4">{error}</div>}

        <div className="flex justify-end mt-6">
          <button onClick={onClose} disabled={busy !== null} className="btn btn-ghost">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
