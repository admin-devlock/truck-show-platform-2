// Position-based booth matching: carry booth data from an old CAD revision to a new
// one by geometry, not booth number. This module is deliberately pure: callers can
// preview the result before creating a new map, and it never writes to Firestore.

export type MatchBooth = {
  number: string | null;
  centroid: [number, number];
  polygon: [number, number][] | null;
};

export type RemapMove = { from: string; to: string };
export type RemapSplit = { from: string; parts: string[]; dataTo: string };
export type RemapMerge = { from: string[]; to: string };
export type RemapIssue = { number: string; reason: string };
export type RemapResult = {
  /** Best old-number -> new-number destination, retained for simple callers. */
  mapping: Record<string, string>;
  /** Every spatial destination for an old booth; a split has more than one. */
  targets: Record<string, string[]>;
  moves: RemapMove[];
  splits: RemapSplit[];
  merges: RemapMerge[];
  unmatched: RemapIssue[];
  unmatchedNew: RemapIssue[];
  alignment: { dx: number; dy: number };
  /** Intersection area for each accepted old/new pair, used for deterministic merges. */
  overlap: Record<string, Record<string, number>>;
  stats: {
    old: number;
    new: number;
    matched: number;
    sameNumber: number;
    renumbered: number;
    split: number;
    merged: number;
  };
};

export function findDuplicateBoothNumbers(booths: MatchBooth[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const booth of booths) {
    if (!booth.number) continue;
    if (seen.has(booth.number)) duplicates.add(booth.number);
    seen.add(booth.number);
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

type Poly = [number, number][];
type BBox = { minx: number; maxx: number; miny: number; maxy: number };

const polyArea = (poly: Poly) => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

const bboxOf = (poly: Poly): BBox => ({
  minx: Math.min(...poly.map(([x]) => x)),
  maxx: Math.max(...poly.map(([x]) => x)),
  miny: Math.min(...poly.map(([, y]) => y)),
  maxy: Math.max(...poly.map(([, y]) => y)),
});

const bboxesOverlap = (a: BBox, b: BBox) =>
  Math.min(a.maxx, b.maxx) > Math.max(a.minx, b.minx) &&
  Math.min(a.maxy, b.maxy) > Math.max(a.miny, b.miny);

/** Y-intervals inside a polygon at a vertical scan line. Booth polygons are simple,
 * mostly rectilinear outlines; sampling between every vertex x also handles concavity
 * (unlike bounding-box overlap, which falsely fills the cut-out of an L-shaped booth). */
function verticalIntervals(poly: Poly, x: number): [number, number][] {
  const ys: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if ((x1 < x && x < x2) || (x2 < x && x < x1)) {
      ys.push(y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
    }
  }
  ys.sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) intervals.push([ys[i], ys[i + 1]]);
  return intervals;
}

function intervalOverlap(a: [number, number][], b: [number, number][]) {
  let total = 0;
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) total += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }
  return total;
}

/** Polygon intersection area without a geometry dependency. Within each strip between
 * vertex x-coordinates, straight polygon edges vary linearly, so midpoint integration
 * is exact for the rectilinear booth outlines emitted by the converter. */
export function polygonIntersectionArea(a: Poly, b: Poly): number {
  const ab = bboxOf(a);
  const bb = bboxOf(b);
  if (!bboxesOverlap(ab, bb)) return 0;
  const minx = Math.max(ab.minx, bb.minx);
  const maxx = Math.min(ab.maxx, bb.maxx);
  const xs = [...new Set([
    minx,
    maxx,
    ...a.map(([x]) => x).filter((x) => minx < x && x < maxx),
    ...b.map(([x]) => x).filter((x) => minx < x && x < maxx),
  ])].sort((x, y) => x - y);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const width = xs[i + 1] - xs[i];
    if (width <= 0) continue;
    const x = (xs[i] + xs[i + 1]) / 2;
    area += width * intervalOverlap(verticalIntervals(a, x), verticalIntervals(b, x));
  }
  return area;
}

const median = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// An overlap is useful when it covers at least half of the smaller outline. This
// recognizes expansions, contractions, splits and merges that IoU alone rejects.
const MIN_SMALLER_COVER = 0.5;

