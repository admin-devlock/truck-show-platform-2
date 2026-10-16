import type { BoothAssignment, StatusType } from "./maps";

export type BoothEdit =
  | { kind: "exhibitor"; boothNumber: string; exhibitor: string }
  | { kind: "status"; boothNumber: string; statusTypeId: string; statusId: string | null };
type Meta = { assignments?: Record<string, BoothAssignment>; statusTypes?: StatusType[] };
type Metadata = Record<string, string | number | boolean | null>;

export function boothSaveErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "permission-denied") return "This change wasn’t saved. Check your access and try again.";
  if (code === "unavailable" || code === "deadline-exceeded") return "This change wasn’t saved. Check your connection and try again.";
  return `Couldn’t save: ${error instanceof Error ? error.message : "Please try again."}`;
}

/** Only the changed leaf is written; unrelated assignments and fields survive. */
export function prepareBoothEdit(meta: Meta, edit: BoothEdit) {
  const current = meta.assignments?.[edit.boothNumber] || {};
  if (edit.kind === "exhibitor") {
    const previousExhibitor = current.exhibitor || "";
    const exhibitor = edit.exhibitor.trim();
    if (previousExhibitor === exhibitor) return null;
    return { action: "Change booth exhibitor", patch: { exhibitor } as Partial<BoothAssignment>,
      metadata: { boothNumber: edit.boothNumber, previousExhibitor, exhibitor } as Metadata };
  }
  const type = meta.statusTypes?.find(t => t.id === edit.statusTypeId);
  if (!type) throw new Error("This status category has changed. Refresh the map before saving.");
  const status = type.statuses.find(s => s.id === edit.statusId);
  if (edit.statusId !== null && !status) throw new Error("This status no longer exists. Refresh the map before saving.");
  const rawPrevious = Object.prototype.hasOwnProperty.call(current.statusIdsByType || {}, type.id)
    ? current.statusIdsByType![type.id] : current.statusId;
  const previous = type.statuses.find(s => s.id === rawPrevious);
  const previousStatusId = previous?.id || null;
  if (previousStatusId === edit.statusId) return null;
  return { action: edit.statusId ? "Set booth status" : "Clear booth status",
    patch: { statusIdsByType: { [type.id]: edit.statusId } } as Partial<BoothAssignment>,
    metadata: { boothNumber: edit.boothNumber, statusTypeId: type.id, statusTypeName: type.name,
      previousStatusId, previousStatusName: previous?.name || null, previousStatusColor: previous?.color || null,
      statusId: edit.statusId, statusName: status?.name || null, statusColor: status?.color || null } as Metadata };
}

// Small adapter surface lets the exact transaction body be tested without touching Firebase.
type TransactionAdapter = {
  read: () => Promise<Meta>;
  writeBooth: (number: string, patch: Partial<BoothAssignment>) => void;
  writeAudit: (action: string, metadata: Metadata) => void;
};
export async function applyAuditedBoothEdit(tx: TransactionAdapter, edit: BoothEdit) {
  const change = prepareBoothEdit(await tx.read(), edit);
  if (!change) return false;
  tx.writeBooth(edit.boothNumber, change.patch);
  tx.writeAudit(change.action, change.metadata);
  return true;
}
