export type AuditStorage = Pick<Storage, "getItem" | "setItem">;
const KEY = "truckshow.auditSession.v2";
export const AUDIT_IDLE_MS = 30 * 60 * 1000;

/** A session measures consequential activity, not page views or time spent working. */
export function getAuditSession(storage: AuditStorage, uid: string, now: number, uuid: () => string): string {
  try {
    const old = JSON.parse(storage.getItem(KEY) || "null");
    const reuse = old && old.uid === uid && typeof old.id === "string" &&
      Number.isFinite(old.lastAt) && now >= old.lastAt && now - old.lastAt < AUDIT_IDLE_MS;
    const id = reuse ? old.id : uuid();
    storage.setItem(KEY, JSON.stringify({ id, uid, lastAt: now }));
    return id;
  } catch {
    return uuid();
  }
}
