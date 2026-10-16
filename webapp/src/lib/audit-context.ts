"use client";

import { auth } from "./firebase";
import { getAuditSession } from "./audit-session";
import type { Identity } from "./auth";

/** Capture once per user operation, outside transaction retries. */
export function getAuditContext(identity?: Identity) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again before saving.");
  let actor = { uid: user.uid, name: user.displayName || "Anonymous", isGuest: user.isAnonymous };
  if (identity) actor = { uid: identity.uid, name: identity.name, isGuest: identity.isGuest };
  else if (typeof window !== "undefined") {
    try {
      const guest = JSON.parse(sessionStorage.getItem("ts_guest") || "null");
      if (guest?.isGuest && typeof guest.uid === "string" && typeof guest.name === "string") {
        actor = { uid: guest.uid, name: guest.name, isGuest: true };
      }
    } catch { /* Use the authenticated identity if storage is unavailable. */ }
  }
  const clientAt = Date.now();
  let sessionId: string;
  try { sessionId = getAuditSession(sessionStorage, user.uid, clientAt, () => crypto.randomUUID()); }
  catch { sessionId = crypto.randomUUID(); }
  return { schemaVersion: 2, authUid: user.uid, actor, sessionId, clientAt,
    path: typeof window === "undefined" ? "" : window.location.pathname };
}
