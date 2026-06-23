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
const MAX_W_FACTOR = 50; // largest (max zoom-out)

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
  highlight?: Set<number> | null;
}>(function PanZoom({
  svgUrl,
  svg: svgProp,
  booths,
  selected,
  onSelect,
  assignments,
  statusTypes,
  highlight,
}, ref) {
  // statusId -> colour, across all status types
  const statusColor = useMemo(() => {
    const m = new Map<string, string>();
    (statusTypes ?? []).forEach((t) => t.statuses.forEach((s) => m.set(s.id, s.color)));
    return m;
  }, [statusTypes]);
  const hostRef = useRef<HTMLDivElement>(null); // holds the injected <svg>
  const containerRef = useRef<HTMLDivElement>(null);
  const svgElRef = useRef<SVGSVGElement | null>(null);

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

  const apply = useCallback(() => {
    const svg = svgElRef.current;
    const cam = camRef.current;
    if (!svg || !cam) return;
    svg.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    setZoomPct(Math.round((fitWRef.current / cam.w) * 100));
  }, []);

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

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

      // status fill
      const col = a?.statusId ? statusColor.get(a.statusId) : undefined;
      if (col) {
        const poly = document.createElementNS(NS, "polygon");
        poly.setAttribute("points", b.polygon.map((p) => p.join(",")).join(" "));
        poly.setAttribute("fill", col);
        statusG.appendChild(poly);
      }

      // label
      const exhibitor = a?.exhibitor?.trim();
      if (exhibitor) {
        // exhibitor name fit to the booth (single line), with the number small above
        const fnNum = Math.min(bh * 0.22, (bw * 0.86) / ((b.number?.length || 1) * CW), 1200);
        const fName = Math.min(bh * 0.4, (bw * 0.92) / (exhibitor.length * CW), 2600);
        if (fName >= 150) {
          if (b.number && fnNum >= 130)
            labelG.appendChild(txt(cx, cy - fName * 0.62, fnNum, "#80868b", esc(b.number)));
          labelG.appendChild(txt(cx, cy + (b.number && fnNum >= 130 ? fName * 0.12 : 0), fName, "#202124", esc(exhibitor), "600"));
        }
      } else if (b.number) {
        const dim = b.width_m != null ? `${round1(b.width_m)} × ${round1(b.depth_m!)}` : "";
        const fN = Math.min(bh * 0.42, (bw * 0.86) / (b.number.length * CW), 2200);
        if (fN < 240) return;
        const fD = dim ? Math.min(fN * 0.6, (bw * 0.86) / (dim.length * CW)) : 0;
        if (dim && fD >= 200) {
          const gap = fN * 0.12;
          const block = fN + gap + fD;
          labelG.appendChild(txt(cx, cy - block / 2 + fN * 0.5, fN, "#0f3d8a", esc(b.number)));
          labelG.appendChild(txt(cx, cy + block / 2 - fD * 0.5, fD, "#5f6368", dim));
        } else {
          labelG.appendChild(txt(cx, cy, fN, "#0f3d8a", esc(b.number)));
        }
      }
    });

    svg.insertBefore(statusG, svg.firstChild); // fills under the line work
    svg.appendChild(labelG); // labels on top
  }, [world, booths, assignments, statusColor]);

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
    const d = drag.current;
    const el = containerRef.current;
    const cam = camRef.current;
    if (!d || !el || !cam) return;
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
