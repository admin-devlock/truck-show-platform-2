import type { BoothAssignment, StatusType } from "./maps";

/** Resolve a booth's status for one type. New assignments store one value per type;
 * legacy assignments keep working through their original single statusId. */
export function statusIdForType(
  assignment: BoothAssignment | undefined,
  type: StatusType,
): string | null {
  if (!assignment) return null;
  if (
    assignment.statusIdsByType &&
    Object.prototype.hasOwnProperty.call(assignment.statusIdsByType, type.id)
  ) {
    const statusId = assignment.statusIdsByType[type.id];
    return statusId && type.statuses.some((status) => status.id === statusId) ? statusId : null;
  }
  return assignment.statusId && type.statuses.some((status) => status.id === assignment.statusId)
    ? assignment.statusId
    : null;
}

/** All valid statuses currently assigned to a booth, in status-type order. */
export function assignedStatusIds(
  assignment: BoothAssignment | undefined,
  statusTypes: StatusType[],
): string[] {
  return statusTypes.flatMap((type) => {
    const statusId = statusIdForType(assignment, type);
    return statusId ? [statusId] : [];
  });
}

/** Read the new ordered visibility field, falling back to the old single lens. */
export function activeStatusTypeIds(
  data: { activeStatusTypeIds?: string[]; activeStatusTypeId?: string | null },
  statusTypes: StatusType[],
): string[] {
  const valid = new Set(statusTypes.map((type) => type.id));
  const stored = Array.isArray(data.activeStatusTypeIds)
    ? data.activeStatusTypeIds
    : data.activeStatusTypeId
      ? [data.activeStatusTypeId]
      : [];
  return [...new Set(stored.filter((id) => valid.has(id)))];
}
