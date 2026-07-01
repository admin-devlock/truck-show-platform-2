// Client-side export helpers. No external deps: PNG via canvas, PDF hand-built around
// a canvas JPEG (DCTDecode), CSV from the booth records. All "as depicted right now".
import type { Booth } from "@/components/PanZoom";
import type { BoothAssignment, StatusType } from "@/lib/maps";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeName(s: string) {
  return (s || "map").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "map";
}

/** Rasterize an SVG string to a canvas, longest side = maxDim (kept ≤ a sane cap). */
export async function svgToCanvas(svg: string, maxDim = 3000): Promise<HTMLCanvasElement> {
  // Read intrinsic size from the SVG's width/height (set by getExportSvg).
  const wm = svg.match(/width="(\d+)"/);
  const hm = svg.match(/height="(\d+)"/);
  const iw = wm ? Number(wm[1]) : 2000;
  const ih = hm ? Number(hm[1]) : 2000;
  const scale = Math.min(maxDim / Math.max(iw, ih), 4);
  const cw = Math.max(1, Math.round(iw * scale));
  const ch = Math.max(1, Math.round(ih * scale));

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to rasterize SVG"));
    img.src = url;
  });
}

export async function svgToPngBlob(svg: string, maxDim = 3000): Promise<Blob> {
  const canvas = await svgToCanvas(svg, maxDim);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/** Build a single-page PDF wrapping a JPEG of the floorplan (DCTDecode image). */
export async function svgToPdfBlob(svg: string, maxDim = 3000): Promise<Blob> {
  const canvas = await svgToCanvas(svg, maxDim);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const jpeg = base64ToBytes(dataUrl.split(",")[1]);
  return buildImagePdf(jpeg, canvas.width, canvas.height);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildImagePdf(jpeg: Uint8Array, iw: number, ih: number): Blob {
  // Fit the page to ~1400pt on the long side (a large but sane poster), keep aspect.
  const maxPt = 1400;
  const scale = Math.min(maxPt / Math.max(iw, ih), 1);
  const pw = Math.round(iw * scale);
  const ph = Math.round(ih * scale);

  const enc = (s: string) => new TextEncoder().encode(s);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = [];
  const push = (b: Uint8Array) => {
    chunks.push(b);
    offset += b.length;
  };
  const startObj = (n: number) => {
    offsets[n] = offset;
    push(enc(`${n} 0 obj\n`));
  };
  const endObj = () => push(enc("endobj\n"));

  push(enc("%PDF-1.4\n"));
  // Binary-file marker: four raw high bytes. Must be emitted as raw bytes — routing
  // "\xff" through TextEncoder would UTF-8-encode each as 0xC3 0xBF, not 0xFF.
  push(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

  startObj(1);
  push(enc("<< /Type /Catalog /Pages 2 0 R >>\n"));
  endObj();

  startObj(2);
  push(enc("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"));
  endObj();

  startObj(3);
  push(
    enc(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
        `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\n`,
    ),
  );
  endObj();

  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  startObj(4);
  push(enc(`<< /Length ${content.length} >>\nstream\n`));
  push(enc(content));
  push(enc("\nendstream\n"));
  endObj();

  startObj(5);
  push(
    enc(
      `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
        `stream\n`,
    ),
  );
  push(jpeg);
  push(enc("\nendstream\n"));
  endObj();

  const xrefStart = offset;
  const count = 6; // objects 0..5
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  push(enc(xref));
  push(enc(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// CSV: one row per booth, exhibitor + the chosen status in each status type.
// ---------------------------------------------------------------------------
function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v); // numeric cells: never treated as formulas
  let s = v;
  // Neutralize spreadsheet formula injection: a value a user typed (e.g. an exhibitor
  // name) starting with = + - @ or a control char is executed as a formula by
  // Excel/Sheets. Prefix with an apostrophe so it's read as text.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function boothsToCsv(
  booths: Booth[],
  assignments: Record<string, BoothAssignment>,
  statusTypes: StatusType[],
): string {
  // statusId -> status name
  const statusName = new Map<string, string>();
  statusTypes.forEach((t) => t.statuses.forEach((s) => statusName.set(s.id, s.name)));

  const header = [
    "Booth",
    "Exhibitor",
    ...statusTypes.map((t) => t.name),
    "Width (m)",
    "Depth (m)",
    "Area (m²)",
    "Kind",
  ];
  const rows = [header.map(csvCell).join(",")];

  for (const b of booths) {
    const a = b.number ? assignments[b.number] : undefined;
    const chosen = a?.statusId ? statusName.get(a.statusId) ?? "" : "";
    // We only track one status per booth; show it under whichever type owns it.
    const statusCols = statusTypes.map((t) =>
      a?.statusId && t.statuses.some((s) => s.id === a.statusId) ? chosen : "",
    );
    rows.push(
      [
        csvCell(b.number),
        csvCell(a?.exhibitor ?? ""),
        ...statusCols.map(csvCell),
        csvCell(b.width_m),
        csvCell(b.depth_m),
        csvCell(b.area_m2),
        csvCell(b.kind),
      ].join(","),
    );
  }
  return rows.join("\r\n");
}
