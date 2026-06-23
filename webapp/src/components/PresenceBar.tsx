"use client";

import type { Presence } from "@/lib/presence";
import { Avatar } from "./Avatar";

/* Overlapping avatar stack of who else is viewing this map right now. */
export function PresenceBar({ others }: { others: Presence[] }) {
  if (others.length === 0) return null;
  const shown = others.slice(0, 4);
  const extra = others.length - shown.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <div key={p.uid} title={`${p.name} (here now)`}>
            <Avatar name={p.name} photo={p.photo} color={p.color} size={30} ring />
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-xs text-[color:var(--color-ink-soft)]">+{extra}</span>
      )}
    </div>
  );
}
