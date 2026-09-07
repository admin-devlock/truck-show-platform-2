"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { auth, db } from "@/lib/firebase";
import { AUDIT_EVENT, type AuditEventType, type AuditMetadata } from "@/lib/activity";

const SESSION_KEY = "truckshow.auditSession";
const MAX_ACTION_LENGTH = 120;

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

function cleanLabel(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim().slice(0, MAX_ACTION_LENGTH);
  return cleaned || null;
}

function elementLabel(element: Element): string | null {
  const explicit = cleanLabel((element as HTMLElement).dataset?.auditAction);
  if (explicit) return explicit;
  const aria = cleanLabel(element.getAttribute("aria-label"));
  if (aria) return aria;
  const title = cleanLabel(element.getAttribute("title"));
  if (title) return title;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const label = cleanLabel(
      [...(element.labels ?? [])].map((item) => item.textContent ?? "").join(" "),
    );
    return label || cleanLabel(element.getAttribute("placeholder")) || element.type || element.tagName.toLowerCase();
  }
  return cleanLabel(element.textContent) || element.tagName.toLowerCase();
}

function controlDescription(element: Element): string {
  if (element instanceof HTMLInputElement) return `input:${element.type}`;
  return element.getAttribute("role") || element.tagName.toLowerCase();
}

function currentMapId(path: string): string | null {
  return path.match(/^\/map\/([^/]+)/)?.[1] ?? null;
}

/** Captures user intent at the UI boundary. It deliberately records labels and context,
 * never input values, search queries, exhibitor names, or uploaded filenames. */
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

    const record = (
      eventType: "page_view" | "click" | "change" | "gesture" | "drop" | "confirm",
      action: string,
      control = "application",
      metadata?: AuditMetadata,
    ) => {
      const actor = identityRef.current;
      const path = pathnameRef.current;
      if (!actor || !auth.currentUser || auth.currentUser.uid !== authUid) return;
      void addDoc(collection(db, "activity"), {
        schemaVersion: 1,
        eventType,
        action: cleanLabel(action) ?? "Unknown action",
        control,
        path,
        mapId: currentMapId(path),
        sessionId: auditSessionId,
        authUid,
        actor: {
          uid: actor.uid,
          name: actor.name,
          isGuest: actor.isGuest,
        },
        metadata: metadata ?? {},
        clientAt: Date.now(),
        createdAt: serverTimestamp(),
      }).catch(() => {
        // Activity logging is best-effort and must never break the user's action.
      });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const semanticControl = target?.closest<HTMLElement>("button, a, [role='button']");
      // Non-semantic action surfaces (for example a modal backdrop) opt in directly.
      // Requiring the actual target prevents clicks inside the modal card being
      // misreported as backdrop dismissals.
      const directControl =
        target instanceof HTMLElement && target.dataset.auditClick === "true" ? target : null;
      const control = semanticControl ?? directControl;
      if (!control || control.dataset.auditIgnore === "true") return;
      if (control instanceof HTMLButtonElement && control.disabled) return;
      const label = elementLabel(control);
      const relatedMapId = target?.closest<HTMLElement>("[data-map-id]")?.dataset.mapId;
      if (label)
        record(
          "click",
          label,
          controlDescription(control),
          relatedMapId ? { relatedMapId } : undefined,
        );
    };

    const onChange = (event: Event) => {
      const control = event.target instanceof Element ? event.target : null;
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
        )
      )
        return;
      if (control.dataset.auditIgnore === "true") return;
      const label = elementLabel(control);
      if (label) record("change", `Change ${label}`, controlDescription(control));
    };

    const onDrop = (event: DragEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLElement>("[data-audit-action], [draggable='true']");
      if (!control) return;
      record("drop", elementLabel(control) ?? "Reorder item", controlDescription(control));
    };

    const onAudit = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          action?: string;
          metadata?: AuditMetadata;
          eventType?: AuditEventType;
        }>
      ).detail;
      if (!detail?.action) return;
      record(detail.eventType ?? "gesture", detail.action, "gesture", detail.metadata);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("drop", onDrop, true);
    window.addEventListener(AUDIT_EVENT, onAudit);
    record("page_view", "View page");

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("drop", onDrop, true);
      window.removeEventListener(AUDIT_EVENT, onAudit);
    };
  }, [identity?.uid, pathname]);

  return null;
}
