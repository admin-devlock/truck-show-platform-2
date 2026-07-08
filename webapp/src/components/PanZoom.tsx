"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BoothAssignment, StatusType } from "@/lib/maps";

/**
 * Unlimited pan/zoom viewer for an inline SVG.
 *
 * Camera is driven by the SVG's `viewBox` (not a CSS transform on a giant element —
 * that allocates enormous GPU layers for large floorplans and paints blank). The svg
 * element stays container-sized; we move/scale the viewBox window over the drawing.
 * Strokes use `vector-effect: non-scaling-stroke`, so lines stay a crisp constant
 * width at any zoom. Wheel zooms toward the cursor; drag pans. Effectively unlimited.
 */
const MIN_W_FACTOR = 0.0005; // smallest viewBox width as a fraction of the drawing (max zoom-in)
const MAX_W_FACTOR = 4; // largest (max zoom-out) — beyond this the drawing is a tiny speck
const EDGE_KEEP = 0.2; // keep ≥20% of the drawing (or viewport, whichever is smaller) on-screen

type World = { W: number; H: number };
type Cam = { x: number; y: number; w: number; h: number };

export type Booth = {
  number: string | null;
  kind: string;
  width_m: number | null;
  depth_m: number | null;
  area_m2: number | null;
  irregular: boolean | null;
  centroid: [number, number];
  polygon: [number, number][] | null;
  splitSource?: string | null; // set on the two halves produced by an in-app split
};

const TAP_PX = 5; // pointer movement under this = a click (select), over it = a pan

export type RemoteCursor = { uid: string; name: string; color: string; x: number; y: number };

// Crisp, zoom-independent stroke weights (booths emphasised over the venue).
const STROKE_CSS = `
  .pz-svg :is(line,polyline,path,circle,rect) { vector-effect: non-scaling-stroke; stroke-width: 0.9px; }
  .pz-svg .venue :is(line,polyline,path) { stroke-width: 0.8px; }
  .pz-svg .stand :is(line,polyline,path) { stroke-width: 0.7px; }
  .pz-svg .booth :is(line,polyline,path) { stroke-width: 1.4px; }
  .pz-svg .booth-hit polygon { fill: transparent; stroke: none; cursor: pointer; }
  .pz-svg .booth-hit polygon:hover { fill: rgba(26, 86, 219, 0.10); }
  .pz-svg .booth-hit polygon[data-selected="true"] {
    fill: rgba(26, 86, 219, 0.18);
    stroke: #1a56db; vector-effect: non-scaling-stroke; stroke-width: 1.5px;
  }
  .pz-svg .booth-hit polygon[data-match="true"] {
    fill: rgba(249, 171, 0, 0.20);
    stroke: #e37400; vector-effect: non-scaling-stroke; stroke-width: 2px;
  }
  .pz-svg .booth-hit polygon[data-match="true"][data-selected="true"] {
    fill: rgba(26, 86, 219, 0.22);
    stroke: #1a56db; stroke-width: 2px;
  }
  .pz-svg .booth-status polygon { stroke: none; fill-opacity: 0.32; }
  .pz-svg .booth-labels { pointer-events: none; }
  /* When we render our own dynamic labels, hide the ones baked into the drawing. */
  .pz-svg.has-overlay .labels { display: none; }
`;

const CW = 0.62; // approx glyph width / font size, for fitting text into booths

