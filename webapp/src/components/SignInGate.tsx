"use client";

import { useState } from "react";
import { useAuth, GUEST_ENABLED } from "@/lib/auth";

/* Full-screen sign-in. Wraps any page that needs an authenticated identity. */
export function SignInGate({ children }: { children: React.ReactNode }) {
  const { identity, loading, signIn, signInAsGuest } = useAuth();
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="h-6 w-6 rounded-full border-2 border-[color:var(--color-line)] border-t-[color:var(--color-accent)] animate-spin" />
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="min-h-screen grid place-items-center bg-[color:var(--color-canvas)] px-6">
        <div className="card max-w-sm w-full p-8 text-center">
          <div className="mx-auto mb-5 h-12 w-12 rounded-lg bg-[color:var(--color-accent-soft)] grid place-items-center">
            <MapGlyph />
          </div>
          <h1 className="text-xl font-medium mb-1">Truck Show Platform</h1>
          <p className="text-sm text-[color:var(--color-ink-soft)] mb-6">
            Collaborative floorplan maps for trade shows.
          </p>
          <button onClick={signIn} className="btn btn-primary w-full justify-center">
            <GoogleGlyph />
            Sign in with Google
          </button>

          {GUEST_ENABLED && (
            <div className="mt-6 pt-5 border-t border-[color:var(--color-line)] text-left">
              <div className="text-xs font-medium text-[color:var(--color-ink-soft)] mb-2">
                Debug · continue as a guest
              </div>
              <div className="flex gap-2">
                <input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Optional name (random if blank)"
                  onKeyDown={(e) => e.key === "Enter" && go()}
                  className="flex-1 min-w-0 border border-[color:var(--color-line)] rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
                />
                <button onClick={go} disabled={busy} className="btn btn-ghost shrink-0">
                  {busy ? "…" : "Enter"}
                </button>
              </div>
              <p className="text-[11px] text-[color:var(--color-ink-soft)] mt-2 leading-relaxed">
                Each browser tab becomes a separate guest — open several tabs to test
                live collaboration.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;

  async function go() {
    setBusy(true);
    try {
      await signInAsGuest(guestName);
    } catch (e) {
      setBusy(false);
      alert("Guest sign-in failed: " + e);
    }
  }
}

function MapGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 36.9 44 31 44 24c0-1.3-.1-2.6-.4-3.5z" />
    </svg>
  );
}
