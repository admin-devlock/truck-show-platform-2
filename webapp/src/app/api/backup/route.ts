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

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function POST(req: Request) {
  try {
    const { mapId, backup } = await req.json();
    if (!mapId || !backup) {
      return NextResponse.json({ error: "mapId and backup are required" }, { status: 400 });
    }
    const id = safeId(String(mapId));
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
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const mapId = new URL(req.url).searchParams.get("mapId");
  try {
    if (mapId) {
      const file = join(BACKUP_DIR, safeId(mapId), "latest.json");
      const text = await readFile(file, "utf8");
      return new NextResponse(text, { headers: { "content-type": "application/json" } });
    }
    const dirs = await readdir(BACKUP_DIR).catch(() => [] as string[]);
    return NextResponse.json({ maps: dirs });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
}
