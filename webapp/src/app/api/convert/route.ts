import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the local conversion pipeline (libredwg `dwgread` -> minJSON -> python ->
// SVG + booths). Requires those tools on the host — true server-side conversion
// while the app runs on a machine that has them (the dev box). For cloud hosting
// this same route would live in a container that bundles libredwg + python3.
export const runtime = "nodejs";
export const maxDuration = 300;

const DWGREAD = "dwgread";
const PYTHON = "/usr/bin/python3";
const ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };

function run(cmd: string, args: string[], timeoutMs = 280_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: ENV });
    let stdout = "";
    let stderrTail = ""; // keep only the tail — dwgread emits thousands of warnings
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderrTail}`));
    });
  });
}

export async function POST(req: Request) {
  let dir: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".dwg")) {
      return NextResponse.json(
        { error: "Only .dwg files are supported by the converter right now." },
        { status: 415 },
      );
    }

    dir = await mkdtemp(join(tmpdir(), "tsconv-"));
    const dwgPath = join(dir, "in.dwg");
    const jsonPath = join(dir, "in.min.json");
    const svgPath = join(dir, "out.svg");
    const boothsPath = join(dir, "out.booths.json");
    const thumbPath = join(dir, "out.thumb.svg");

    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(dwgPath, buf);

    // 1) DWG -> libredwg minJSON
    await run(DWGREAD, ["-O", "minJSON", "-o", jsonPath, dwgPath]);
    // 2) minJSON -> SVG + booths + thumbnail
    const script = join(process.cwd(), "scripts", "convert_floorplan.py");
    const summaryOut = await run(PYTHON, [script, jsonPath, svgPath, boothsPath, thumbPath]);

    const [svg, boothsRaw, thumbSvg] = await Promise.all([
      readFile(svgPath, "utf8"),
      readFile(boothsPath, "utf8"),
      readFile(thumbPath, "utf8").catch(() => ""),
    ]);
    const booths = JSON.parse(boothsRaw);
    let summary: unknown = null;
    try {
      summary = JSON.parse(summaryOut.trim().split("\n").pop() || "null");
    } catch {}

    return NextResponse.json({
      svg,
      thumbSvg,
      booths,
      boothCount: booths.count ?? null,
      summary,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    // best-effort cleanup: remove the whole temp working dir (files + directory).
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