export function matchBoothsByPosition(oldBooths: MatchBooth[], newBooths: MatchBooth[]): RemapResult {
  const olds = oldBooths.filter(
    (booth): booth is MatchBooth & { number: string; polygon: Poly } =>
      !!booth.number && !!booth.polygon && booth.polygon.length >= 3 && polyArea(booth.polygon) > 0,
  );
  const news = newBooths.filter(
    (booth): booth is MatchBooth & { number: string; polygon: Poly } =>
      !!booth.number && !!booth.polygon && booth.polygon.length >= 3 && polyArea(booth.polygon) > 0,
  );
  const result: RemapResult = {
    mapping: {},
    targets: {},
    moves: [],
    splits: [],
    merges: [],
    unmatched: [],
    unmatchedNew: [],
    alignment: { dx: 0, dy: 0 },
    overlap: {},
    stats: {
      old: olds.length,
      new: news.length,
      matched: 0,
      sameNumber: 0,
      renumbered: 0,
      split: 0,
      merged: 0,
    },
  };
  if (!olds.length || !news.length) return result;

  // Converter coordinates normally share the CAD origin. If framing changed between
  // revisions, median nearest-centroid votes recover a global translation without
  // using booth numbers.
  const votes = olds.map((old) => {
    let nearest = news[0];
    let distance = Infinity;
    for (const next of news) {
      const d = (old.centroid[0] - next.centroid[0]) ** 2 + (old.centroid[1] - next.centroid[1]) ** 2;
      if (d < distance) {
        distance = d;
        nearest = next;
      }
    }
    return [nearest.centroid[0] - old.centroid[0], nearest.centroid[1] - old.centroid[1]] as const;
  });
  const dx = median(votes.map(([x]) => x));
  const dy = median(votes.map(([, y]) => y));
  result.alignment = { dx, dy };

  const indexedNew = news.map((booth) => ({
    booth,
    polygon: booth.polygon,
    area: polyArea(booth.polygon),
    bbox: bboxOf(booth.polygon),
  }));
  const destinations = new Map<string, string[]>();

  for (const old of olds) {
    const polygon = old.polygon.map(([x, y]) => [x + dx, y + dy] as [number, number]);
    const area = polyArea(polygon);
    const bbox = bboxOf(polygon);
    const candidates = indexedNew
      .filter((next) => bboxesOverlap(bbox, next.bbox))
      .map((next) => {
        const overlap = polygonIntersectionArea(polygon, next.polygon);
        return {
          number: next.booth.number,
          overlap,
          smallerCover: overlap / Math.min(area, next.area),
        };
      })
      .filter((candidate) => candidate.smallerCover >= MIN_SMALLER_COVER)
      .sort((a, b) => b.overlap - a.overlap);

    if (!candidates.length) {
      result.unmatched.push({ number: old.number, reason: "no sufficiently overlapping booth in the new plan" });
      continue;
    }
    const targets = candidates.map((candidate) => candidate.number);
    result.overlap[old.number] = Object.fromEntries(
      candidates.map((candidate) => [candidate.number, candidate.overlap]),
    );
    result.targets[old.number] = targets;
    result.mapping[old.number] = targets[0];
    result.stats.matched++;
    if (targets.includes(old.number)) result.stats.sameNumber++;
    else result.stats.renumbered++;
    if (targets[0] !== old.number) result.moves.push({ from: old.number, to: targets[0] });
    if (targets.length > 1) {
      result.splits.push({ from: old.number, parts: targets, dataTo: targets[0] });
      result.stats.split++;
    }
    for (const target of targets) {
      const sources = destinations.get(target) ?? [];
      sources.push(old.number);
      destinations.set(target, sources);
    }
  }

  for (const next of news) {
    const sources = destinations.get(next.number) ?? [];
    if (!sources.length) {
      result.unmatchedNew.push({ number: next.number, reason: "no booth at this position in the old plan" });
    } else if (sources.length > 1) {
      result.merges.push({ from: sources, to: next.number });
      result.stats.merged++;
    }
  }
  return result;
}

export type TransferConflict = {
  to: string;
  from: string[];
  chosen: string;
  reason: string;
};

export type TransferResult<T> = {
  data: Record<string, T>;
  conflicts: TransferConflict[];
  sourceWithData: number;
  transferredSources: number;
  populatedDestinations: number;
};

const stableValue = (value: unknown): string => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
    .join(",")}}`;
};

const informationScore = (value: unknown): number => {
  if (value == null || value === "") return 0;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + informationScore(child), 0);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, child) => sum + informationScore(child),
      0,
    );
  }
  return 1;
};

/** Transfer number-keyed data through a geometry match. Data outside the replaced
 * level is preserved. Splits duplicate the source value; merges prefer the most
 * informative source, then greatest overlap, and are always reported when values
 * differ so the user can review the result. */
export function transferNumberedData<T>(
  source: Record<string, T>,
  oldLevelNumbers: Iterable<string>,
  remap: RemapResult,
): TransferResult<T> {
  const oldNumbers = new Set(oldLevelNumbers);
  const data: Record<string, T> = Object.fromEntries(
    Object.entries(source).filter(([number]) => !oldNumbers.has(number)),
  );
  const destinationSources = new Map<string, string[]>();
  for (const [from, targets] of Object.entries(remap.targets)) {
    if (!(from in source)) continue;
    for (const to of targets) {
      const sources = destinationSources.get(to) ?? [];
      sources.push(from);
      destinationSources.set(to, sources);
    }
  }

  const conflicts: TransferConflict[] = [];
  const transferred = new Set<string>();
  for (const [to, from] of destinationSources) {
    const ranked = from
      .map((number) => ({
        number,
        value: source[number],
        information: informationScore(source[number]),
        overlap: remap.overlap[number]?.[to] ?? 0,
      }))
      .sort((a, b) => b.information - a.information || b.overlap - a.overlap || a.number.localeCompare(b.number));
    const chosen = ranked[0];
    const distinct = new Set(ranked.map(({ value }) => stableValue(value)));
    if (distinct.size > 1) {
      conflicts.push({
        to,
        from: ranked.map(({ number }) => number),
        chosen: chosen.number,
        reason: "overlapping old booths contain different data",
      });
    }
    data[to] = chosen.value;
    ranked.forEach(({ number }) => transferred.add(number));
  }

  const sourceWithData = [...oldNumbers].filter((number) => number in source).length;
  return {
    data,
    conflicts,
    sourceWithData,
    transferredSources: transferred.size,
    populatedDestinations: destinationSources.size,
  };
}
