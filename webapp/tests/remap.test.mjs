import assert from "node:assert/strict";
import test from "node:test";
import {
  matchBoothsByPosition,
  findDuplicateBoothNumbers,
  polygonIntersectionArea,
  transferNumberedData,
} from "../src/lib/remap.ts";

const booth = (number, polygon) => ({
  number,
  polygon,
  centroid: [
    polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length,
    polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length,
  ],
});

test("intersection respects the empty corner of an L-shaped booth", () => {
  const lShape = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
  const insideCutout = [[2, 2], [3, 2], [3, 3], [2, 3]];
  assert.equal(polygonIntersectionArea(lShape, insideCutout), 0);
});

test("duplicate booth numbers are reported once in natural order", () => {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.deepEqual(
    findDuplicateBoothNumbers([
      booth("10", square), booth("2", square), booth("10", square),
      booth("2", square), booth("2", square), booth("A", square),
    ]),
    ["2", "10"],
  );
});

test("matching identifies splits and merges without using booth numbers", () => {
  const oldBooths = [
    booth("old-wide", [[0, 0], [4, 0], [4, 2], [0, 2]]),
    booth("old-a", [[10, 0], [12, 0], [12, 2], [10, 2]]),
    booth("old-b", [[12, 0], [14, 0], [14, 2], [12, 2]]),
  ];
  const newBooths = [
    booth("new-left", [[0, 0], [2, 0], [2, 2], [0, 2]]),
    booth("new-right", [[2, 0], [4, 0], [4, 2], [2, 2]]),
    booth("new-merged", [[10, 0], [14, 0], [14, 2], [10, 2]]),
  ];
  const result = matchBoothsByPosition(oldBooths, newBooths);
  assert.deepEqual(result.targets["old-wide"], ["new-left", "new-right"]);
  assert.deepEqual(result.merges, [{ from: ["old-a", "old-b"], to: "new-merged" }]);
});

test("data duplicates across splits and reports differing merge data", () => {
  const oldBooths = [
    booth("split", [[0, 0], [4, 0], [4, 2], [0, 2]]),
    booth("a", [[10, 0], [12, 0], [12, 2], [10, 2]]),
    booth("b", [[12, 0], [14, 0], [14, 2], [12, 2]]),
  ];
  const newBooths = [
    booth("left", [[0, 0], [2, 0], [2, 2], [0, 2]]),
    booth("right", [[2, 0], [4, 0], [4, 2], [2, 2]]),
    booth("merged", [[10, 0], [14, 0], [14, 2], [10, 2]]),
  ];
  const match = matchBoothsByPosition(oldBooths, newBooths);
  const transferred = transferNumberedData(
    {
      split: { exhibitor: "Split Co" },
      a: { statusId: "pending" },
      b: { exhibitor: "More complete", statusId: "sold" },
      elsewhere: { exhibitor: "Keep me" },
    },
    ["split", "a", "b"],
    match,
  );
  assert.deepEqual(transferred.data.left, { exhibitor: "Split Co" });
  assert.deepEqual(transferred.data.right, { exhibitor: "Split Co" });
  assert.deepEqual(transferred.data.merged, { exhibitor: "More complete", statusId: "sold" });
  assert.deepEqual(transferred.data.elsewhere, { exhibitor: "Keep me" });
  assert.equal(transferred.conflicts.length, 1);
  assert.equal(transferred.conflicts[0].chosen, "b");
});
