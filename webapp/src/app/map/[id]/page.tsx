"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInGate } from "@/components/SignInGate";
import { TopBar } from "@/components/TopBar";
import { PanZoom, type Booth, type PanZoomHandle } from "@/components/PanZoom";
import { BoothInfoPanel } from "@/components/BoothInfoPanel";
import { StatusManager } from "@/components/StatusManager";
import { SearchPanel } from "@/components/SearchPanel";
import { ExhibitorImportDialog } from "@/components/ExhibitorImportDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { LevelBar } from "@/components/LevelBar";
import { NewLevelDialog } from "@/components/NewLevelDialog";
import { PresenceBar } from "@/components/PresenceBar";
import { useAuth } from "@/lib/auth";
import {
  subscribeMap,
  subscribeRender,
  subscribeBoothData,
  subscribeLevels,
  renameMap,
  type MapDoc,
  type MapRender,
  type BoothData,
  type Level,
} from "@/lib/maps";
import { usePresence } from "@/lib/presence";
import { useAutoBackup } from "@/lib/backup";
import { applyBoothSplits } from "@/lib/booths";

export default function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SignInGate>
      <Viewer id={id} />
    </SignInGate>
  );
}

function Viewer({ id }: { id: string }) {
  const { identity } = useAuth();
  const router = useRouter();
  const [map, setMap] = useState<MapDoc | null | undefined>(undefined);
  const [levels, setLevels] = useState<Level[]>([]);
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [render, setRender] = useState<MapRender | null>(null);
  const [sampleBooths, setSampleBooths] = useState<Booth[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [boothData, setBoothData] = useState<BoothData>({
    assignments: {},
    statusTypes: [],
    activeStatusTypeId: null,
    splits: {},
  });
  const [showStatuses, setShowStatuses] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAddLevel, setShowAddLevel] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Set<number> | null>(null);
  const panzoomRef = useRef<PanZoomHandle>(null);
  const others = usePresence(id, identity);

  useEffect(() => subscribeMap(id, setMap), [id]);
  // A map's levels (CAD floorplans). Legacy maps yield a single synthesized level.
  useEffect(() => {
    if (!map) return;
    return subscribeLevels(map, setLevels);
  }, [map]);

  // Pick/keep a valid active level whenever the level list changes.
  useEffect(() => {
    if (!levels.length) return;
    setActiveLevelId((cur) => (cur && levels.some((l) => l.id === cur) ? cur : levels[0].id));
  }, [levels]);

  const activeLevel = useMemo(
    () => levels.find((l) => l.id === activeLevelId) ?? levels[0],
    [levels, activeLevelId],
  );

  // Regularly back the map up to the host filesystem (recoverable fallback copy).
  useAutoBackup(map, activeLevel?.status === "ready");

  // The active level's rendered SVG + its assignments/statuses (collaborative, live).
  useEffect(() => {
    if (!activeLevel) return;
    setRender(null);
    setSelected(null);
    return subscribeRender(id, activeLevel.id, setRender);
  }, [id, activeLevel?.id]);
  useEffect(() => {
    if (!activeLevel) return;
    return subscribeBoothData(id, activeLevel.id, setBoothData);
  }, [id, activeLevel?.id]);

  // Booth data for click-to-inspect: uploaded levels carry it in the render subdoc;
  // the bundled sample has a sibling JSON next to its SVG.
  useEffect(() => {
    setSampleBooths(null);
    const svgUrl = activeLevel?.svgUrl;
    if (!svgUrl) return;
    const url = svgUrl.replace(/plaza\.svg$/, "plaza_booths.json");
    if (url === svgUrl) return;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSampleBooths(d?.booths ?? null))
      .catch(() => {});
  }, [activeLevel?.svgUrl]);

  const rawBooths = useMemo<Booth[] | undefined>(() => {
    if (render?.boothsJson) {
      try {
        return JSON.parse(render.boothsJson).booths as Booth[];
      } catch {
        return undefined;
      }
    }
    return sampleBooths ?? undefined;
  }, [render, sampleBooths]);

  // Effective booths = CAD booths with any in-app splits applied (a split booth is
  // replaced by its two halves). Everything downstream uses this list.
  const booths = useMemo(
    () => applyBoothSplits(rawBooths, boothData.splits),
    [rawBooths, boothData.splits],
  );

  const selectedBooth = selected != null ? booths?.[selected] : undefined;
  const boothNumbers = useMemo(
    () => (booths ?? []).map((b) => b.number).filter((n): n is string => !!n),
    [booths],
  );

  return (
    <div className="h-screen flex flex-col">
      <TopBar
        onBrandClick={() => router.push("/")}
        center={
          map ? (
            <EditableTitle id={id} title={map.title} canEdit={map.ownerId === identity?.uid} />
          ) : null
        }
        right={
          <div className="flex items-center gap-3">
            {activeLevel?.status === "ready" && booths && booths.length > 0 && (
              <button onClick={() => setShowSearch((v) => !v)} className="btn btn-ghost">
                Search
              </button>
            )}
            {activeLevel?.status === "ready" && booths && booths.length > 0 && (
              <button onClick={() => setShowImport(true)} className="btn btn-ghost">
                Exhibitors
              </button>
            )}
            {activeLevel?.status === "ready" && (
              <button onClick={() => setShowStatuses(true)} className="btn btn-ghost">
                Statuses
              </button>
            )}
            {activeLevel?.status === "ready" && (
              <button onClick={() => setShowExport(true)} className="btn btn-ghost">
                Download
              </button>
            )}
            <PresenceBar others={others} />
          </div>
        }
      />

      {map && (
        <LevelBar
          map={map}
          levels={levels}
          activeLevelId={activeLevel?.id ?? ""}
          onSelect={setActiveLevelId}
          onAdd={() => setShowAddLevel(true)}
        />
      )}

      <main className="flex-1 relative">
        {map === undefined && (
          <Centered>
            <Spinner />
          </Centered>
        )}
        {map === null && (
          <Centered>
            <div className="text-center">
              <div className="text-sm text-[color:var(--color-ink-soft)] mb-3">
                This map doesn’t exist.
              </div>
              <button onClick={() => router.push("/")} className="btn btn-ghost">
                Back to maps
              </button>
            </div>
          </Centered>
        )}
        {map && activeLevel?.status === "ready" && activeLevel.svgUrl && (
          <PanZoom
            key={activeLevel.id}
            ref={panzoomRef}
            svgUrl={activeLevel.svgUrl}
            booths={booths}
            selected={selected}
            onSelect={setSelected}
            assignments={boothData.assignments}
            statusTypes={boothData.statusTypes}
            highlight={searchMatches}
          />
        )}
        {map && activeLevel?.status === "ready" && !activeLevel.svgUrl && render && (
          <PanZoom
            key={activeLevel.id}
            ref={panzoomRef}
            svg={render.svg}
            booths={booths}
            selected={selected}
            onSelect={setSelected}
            assignments={boothData.assignments}
            statusTypes={boothData.statusTypes}
            highlight={searchMatches}
          />
        )}
        {map && activeLevel?.status === "ready" && !activeLevel.svgUrl && !render && (
          <Centered>
            <Spinner />
          </Centered>
        )}
        {selectedBooth && activeLevel && (
          <BoothInfoPanel
            mapId={id}
            levelId={activeLevel.id}
            booth={selectedBooth}
            assignment={selectedBooth.number ? boothData.assignments[selectedBooth.number] : undefined}
            statusTypes={boothData.statusTypes}
            onClose={() => setSelected(null)}
          />
        )}
        {showSearch && booths && (
          <SearchPanel
            booths={booths}
            assignments={boothData.assignments}
            statusTypes={boothData.statusTypes}
            onResults={(idx) => setSearchMatches(idx.length ? new Set(idx) : null)}
            onPick={(i) => {
              setSelected(i);
              panzoomRef.current?.focusBooth(i);
            }}
            onFrameAll={(idx) => panzoomRef.current?.frameBooths(idx)}
            onClose={() => {
              setShowSearch(false);
              setSearchMatches(null);
            }}
          />
        )}
        {showImport && activeLevel && (
          <ExhibitorImportDialog
            mapId={id}
            levelId={activeLevel.id}
            boothNumbers={boothNumbers}
            onClose={() => setShowImport(false)}
          />
        )}
        {showExport && map && (
          <ExportDialog
            map={map}
            getSvg={() => panzoomRef.current?.getExportSvg() ?? null}
            booths={booths ?? []}
            assignments={boothData.assignments}
            statusTypes={boothData.statusTypes}
            onClose={() => setShowExport(false)}
          />
        )}
        {showStatuses && (
          <StatusManager mapId={id} statusTypes={boothData.statusTypes} onClose={() => setShowStatuses(false)} />
        )}
        {map && activeLevel?.status === "processing" && (
          <Centered>
            <div className="text-center max-w-xs">
              <Spinner />
              <div className="text-sm font-medium mt-4">Converting “{activeLevel.sourceFile}”</div>
              <p className="text-xs text-[color:var(--color-ink-soft)] mt-1.5 leading-relaxed">
                Rendering the floorplan from the CAD file. This can take a minute or
                two for large drawings — it’ll appear here automatically.
              </p>
            </div>
          </Centered>
        )}
        {map && activeLevel?.status === "error" && (
          <Centered>
            <div className="text-sm text-[color:var(--color-ink-soft)]">
              Conversion failed for this level.
            </div>
          </Centered>
        )}
      </main>

      {showAddLevel && map && (
        <NewLevelDialog
          map={map}
          onClose={() => setShowAddLevel(false)}
          onAdded={(levelId) => setActiveLevelId(levelId)}
        />
      )}
    </div>
  );
}

function EditableTitle({ id, title, canEdit }: { id: string; title: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(title);
  useEffect(() => setVal(title), [title]);

  if (!canEdit) return <span className="text-sm font-medium truncate">{title}</span>;

  return editing ? (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (val.trim() && val !== title) renameMap(id, val.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setVal(title);
          setEditing(false);
        }
      }}
      className="text-sm font-medium text-center border border-[color:var(--color-accent)] rounded px-2 py-1 outline-none ring-1 ring-[color:var(--color-accent)] min-w-[12rem]"
    />
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="text-sm font-medium truncate px-2 py-1 rounded hover:bg-[#f1f3f4]"
      title="Rename"
    >
      {title}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 grid place-items-center">{children}</div>;
}
function Spinner() {
  return (
    <span className="inline-block h-6 w-6 rounded-full border-2 border-[color:var(--color-line)] border-t-[color:var(--color-accent)] animate-spin" />
  );
}
