"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInGate } from "@/components/SignInGate";
import { TopBar } from "@/components/TopBar";
import { MapCard } from "@/components/MapCard";
import { NewMapDialog } from "@/components/NewMapDialog";
import { DeleteMapDialog } from "@/components/DeleteMapDialog";
import { UpdateMapDialog } from "@/components/UpdateMapDialog";
import { useAuth } from "@/lib/auth";
import { subscribeMaps, createMapFromSvg, type MapDoc } from "@/lib/maps";
import { restoreFromFile } from "@/lib/backup";

export default function Home() {
  return (
    <SignInGate>
      <Dashboard />
    </SignInGate>
  );
}

function Dashboard() {
  const { identity } = useAuth();
  const router = useRouter();
  const [maps, setMaps] = useState<MapDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [toDelete, setToDelete] = useState<MapDoc | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return subscribeMaps((m) => {
      setMaps(m);
      setLoading(false);
    });
  }, []);

  // One-click demo map that points at the bundled Plaza floorplan SVG we generated.
  const createSample = async () => {
    if (!identity) return;
    setSeeding(true);
    try {
      const id = await createMapFromSvg(identity, "Plaza Level (sample)", "/sample/plaza.svg", 146);
      router.push(`/map/${id}`);
    } catch (e) {
      setSeeding(false);
      alert("Couldn’t create sample: " + e);
    }
  };

  // Restore a map from a previously downloaded backup JSON.
  const restore = async (file: File) => {
    if (!identity) return;
    setRestoring(true);
    try {
      const id = await restoreFromFile(identity, file);
      router.push(`/map/${id}`);
    } catch (e) {
      setRestoring(false);
      alert("Couldn’t restore: " + (e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar onBrandClick={() => router.push("/")} />

      {/* "Start a new map" band, à la the Docs template strip */}
      <section className="bg-[color:var(--color-surface)] border-b border-[color:var(--color-line)]">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <h2 className="text-sm font-medium text-[color:var(--color-ink-soft)] mb-4">
            Start a new map
          </h2>
          <div className="flex gap-5">
            <NewTile label="Upload CAD" onClick={() => setShowNew(true)}>
              <PlusGlyph />
            </NewTile>
            <NewTile label="Update existing" onClick={() => setShowUpdate(true)} disabled={loading || maps.length === 0}>
              <UpdateGlyph />
            </NewTile>
            <NewTile label="Plaza sample" onClick={createSample} busy={seeding}>
              <MapThumb />
            </NewTile>
            <NewTile label="Restore backup" onClick={() => restoreRef.current?.click()} busy={restoring}>
              <RestoreGlyph />
            </NewTile>
            <input
              ref={restoreRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restore(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      {/* Recent maps grid */}
      <section className="flex-1 max-w-6xl w-full mx-auto px-6 py-7">
        <h2 className="text-sm font-medium text-[color:var(--color-ink-soft)] mb-4">
          Recent maps
        </h2>

        {loading ? (
          <div className="text-sm text-[color:var(--color-ink-soft)]">Loading…</div>
        ) : maps.length === 0 ? (
          <div className="text-sm text-[color:var(--color-ink-soft)] py-16 text-center">
            No maps yet. Create one above to get started.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {maps.map((m) => (
              <MapCard key={m.id} map={m} onRequestDelete={setToDelete} />
            ))}
          </div>
        )}
      </section>

      {showNew && <NewMapDialog onClose={() => setShowNew(false)} />}
      {showUpdate && <UpdateMapDialog maps={maps} onClose={() => setShowUpdate(false)} />}
      {toDelete && <DeleteMapDialog map={toDelete} onClose={() => setToDelete(null)} />}
    </div>
  );
}

function NewTile({
  children,
  label,
  onClick,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={busy || disabled} className="group text-left disabled:opacity-50 disabled:cursor-not-allowed">
      <div className="w-[150px] h-[112px] card grid place-items-center group-hover:border-[color:var(--color-accent)]">
        {busy ? (
          <span className="h-5 w-5 rounded-full border-2 border-[color:var(--color-line)] border-t-[color:var(--color-accent)] animate-spin" />
        ) : (
          children
        )}
      </div>
      <div className="text-sm mt-2">{label}</div>
    </button>
  );
}

function PlusGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function UpdateGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h10a5 5 0 0 1 5 5v1" />
      <path d="m16 9 3 3 3-3" />
      <rect x="4" y="12" width="8" height="7" rx="1" />
    </svg>
  );
}

function MapThumb() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="1.5">
      <rect x="3" y="4" width="7" height="7" rx="1" />
      <rect x="14" y="4" width="7" height="4" rx="1" />
      <rect x="14" y="11" width="7" height="9" rx="1" />
      <rect x="3" y="14" width="7" height="6" rx="1" />
    </svg>
  );
}
