import test from "node:test";
import assert from "node:assert/strict";
import { mergeWorkflowStatuses } from "../scripts/merge_workflow_statuses.mjs";
import { statusIdForType } from "../src/lib/statuses.ts";

const offers = { id: "ni6aper", name: "Offers", statuses: [
  { id: "dashboard", name: "Dashboard Access Sent", color: "#0f0f0f" },
] };
const compliance = { id: "sc", name: "Compliance", statuses: [
  { id: "approved", name: "Plan Approved", color: "#1e8e3e" },
] };
const source = assignments => ({ assignments, statusTypes: [compliance, offers],
  activeStatusTypeIds: ["sc", "ni6aper"], activeStatusTypeId: "sc", splits: { existing: "unchanged" } });

test("preserves exact status objects, booth fields, splits and legacy assignments without mutating source", () => {
  const original = source({
    A: { exhibitor: "Company A", labelMode: "dims", statusIdsByType: { ni6aper: "dashboard", sc: null } },
    B: { exhibitor: "Company B", statusIdsByType: { sc: "approved" } },
    C: { statusId: "approved" }, D: { statusId: "dashboard" }, E: {},
  });
  const copy = structuredClone(original);
  const { next, report } = mergeWorkflowStatuses(original);
  assert.deepEqual(original, copy);
  assert.deepEqual(next.statusTypes, [{ ...offers, name: "Status", statuses: [...offers.statuses, ...compliance.statuses] }]);
  assert.deepEqual(next.splits, original.splits);
  assert.deepEqual(next.activeStatusTypeIds, [offers.id]);
  assert.equal(next.activeStatusTypeId, offers.id);
  assert.deepEqual(report.counts, { dashboard: 2, approved: 2 });
  assert.equal(report.withoutStatus, 1);
  for (const [number, assignment] of Object.entries(next.assignments)) {
    assert.equal(Object.hasOwn(assignment.statusIdsByType, "sc"), false);
    assert.equal(assignment.exhibitor, original.assignments[number].exhibitor);
    assert.equal(assignment.labelMode, original.assignments[number].labelMode);
  }
});

test("explicitly cleared legacy statuses remain cleared after categories merge", () => {
  const { next } = mergeWorkflowStatuses(source({ A: { statusId: "approved", statusIdsByType: { sc: null } } }));
  assert.equal(statusIdForType(next.assignments.A, next.statusTypes[0]), null);
});

test("refuses a booth with two active statuses", () => {
  assert.throws(() => mergeWorkflowStatuses(source({ A: { statusIdsByType: { sc: "approved", ni6aper: "dashboard" } } })), /Conflicting statuses/);
});

test("refuses dangling status references and duplicate status IDs", () => {
  assert.throws(() => mergeWorkflowStatuses(source({ A: { statusIdsByType: { sc: "unknown" } } })), /Unknown status/);
  assert.throws(() => mergeWorkflowStatuses(source({ A: { statusId: "unknown" } })), /Unknown legacy/);
  const duplicate = source({});
  duplicate.statusTypes = [offers, { ...compliance, statuses: offers.statuses }];
  assert.throws(() => mergeWorkflowStatuses(duplicate), /Duplicate status IDs/);
});