// Booth-label sizing. A label is a block of one primary line plus up to two smaller
// lines (booth number above, metric below). It grows to nearly fill its booth —
// bounded by booth width, booth height, and a real-world cap (MAX_LABEL_M) so the text
// plateaus and stays a small part of a big booth while filling a small one.
// Booth-label sizing. Every line (booth number / exhibitor / metric) is sized
// INDEPENDENTLY: its own width fit plus a real-world cap — so a short booth number
// stays big even when a long exhibitor name has to shrink to fit a narrow booth.
// The whole block is then scaled down together only if it overflows the booth height.
const LABEL_W_FILL = 0.9; // fraction of booth width one line may span
const LABEL_H_FILL = 0.86; // fraction of booth height the whole block may span
const SUB_CAP = 0.85; // sub lines' real-world cap relative to the primary's cap
const GAP_RATIO = 0.16; // gap between lines, relative to the block's biggest line
const MAX_LABEL_M = 2.2; // cap a primary line at ~2.2 m of drawing units (the "limit")
const MIN_LABEL_M = 0.18; // drop lines that would be smaller than this (illegible)
// Multi-word names may wrap onto up to MAX_NAME_ROWS rows when that makes the font
// meaningfully bigger (≥ WRAP_GAIN×) — a long name in a narrow booth stacks instead
// of shrinking. Rows of one wrapped name sit closer together than separate lines.
const MAX_NAME_ROWS = 3;
const WRAP_GAIN = 1.2;
const ROW_GAP_RATIO = 0.1;

/** Split `words` into `k` rows (order kept) minimising the longest row. Tiny inputs —
 *  exhaustive recursion is fine. */
function balancedSplit(words: string[], k: number): string[] {
  let best: string[] = [words.join(" ")];
  let bestMax = Infinity;
  const rec = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const rows = [...acc, words.slice(start).join(" ")];
      const m = Math.max(...rows.map((r) => r.length));
      if (m < bestMax) {
        bestMax = m;
        best = rows;
      }
      return;
    }
    for (let end = start + 1; end <= words.length - (left - 1); end++) {
      rec(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
    }
  };
  rec(0, k, []);
  return best;
}

/** Best row split for a name: wrap onto more rows only while each step grows the
 *  achievable font by ≥ WRAP_GAIN (capped fonts never "gain", so wide booths where the
 *  name already hits the real-world cap stay on one line). */
function bestNameRows(name: string, bw: number, unitsPerM: number): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const fontFor = (longest: number) => {
    let f = (bw * LABEL_W_FILL) / (Math.max(longest, 1) * CW);
    if (unitsPerM > 0) f = Math.min(f, MAX_LABEL_M * unitsPerM);
    return f;
  };
  let rows = [name];
  let font = fontFor(name.length);
  for (let k = 2; k <= Math.min(MAX_NAME_ROWS, words.length); k++) {
    const candidate = balancedSplit(words, k);
    const f = fontFor(Math.max(...candidate.map((r) => r.length)));
    if (f >= font * WRAP_GAIN) {
      rows = candidate;
      font = f;
    } else break;
  }
  return rows;
}

/** Imperative handle so search (and other UI) can drive the camera to a booth. */
export type PanZoomHandle = {
  focusBooth: (index: number) => void;
  frameBooths: (indices: number[]) => void;
  fit: () => void;
  /** Serialize the floorplan exactly as drawn (names + status fills) to a standalone
   *  full-extent SVG string — the basis for SVG/PNG/PDF export. */
  getExportSvg: () => string | null;
};

