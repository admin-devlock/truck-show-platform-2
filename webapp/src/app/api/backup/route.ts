import { NextResponse } from "next/server";
import { writeFile, readFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

// Server-side backup store: writes a map's backup JSON to disk on the host, OUTSIDE
// Firestore, so the data survives a database/website failure and stays recoverable.
// Keeps the latest snapshot plus a rolling history per map.
//   POST  /api/backup        body: { mapId, backup }   -> save snapshot
//   GET   /api/backup?mapId=  -> latest snapshot (for recovery)
//   GET   /api/backup         -> list maps that have backups
export const runtime = "nodejs";

const BACKUP_DIR = join(process.cwd(), "backups");
const HISTORY_KEEP = 10;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024; // renders embedded as strings; real backups are ~1-2MB

// Firestore auto-ids are 20 chars of this alphabet. Requiring that shape means callers
// must already KNOW a map id (they're unguessable) — junk/short ids are rejected.
function safeId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{15,40}$/.test(id) ? id : null;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > MAX_BACKUP_BYTES) {
      return NextResponse.json({ error: "backup too large" }, { status: 413 });
    }
    const { mapId, backup } = JSON.parse(raw);
    const id = mapId ? safeId(String(mapId)) : null;
    if (!id || !backup) {
      return NextResponse.json({ error: "mapId and backup are required" }, { status: 400 });
    }
    const dir = join(BACKUP_DIR, id);
    await mkdir(dir, { recursive: true });
    const json = JSON.stringify(backup);
    // Latest (overwritten) + a timestamped history entry.
    await writeFile(join(dir, "latest.json"), json, "utf8");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(join(dir, `${stamp}.json`), json, "utf8");

    // Trim history to the most recent HISTORY_KEEP snapshots.
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".json") && f !== "latest.json")
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) {
      await unlink(join(dir, f)).catch(() => {});
    }
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    console.error("backup save failed:", e);
    return NextResponse.json({ error: "backup failed" }, { status: 500 }); // no path/stack leak
  }
}

export async function GET(req: Request) {
  const mapId = new URL(req.url).searchParams.get("mapId");
  try {
    // Recovery read requires a full map id — there is deliberately NO listing endpoint
    // (that would let anyone enumerate every map's id and download its data).
    const id = mapId ? safeId(mapId) : null;
    if (!id) return NextResponse.json({ error: "mapId is required" }, { status: 400 });
    const text = await readFile(join(BACKUP_DIR, id, "latest.json"), "utf8");
    return new NextResponse(text, { headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "no backup for that map" }, { status: 404 });
  }
}
