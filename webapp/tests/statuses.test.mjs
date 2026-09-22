import test from "node:test";
import assert from "node:assert/strict";
import {
  activeStatusTypeIds,
  assignedStatusIds,
  assignedStatuses,
  statusIdForType,
} from "../src/lib/statuses.ts";

const offers = {
  id: "offers",
  name: "Offer status",
  statuses: [{ id: "sent", name: "Sent", color: "#00f" }],
};
const compliance = {
  id: "compliance",
  name: "Compliance",
  statuses: [{ id: "approved", name: "Approved", color: "#0f0" }],
};

test("a booth can resolve one independent status per type", () => {
  const assignment = {
    statusIdsByType: { offers: "sent", compliance: "approved" },
  };
  assert.equal(statusIdForType(assignment, offers), "sent");
  assert.equal(statusIdForType(assignment, compliance), "approved");
  assert.deepEqual(assignedStatusIds(assignment, [offers, compliance]), ["sent", "approved"]);
  assert.deepEqual(assignedStatuses(assignment, [compliance, offers]), [
    {
      typeId: "compliance",
      typeName: "Compliance",
      statusId: "approved",
      statusName: "Approved",
      color: "#0f0",
    },
    {
      typeId: "offers",
      typeName: "Offer status",
      statusId: "sent",
      statusName: "Sent",
      color: "#00f",
    },
  ]);
});

test("legacy single statuses resolve under their owning type", () => {
  const assignment = { statusId: "sent" };
  assert.equal(statusIdForType(assignment, offers), "sent");
  assert.equal(statusIdForType(assignment, compliance), null);
});

test("an explicit null overrides a legacy status for that type", () => {
  const assignment = { statusId: "sent", statusIdsByType: { offers: null } };
  assert.equal(statusIdForType(assignment, offers), null);
});

test("ordered visibility prefers the new field and filters removed types", () => {
  assert.deepEqual(
    activeStatusTypeIds(
      { activeStatusTypeIds: ["compliance", "offers", "removed"] },
      [offers, compliance],
    ),
    ["compliance", "offers"],
  );
  assert.deepEqual(activeStatusTypeIds({ activeStatusTypeId: "offers" }, [offers]), ["offers"]);
  assert.deepEqual(
    activeStatusTypeIds({ activeStatusTypeIds: [], activeStatusTypeId: "offers" }, [offers]),
    [],
  );
});
