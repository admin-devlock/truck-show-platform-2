"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * Slide-to-confirm control. The user drags the handle to the far end to confirm a
 * destructive action — prevents accidental taps. Styled to match the app (hairlines,
 * rounded-full, one accent — here the destructive red).
 */
const HANDLE = 48;
const PAD = 4;

export function SlideToConfirm({
  onConfirm,
  label = "Slide to confirm",
  busy = false,
  busyLabel = "Working…",
  icon,
}: {
  onConfirm: () => void;
  label?: string;
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode; // handle glyph (defaults to a trash icon)
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const dragging = useRef(false);

  const maxX = () => {
    const t = trackRef.current;
    return t ? t.clientWidth - HANDLE - PAD * 2 : 0;
  };

  const begin = (e: React.PointerEvent) => {
    if (busy || done) return;
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    if (!dragging.current || done) return;
    const t = trackRef.current;
    if (!t) return;
    const rect = t.getBoundingClientRect();
    let nx = e.clientX - rect.left - PAD - HANDLE / 2;
    nx = Math.max(0, Math.min(maxX(), nx));
    setX(nx);
    if (nx >= maxX() - 1) {
      dragging.current = false;
      setDone(true);
      onConfirm();
    }
  };

  const end = () => {
    dragging.current = false;
    if (!done) setX(0);
  };

  const progress = maxX() ? x / maxX() : 0;
  const locked = busy || done;

  return (
    <div
      ref={trackRef}
      className="relative h-14 rounded-full border border-[color:var(--color-line)] bg-[#f8f9fa] overflow-hidden select-none touch-none"
    >
      {/* red fill that grows behind the handle */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: x + HANDLE + PAD,
          background: "rgba(217, 48, 37, 0.12)",
          transition: dragging.current ? "none" : "width 0.2s ease",
        }}
      />
      {/* label */}
      <div
        className="absolute inset-0 flex items-center justify-center gap-1.5 text-sm font-medium pointer-events-none"
        style={{ color: "#c5221f", opacity: locked ? 1 : 1 - progress * 0.9 }}
      >
        {locked ? busyLabel : label}
        {!locked && <span aria-hidden>›››</span>}
      </div>
      {/* handle */}
      <div
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={`absolute top-1 grid place-items-center rounded-full text-white shadow-sm ${
          locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        }`}
        style={{
          left: x + PAD,
          width: HANDLE,
          height: HANDLE,
          background: "#d93025",
          transition: dragging.current ? "none" : "left 0.2s ease",
        }}
      >
        {busy ? (
          <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        ) : done ? (
          <CheckGlyph />
        ) : (
          icon ?? <TrashGlyph />
        )}
      </div>
    </div>
  );
}

function TrashGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
