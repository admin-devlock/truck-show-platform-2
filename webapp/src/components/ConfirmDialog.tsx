"use client";

import { useState, type ReactNode } from "react";
import { SlideToConfirm } from "./SlideToConfirm";

/**
 * Generalised slide-to-confirm dialog for destructive / lossy actions (deleting,
 * overwriting data). The slide guards against accidents. `onConfirm` does the work and
 * closes the relevant flow on success (and may throw); `onClose` just dismisses this
 * dialog (Cancel / backdrop).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Slide to confirm",
  busyLabel = "Working…",
  icon,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  icon?: ReactNode;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Bumped when onConfirm fails: remounts the slider (via key) so it un-latches from
  // its completed state and the user can retry instead of hitting a dead control.
  const [attempt, setAttempt] = useState(0);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      setBusy(false);
      setAttempt((a) => a + 1);
      alert(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 px-4" onClick={busy ? undefined : onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-1">{title}</h2>
        <div className="text-sm text-[color:var(--color-ink-soft)] mb-5 leading-relaxed">{message}</div>

        <SlideToConfirm key={attempt} onConfirm={run} busy={busy} label={confirmLabel} busyLabel={busyLabel} icon={icon} />

        <div className="flex justify-end mt-5">
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** A warning glyph for overwrite (vs the default trash icon used for deletes). */
export function OverwriteGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
