import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  matchBoothsByPosition,
  findDuplicateBoothNumbers,
  polygonIntersectionArea,
  transferNumberedData,
} from "../src/lib/remap.ts";
import { applyBoothSplits } from "../src/lib/booths.ts";

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

test("an explicit split replaces a matching orphan CAD label with real geometry", () => {
  const raw = [
    {
      number: "189", kind: "built", width_m: 19, depth_m: 18, area_m2: 342,
      irregular: false, centroid: [9.5, 9], polygon: [[0, 0], [19, 0], [19, 18], [0, 18]],
    },
    {
      number: "188", kind: "label_only", width_m: null, depth_m: null, area_m2: null,
      irregular: null, centroid: [5, 9], polygon: null,
    },
  ];
  const effective = applyBoothSplits(raw, {
    "189": {
      parts: [
        { number: "188", polygon: [0, 0, 10, 0, 10, 18, 0, 18], centroid: [5, 9], width_m: 10, depth_m: 18, area_m2: 180 },
        { number: "189", polygon: [10, 0, 19, 0, 19, 18, 10, 18], centroid: [14.5, 9], width_m: 9, depth_m: 18, area_m2: 162 },
      ],
    },
  });
  assert.deepEqual(effective.map(({ number }) => number), ["188", "189"]);
  assert.equal(effective.filter(({ number }) => number === "188").length, 1);
  assert.equal(effective.every(({ polygon }) => polygon?.length === 4), true);
});

test("the production BCEC v11 conversion contains separate 188 and 189 footprints", () => {
  const converted = JSON.parse(readFileSync(
    new URL("../scripts/preconverted/bcec-halls-v11/out.booths.json", import.meta.url),
    "utf8",
  ));
  const pair = converted.booths.filter(({ number }) => number === "188" || number === "189");
  assert.deepEqual(pair.map(({ number }) => number).sort(), ["188", "189"]);
  assert.equal(pair.every(({ polygon }) => polygon?.length === 4), true);
  assert.equal(pair.reduce((sum, booth) => sum + booth.area_m2, 0), 342);
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
