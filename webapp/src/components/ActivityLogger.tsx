"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { auth, db } from "@/lib/firebase";
import { AUDIT_EVENT, type AuditEventType, type AuditMetadata } from "@/lib/activity";
import { getAuditContext } from "@/lib/audit-context";

function currentMapId(path: string): string | null {
  return path.match(/^\/map\/([^/]+)/)?.[1] ?? null;
}

/** Stores deliberately reported, consequential actions. Routine UI interaction such
 * as navigation, searching, scrolling, panning, zooming and opening menus is excluded. */
export function ActivityLogger() {
  const { identity } = useAuth();
  const [loggingFailed, setLoggingFailed] = useState(false);
  const pathname = usePathname();
  const identityRef = useRef(identity);
  const pathnameRef = useRef(pathname);
  identityRef.current = identity;
  pathnameRef.current = pathname;

  useEffect(() => {
    if (!identity || !auth.currentUser) return;
    const authUid = auth.currentUser.uid;
    setLoggingFailed(false);

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
        ...getAuditContext(actor),
        eventType: detail.eventType ?? "mutation",
        action: detail.action.replace(/\s+/g, " ").trim().slice(0, 120),
        path,
        mapId: relatedMapId ?? currentMapId(path),
        metadata: detail.metadata ?? {},
        clientAt: Date.now(),
        createdAt: serverTimestamp(),
      }).catch((error) => {
        console.warn("Activity recording failed", error?.code || "unknown");
        setLoggingFailed(true);
      });
    };

    window.addEventListener(AUDIT_EVENT, onAudit);
    return () => window.removeEventListener(AUDIT_EVENT, onAudit);
  }, [identity?.uid]);

  if (!loggingFailed) return null;
  return <div role="alert" className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 shadow">
    Some activity could not be recorded. Check your connection and refresh. Completed actions have not been undone.
    <button className="ml-2 underline" onClick={() => setLoggingFailed(false)}>Dismiss</button>
  </div>;
}
