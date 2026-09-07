"use client";

export const AUDIT_EVENT = "truckshow:audit";

export type AuditMetadata = Record<string, string | number | boolean | null>;
export type AuditEventType = "gesture" | "confirm";

/** Report a meaningful non-click interaction to the global activity logger. */
export function auditAction(
  action: string,
  metadata?: AuditMetadata,
  eventType: AuditEventType = "gesture",
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUDIT_EVENT, {
      detail: { action, metadata, eventType },
    }),
  );
}
