"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { auth, db } from "@/lib/firebase";
import { AUDIT_EVENT, type AuditEventType, type AuditMetadata } from "@/lib/activity";

const SESSION_KEY = "truckshow.auditSession";

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function currentMapId(path: string): string | null {
  return path.match(/^\/map\/([^/]+)/)?.[1] ?? null;
}

/** Stores deliberately reported, consequential actions. Routine UI interaction such
 * as navigation, searching, scrolling, panning, zooming and opening menus is excluded. */
export function ActivityLogger() {
  const { identity } = useAuth();
  const pathname = usePathname();
  const identityRef = useRef(identity);
  const pathnameRef = useRef(pathname);
  identityRef.current = identity;
  pathnameRef.current = pathname;

  useEffect(() => {
    if (!identity || !auth.currentUser) return;
    const authUid = auth.currentUser.uid;
    const auditSessionId = sessionId();

    const onAudit = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          action?: string;
          metadata?: AuditMetadata;
          eventType?: AuditEventType;
        }>
      ).detail;
      const actor = identityRef.current;
      if (!detail?.action || !actor || !auth.currentUser || auth.currentUser.uid !== authUid)
        return;
      const path = pathnameRef.current;
      const relatedMapId =
        typeof detail.metadata?.mapId === "string" ? detail.metadata.mapId : null;
      void addDoc(collection(db, "activity"), {
        schemaVersion: 1,
        eventType: detail.eventType ?? "mutation",
        action: detail.action.replace(/\s+/g, " ").trim().slice(0, 120),
        path,
        mapId: relatedMapId ?? currentMapId(path),
        sessionId: auditSessionId,
        authUid,
        actor: {
          uid: actor.uid,
          name: actor.name,
          isGuest: actor.isGuest,
        },
        metadata: detail.metadata ?? {},
        clientAt: Date.now(),
        createdAt: serverTimestamp(),
      }).catch(() => {
        // Audit logging must never make the completed user action fail.
      });
    };

    window.addEventListener(AUDIT_EVENT, onAudit);
    return () => window.removeEventListener(AUDIT_EVENT, onAudit);
  }, [identity?.uid]);

  return null;
}
