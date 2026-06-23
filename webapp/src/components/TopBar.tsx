"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./Avatar";

/* The app's top bar. `center` and `right` slots let pages (e.g. the viewer) inject
   a title or presence avatars while keeping the brand + account menu consistent. */
export function TopBar({
  center,
  right,
  onBrandClick,
}: {
  center?: React.ReactNode;
  right?: React.ReactNode;
  onBrandClick?: () => void;
}) {
  const { identity, user, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <header className="h-16 bg-[color:var(--color-surface)] border-b border-[color:var(--color-line)] flex items-center px-4 gap-4 shrink-0">
      <button
        onClick={onBrandClick}
        className="flex items-center gap-2.5 text-[color:var(--color-ink)] hover:opacity-80"
      >
        <span className="h-8 w-8 rounded-lg bg-[color:var(--color-accent-soft)] grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
            <line x1="9" y1="3" x2="9" y2="18" />
            <line x1="15" y1="6" x2="15" y2="21" />
          </svg>
        </span>
        <span className="text-[17px] font-medium tracking-tight">Truck Show</span>
      </button>

      <div className="flex-1 min-w-0 flex justify-center">{center}</div>

      <div className="flex items-center gap-3">
        {right}
        <div className="relative" ref={ref}>
          <button onClick={() => setMenu((m) => !m)} className="rounded-full hover:ring-2 hover:ring-[color:var(--color-line)] transition">
            <Avatar name={identity?.name ?? "?"} photo={identity?.photo} color={identity?.color} size={32} />
          </button>
          {menu && (
            <div className="absolute right-0 top-11 w-64 card p-1 z-50">
              <div className="px-3 py-2.5 border-b border-[color:var(--color-line)]">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {identity?.name}
                  {identity?.isGuest && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--color-ink-soft)] border border-[color:var(--color-line)] rounded px-1 py-px">
                      Guest
                    </span>
                  )}
                </div>
                <div className="text-xs text-[color:var(--color-ink-soft)] truncate">
                  {identity?.isGuest ? "Temporary test account" : user?.email}
                </div>
              </div>
              <button
                onClick={signOut}
                className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-[#f1f3f4]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