export const PanZoom = forwardRef<PanZoomHandle, {
  svgUrl?: string;
  svg?: string;
  booths?: Booth[];
  selected?: number | null;
  onSelect?: (i: number | null) => void;
  assignments?: Record<string, BoothAssignment>;
  statusTypes?: StatusType[];
  activeStatusTypeId?: string | null;
  highlight?: Set<number> | null;
  cursors?: RemoteCursor[];
  onCursorMove?: (wx: number, wy: number) => void;
}>(function PanZoom({
  svgUrl,
  svg: svgProp,
  booths,
  selected,
  onSelect,
  assignments,
  statusTypes,
  activeStatusTypeId,
  highlight,
  cursors,
  onCursorMove,
}, ref) {
  // statusId -> colour, across all status types
  const statusColor = useMemo(() => {
    const m = new Map<string, string>();
    (statusTypes ?? []).forEach((t) => t.statuses.forEach((s) => m.set(s.id, s.color)));
    return m;
  }, [statusTypes]);
  // Status colours are shown only for the SELECTED status type (one at a time). With
  // none selected, no status colours are drawn.
  const activeStatusIds = useMemo(() => {
    if (!activeStatusTypeId) return null;
    const t = (statusTypes ?? []).find((t) => t.id === activeStatusTypeId);
    return t ? new Set(t.statuses.map((s) => s.id)) : new Set<string>();
  }, [statusTypes, activeStatusTypeId]);
  const hostRef = useRef<HTMLDivElement>(null); // holds the injected <svg>
  const containerRef = useRef<HTMLDivElement>(null);
  const svgElRef = useRef<SVGSVGElement | null>(null);
  const cursorLayerRef = useRef<HTMLDivElement>(null); // holds remote-cursor DOM nodes

  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<Cam | null>(null);
  const fitWRef = useRef<number>(1);
  const [zoomPct, setZoomPct] = useState(100);
  const drag = useRef<{
    px: number;
    py: number;
    camx: number;
    camy: number;
    target: EventTarget | null;
    moved: boolean;
  } | null>(null);

  // Inject the SVG (from an inline string or by fetching a URL); read its intrinsic
  // size from the viewBox.
  useEffect(() => {
    let alive = true;
    setError(null);
    setWorld(null);

    const inject = (text: string) => {
      if (!alive || !hostRef.current) return;
      hostRef.current.innerHTML = text;
      const svg = hostRef.current.querySelector("svg") as SVGSVGElement | null;
      if (!svg) {
        setError("no <svg>");
        return;
      }
      const vb = (svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
      const W = vb.length === 4 ? vb[2] : 1000;
      const H = vb.length === 4 ? vb[3] : 1000;
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.display = "block";
      svgElRef.current = svg;
      setWorld({ W, H });
    };

    if (svgProp) {
      inject(svgProp);
    } else if (svgUrl) {
      fetch(svgUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then(inject)
        .catch((e) => alive && setError(String(e)));
    }
    return () => {
      alive = false;
    };
  }, [svgUrl, svgProp]);

  const positionCursors = useCallback(() => {
    const layer = cursorLayerRef.current;
    const el = containerRef.current;
    const cam = camRef.current;
    if (!layer || !el || !cam) return;
    const cw = el.clientWidth || 1;
    const ch = el.clientHeight || 1;
    layer.childNodes.forEach((node) => {
      const c = node as HTMLElement;
      const wx = Number(c.dataset.wx);
      const wy = Number(c.dataset.wy);
      const sx = ((wx - cam.x) / cam.w) * cw;
      const sy = ((wy - cam.y) / cam.h) * ch;
      c.style.transform = `translate(${sx}px, ${sy}px)`;
      c.style.display = sx < -40 || sy < -40 || sx > cw + 40 || sy > ch + 40 ? "none" : "block";
    });
  }, []);

  const apply = useCallback(() => {
    const svg = svgElRef.current;
    const cam = camRef.current;
    if (!svg || !cam) return;
    if (world) {
      // Clamp the pan so the drawing can never be scrolled entirely out of view: always
      // keep at least EDGE_KEEP of it (or of the viewport, whichever is smaller) on-screen.
      const keepX = Math.min(cam.w, world.W) * EDGE_KEEP;
      const keepY = Math.min(cam.h, world.H) * EDGE_KEEP;
      cam.x = Math.min(world.W - keepX, Math.max(keepX - cam.w, cam.x));
      cam.y = Math.min(world.H - keepY, Math.max(keepY - cam.h, cam.y));
    }
    svg.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    setZoomPct(Math.round((fitWRef.current / cam.w) * 100));
    positionCursors();
  }, [world, positionCursors]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !world) return;
    const cw = el.clientWidth || 1;
    const ch = el.clientHeight || 1;
    const cAspect = cw / ch;
    const wAspect = world.W / world.H;
    const pad = 1.06;
    let w: number, h: number;
    if (wAspect > cAspect) {
      w = world.W * pad;
      h = w / cAspect;
    } else {
      h = world.H * pad;
      w = h * cAspect;
    }
    camRef.current = { x: world.W / 2 - w / 2, y: world.H / 2 - h / 2, w, h };
    fitWRef.current = w;
    apply();
  }, [world, apply]);

  // Fit when the drawing first loads.
  useEffect(() => {
    if (world) fit();
  }, [world, fit]);

  // Build a transparent, clickable polygon over each booth, inside the same SVG so it
  // pans/zooms with the drawing. Rebuilt when the drawing or booth set changes.
  useEffect(() => {
    const svg = svgElRef.current;
    if (!svg || !world) return;
    svg.querySelector(".booth-hit")?.remove();
    if (!booths?.length) return;
    const NS = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "booth-hit");
    booths.forEach((b, i) => {
      if (!b.polygon?.length) return;
      const poly = document.createElementNS(NS, "polygon");
      poly.setAttribute("points", b.polygon.map((p) => p.join(",")).join(" "));
      poly.setAttribute("data-bi", String(i));
      g.appendChild(poly);
    });
    svg.appendChild(g);
  }, [world, booths]);

  // Status colour fills + dynamic labels (booth number, or exhibitor name once assigned),
  // sized to fit each booth. Rebuilt live whenever booths/assignments/statuses change.
  useEffect(() => {
    const svg = svgElRef.current;
    if (!svg || !world) return;
    svg.querySelector(".booth-status")?.remove();
    svg.querySelector(".booth-labels")?.remove();
    if (!booths?.length) {
      svg.parentElement?.classList?.remove("has-overlay");
      return;
    }
    const NS = "http://www.w3.org/2000/svg";
    const host = hostRef.current;
    host?.classList.add("has-overlay"); // hide the baked labels; we render our own

    const statusG = document.createElementNS(NS, "g");
    statusG.setAttribute("class", "booth-status");
    const labelG = document.createElementNS(NS, "g");
    labelG.setAttribute("class", "booth-labels");
    labelG.setAttribute("text-anchor", "middle");
    labelG.setAttribute("font-family", "Helvetica,Arial,sans-serif");

    const txt = (x: number, y: number, size: number, fill: string, s: string, weight?: string) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x.toFixed(1));
      t.setAttribute("y", y.toFixed(1));
      t.setAttribute("font-size", size.toFixed(0));
      t.setAttribute("fill", fill);
      t.setAttribute("dominant-baseline", "central");
      if (weight) t.setAttribute("font-weight", weight);
      t.textContent = s;
      return t;
    };

    booths.forEach((b) => {
      if (!b.polygon?.length) return;
      const xs = b.polygon.map((p) => p[0]);
      const ys = b.polygon.map((p) => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs);
      const bh = Math.max(...ys) - Math.min(...ys);
      const [cx, cy] = b.centroid;
      const a = b.number ? assignments?.[b.number] : undefined;

      // status fill — only for the selected status type (none selected = no fills)
      const col =
        a?.statusId && activeStatusIds?.has(a.statusId) ? statusColor.get(a.statusId) : undefined;
      if (col) {
        const poly = document.createElementNS(NS, "polygon");
        poly.setAttribute("points", b.polygon.map((p) => p.join(",")).join(" "));
        poly.setAttribute("fill", col);
        statusG.appendChild(poly);
      }

      // label — grows to nearly fill the booth, capped at a real-world max.
      // Scale (drawing units per metre) from AREA, so it's the same for every booth
      // regardless of orientation/aspect (bbox_width / width_m breaks on tall booths).
      let polyAreaU = 0;
      for (let i = 0; i < b.polygon.length; i++) {
        const [x1, y1] = b.polygon[i];
        const [x2, y2] = b.polygon[(i + 1) % b.polygon.length];
        polyAreaU += x1 * y2 - x2 * y1;
      }
      polyAreaU = Math.abs(polyAreaU) / 2;
      const unitsPerM =
        b.area_m2 && polyAreaU ? Math.sqrt(polyAreaU / b.area_m2) : b.width_m ? bw / b.width_m : 0;
      const minFont = unitsPerM > 0 ? MIN_LABEL_M * unitsPerM : 120;
      const exhibitor = a?.exhibitor?.trim();
      // The small metric line: the booth's area (default) or its dimensions —
      // a per-booth choice synced via the assignment. Falls back to whichever
      // representation the booth actually has.
      const dims =
        b.width_m != null && b.depth_m != null ? `${round1(b.width_m)} × ${round1(b.depth_m)}` : "";
      const areaTxt = b.area_m2 != null ? `${round1(b.area_m2)} m²` : "";
      const metric = a?.labelMode === "dims" ? dims || areaTxt : areaTxt || dims;
      // Build the line list (top to bottom), then size each line independently:
      // own width fit + real-world cap. A long name shrinking to fit a narrow booth
      // no longer drags the (short) number and metric down with it. A line can span
      // several ROWS (a wrapped multi-word name) sharing one font.
      type LabelLine = { rows: string[]; cap: number; fill: string; weight?: string; min: number };
      const lines: LabelLine[] = [];
      if (exhibitor) {
        if (b.number)
          lines.push({ rows: [b.number], cap: SUB_CAP, fill: "#202124", weight: "600", min: minFont * 0.7 });
        lines.push({
          rows: bestNameRows(exhibitor, bw, unitsPerM),
          cap: 1,
          fill: "#202124",
          weight: "600",
          min: minFont,
        });
        if (metric) lines.push({ rows: [metric], cap: SUB_CAP, fill: "#202124", min: minFont * 0.7 });
      } else if (b.number) {
        lines.push({ rows: [b.number], cap: 1, fill: "#0f3d8a", weight: "600", min: minFont });
        if (metric) lines.push({ rows: [metric], cap: SUB_CAP, fill: "#202124", min: minFont * 0.7 });
      }
      if (!lines.length) return;

      const fontFor = (L: LabelLine) => {
        const longest = Math.max(...L.rows.map((r) => r.length), 1);
        let f = (bw * LABEL_W_FILL) / (longest * CW);
        if (unitsPerM > 0) f = Math.min(f, MAX_LABEL_M * unitsPerM * L.cap);
        return f;
      };
      const heightOf = (L: LabelLine, f: number) =>
        L.rows.length * f + (L.rows.length - 1) * ROW_GAP_RATIO * f;
      // Scale the block to the height budget; drop lines that end up illegible and
      // refit (freed height goes back to the survivors). ≤3 lines → ≤3 passes.
      let kept = lines;
      let fonts: number[] = [];
      let gap = 0;
      for (let pass = 0; pass < 3; pass++) {
        const raw = kept.map(fontFor);
        const g0 = GAP_RATIO * Math.max(...raw);
        const total =
          kept.reduce((s, L, i) => s + heightOf(L, raw[i]), 0) + g0 * (kept.length - 1);
        const scale = Math.min(1, (bh * LABEL_H_FILL) / total);
        fonts = raw.map((f) => f * scale);
        gap = g0 * scale;
        const survivors = kept.filter((L, i) => fonts[i] >= L.min);
        if (!survivors.length) return; // nothing legible fits this booth
        if (survivors.length === kept.length) break;
        kept = survivors;
      }
      const block =
        kept.reduce((s, L, i) => s + heightOf(L, fonts[i]), 0) + gap * (kept.length - 1);
      let y = cy - block / 2;
      kept.forEach((L, i) => {
        const f = fonts[i];
        for (const row of L.rows) {
          labelG.appendChild(txt(cx, y + f / 2, f, L.fill, row, L.weight));
          y += f + ROW_GAP_RATIO * f;
        }
        y += gap - ROW_GAP_RATIO * f; // swap the row gap after the last row for the line gap
      });
    });

    svg.insertBefore(statusG, svg.firstChild); // fills under the line work
    svg.appendChild(labelG); // labels on top
  }, [world, booths, assignments, statusColor, activeStatusIds]);

  // Reflect the selected booth onto the hit layer.
  useEffect(() => {
    const svg = svgElRef.current;
    if (!svg) return;
    svg
      .querySelectorAll('.booth-hit polygon[data-selected="true"]')
      .forEach((p) => p.removeAttribute("data-selected"));
    if (selected != null) {
      svg.querySelector(`.booth-hit polygon[data-bi="${selected}"]`)?.setAttribute("data-selected", "true");
    }
  }, [selected, world, booths]);

  // Reflect the search-match set onto the hit layer (a coloured ring per match).
  useEffect(() => {
    const svg = svgElRef.current;
    if (!svg) return;
    svg
      .querySelectorAll('.booth-hit polygon[data-match="true"]')
      .forEach((p) => p.removeAttribute("data-match"));
    highlight?.forEach((i) =>
      svg.querySelector(`.booth-hit polygon[data-bi="${i}"]`)?.setAttribute("data-match", "true"),
    );
  }, [highlight, world, booths]);

  // Remote collaborator cursors: reconcile DOM nodes by uid, then position them.
  useEffect(() => {
    const layer = cursorLayerRef.current;
    if (!layer) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const seen = new Set<string>();
    (cursors ?? []).forEach((c) => {
      seen.add(c.uid);
      let node = layer.querySelector<HTMLElement>(`[data-uid="${c.uid}"]`);
      if (!node) {
        node = document.createElement("div");
        node.dataset.uid = c.uid;
        node.style.cssText =
          "position:absolute;top:0;left:0;pointer-events:none;will-change:transform;transition:transform 100ms linear;z-index:30;";
        node.innerHTML =
          `<svg width="20" height="20" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))">` +
          `<path d="M4 2l6 16 2.6-6.8L19 8.6z" fill="${c.color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>` +
          `<span style="position:absolute;left:16px;top:14px;white-space:nowrap;font:600 11px/1.4 Inter,system-ui,sans-serif;` +
          `color:#fff;background:${c.color};padding:1px 6px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.25)">${esc(c.name)}</span>`;
        layer.appendChild(node);
      }
      node.dataset.wx = String(c.x);
      node.dataset.wy = String(c.y);
    });
    layer.querySelectorAll<HTMLElement>("[data-uid]").forEach((n) => {
      if (!seen.has(n.dataset.uid!)) n.remove();
    });
    positionCursors();
  }, [cursors, positionCursors]);

  // Drive the camera to a booth (used by search results). Zooms so the booth fills a
  // comfortable fraction of the view, keeping some surrounding context.
  const focusBooth = useCallback(
    (index: number) => {
      const b = booths?.[index];
      const el = containerRef.current;
      if (!el || !world) return;
      const cAspect = (el.clientWidth || 1) / (el.clientHeight || 1);
      let cx: number, cy: number, bw: number, bh: number;
      if (b?.polygon?.length) {
        const xs = b.polygon.map((p) => p[0]);
        const ys = b.polygon.map((p) => p[1]);
        const minx = Math.min(...xs), maxx = Math.max(...xs);
        const miny = Math.min(...ys), maxy = Math.max(...ys);
        cx = (minx + maxx) / 2;
        cy = (miny + maxy) / 2;
        bw = Math.max(maxx - minx, 1);
        bh = Math.max(maxy - miny, 1);
      } else if (b?.centroid) {
        [cx, cy] = b.centroid;
        bw = world.W * 0.02;
        bh = world.H * 0.02;
      } else {
        return;
      }
      const pad = 6; // booth occupies ~1/6 of the view
      let w = bw * pad;
      let h = bh * pad;
      if (w / h > cAspect) h = w / cAspect;
      else w = h * cAspect;
      const minW = world.W * MIN_W_FACTOR;
      const maxW = world.W * MAX_W_FACTOR;
      w = Math.min(maxW, Math.max(minW, w));
      h = w / cAspect;
      camRef.current = { x: cx - w / 2, y: cy - h / 2, w, h };
      apply();
    },
    [booths, world, apply],
  );

  // Frame a set of booths so they all fit in view (used by search "map view").
  const frameBooths = useCallback(
    (indices: number[]) => {
      const el = containerRef.current;
      if (!el || !world || !booths) return;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      let any = false;
      indices.forEach((i) => {
        const pts = booths[i]?.polygon ?? (booths[i]?.centroid ? [booths[i].centroid] : null);
        pts?.forEach(([x, y]) => {
          any = true;
          if (x < minx) minx = x;
          if (y < miny) miny = y;
          if (x > maxx) maxx = x;
          if (y > maxy) maxy = y;
        });
      });
      if (!any) return;
      const cAspect = (el.clientWidth || 1) / (el.clientHeight || 1);
      const cx = (minx + maxx) / 2;
      const cy = (miny + maxy) / 2;
      const pad = 1.4;
      let w = Math.max(maxx - minx, world.W * 0.01) * pad;
      let h = Math.max(maxy - miny, world.H * 0.01) * pad;
      if (w / h > cAspect) h = w / cAspect;
      else w = h * cAspect;
      const minW = world.W * MIN_W_FACTOR;
      const maxW = world.W * MAX_W_FACTOR;
      w = Math.min(maxW, Math.max(minW, w));
      h = w / cAspect;
      camRef.current = { x: cx - w / 2, y: cy - h / 2, w, h };
      apply();
    },
    [booths, world, apply],
  );

  // Build a standalone, full-extent SVG snapshot of the drawing as currently depicted
  // (exhibitor names + status fills baked in). Stroke widths are written in user units
  // (scaled to the drawing) so the export is legible without the live non-scaling JS.
  const getExportSvg = useCallback(() => {
    const svg = svgElRef.current;
    if (!svg || !world) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelector(".booth-hit")?.remove(); // interactive layer — not needed
    clone.removeAttribute("style");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `0 0 ${world.W} ${world.H}`);
    clone.setAttribute("width", String(Math.round(world.W)));
    clone.setAttribute("height", String(Math.round(world.H)));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const u = Math.max(world.W, world.H) / 2500; // base stroke in user units
    const hasOverlay = !!clone.querySelector(".booth-labels");
    const css = `
      :is(line,polyline,path,circle,rect){stroke-width:${(u).toFixed(1)}px;}
      .venue :is(line,polyline,path){stroke-width:${(u * 0.9).toFixed(1)}px;}
      .stand :is(line,polyline,path){stroke-width:${(u * 0.8).toFixed(1)}px;}
      .booth :is(line,polyline,path){stroke-width:${(u * 1.6).toFixed(1)}px;}
      .booth-status polygon{stroke:none;fill-opacity:0.32;}
      ${hasOverlay ? ".labels{display:none;}" : ""}
    `;
    const NS = "http://www.w3.org/2000/svg";
    const style = document.createElementNS(NS, "style");
    style.textContent = css;
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(Math.round(world.W)));
    bg.setAttribute("height", String(Math.round(world.H)));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    clone.insertBefore(style, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }, [world]);

  useImperativeHandle(ref, () => ({ focusBooth, frameBooths, fit, getExportSvg }), [
    focusBooth,
    frameBooths,
    fit,
    getExportSvg,
  ]);

  // Keep aspect on container resize (preserve centre + zoom level).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cam = camRef.current;
      if (!cam) return;
      const cAspect = (el.clientWidth || 1) / (el.clientHeight || 1);
      const cx = cam.x + cam.w / 2;
      const cy = cam.y + cam.h / 2;
      const h = cam.w / cAspect;
      camRef.current = { x: cx - cam.w / 2, y: cy - h / 2, w: cam.w, h };
      apply();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const el = containerRef.current;
      const cam = camRef.current;
      if (!el || !cam || !world) return;
      const cw = el.clientWidth || 1;
      const ch = el.clientHeight || 1;
      const minW = world.W * MIN_W_FACTOR;
      const maxW = world.W * MAX_W_FACTOR;
      let nw = cam.w / factor;
      nw = Math.min(maxW, Math.max(minW, nw));
      const nh = nw * (cam.h / cam.w);
      // world point under the cursor, kept fixed
      const wx = cam.x + (px / cw) * cam.w;
      const wy = cam.y + (py / ch) * cam.h;
      camRef.current = { x: wx - (px / cw) * nw, y: wy - (py / ch) * nh, w: nw, h: nh };
      apply();
    },
    [world, apply],
  );

  // Non-passive wheel listener so we can preventDefault (block page scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    const cam = camRef.current;
    if (!cam) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      camx: cam.x,
      camy: cam.y,
      target: e.target,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = containerRef.current;
    const cam = camRef.current;
    if (!el || !cam) return;
    // Broadcast our cursor (world coords) on every move, dragging or not.
    if (onCursorMove) {
      const rect = el.getBoundingClientRect();
      onCursorMove(
        cam.x + ((e.clientX - rect.left) / (el.clientWidth || 1)) * cam.w,
        cam.y + ((e.clientY - rect.top) / (el.clientHeight || 1)) * cam.h,
      );
    }
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.px) > TAP_PX || Math.abs(e.clientY - d.py) > TAP_PX) d.moved = true;
    const worldPerPxX = cam.w / (el.clientWidth || 1);
    const worldPerPxY = cam.h / (el.clientHeight || 1);
    camRef.current = {
      ...cam,
      x: d.camx - (e.clientX - d.px) * worldPerPxX,
      y: d.camy - (e.clientY - d.py) * worldPerPxY,
    };
    apply();
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    // A tap (no real movement) selects the booth under the pointer, or clears it.
    if (d && !d.moved && onSelect) {
      const hit = (d.target as Element | null)?.closest?.("[data-bi]");
      onSelect(hit ? Number(hit.getAttribute("data-bi")) : null);
    }
  };

  const zoomButton = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#fbfbfa]">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(#e3e5e8 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <style>{STROKE_CSS}</style>
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div ref={hostRef} className="pz-svg w-full h-full" />
        <div ref={cursorLayerRef} className="absolute inset-0 overflow-hidden pointer-events-none" />
      </div>

      {error && (
        <div className="absolute inset-0 grid place-items-center text-sm text-[color:var(--color-ink-soft)]">
          Couldn’t load floorplan ({error}).
        </div>
      )}

      <div className="absolute bottom-5 right-5 flex flex-col items-stretch card overflow-hidden">
        <ZoomBtn label="Zoom in" onClick={() => zoomButton(1.3)}>+</ZoomBtn>
        <div className="h-px bg-[color:var(--color-line)]" />
        <ZoomBtn label="Zoom out" onClick={() => zoomButton(1 / 1.3)}>–</ZoomBtn>
      </div>
      <button
        onClick={fit}
        className="absolute bottom-5 right-20 btn btn-ghost bg-[color:var(--color-surface)]"
        title="Fit to screen"
      >
        Fit
      </button>
      <div className="absolute bottom-6 left-5 text-xs text-[color:var(--color-ink-soft)] bg-[color:var(--color-surface)]/90 px-2 py-1 rounded-md border border-[color:var(--color-line)] tabular-nums">
        {zoomPct}%
      </div>
    </div>
  );
});

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function ZoomBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-10 h-10 grid place-items-center text-xl text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
    >
      {children}
    </button>
  );
}
