"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInGate } from "@/components/SignInGate";
import { TopBar } from "@/components/TopBar";
import { PanZoom, type Booth, type PanZoomHandle, type RemoteCursor } from "@/components/PanZoom";
import { BoothInfoPanel } from "@/components/BoothInfoPanel";
import { StatusManager } from "@/components/StatusManager";
import { SearchPanel } from "@/components/SearchPanel";
import { StatusLegend } from "@/components/StatusLegend";
import { ExhibitorImportDialog } from "@/components/ExhibitorImportDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { LevelSwitcher } from "@/components/LevelSwitcher";
import { NewLevelDialog } from "@/components/NewLevelDialog";
import { PresenceBar } from "@/components/PresenceBar";
import { useAuth } from "@/lib/auth";
import {
  subscribeMap,
  subscribeRender,
  subscribeBoothData,
  subscribeLevels,
  subscribeSearch,
  setSearchState,
  setActiveStatusType,
  renameMap,
  type MapDoc,
  type MapRender,
  type BoothData,
  type Level,
} from "@/lib/maps";
import { usePresence, publishCursor } from "@/lib/presence";
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
  const [showAddLevel, setShowAddLevel] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Set<number> | null>(null);
  // Search is collaborative: open-state, query and view are shared across viewers
  // (the matches highlight is computed locally per level). Map/level stay per-user.
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchView, setSearchView] = useState<"list" | "map">("list");
  const [searchStatusFilter, setSearchStatusFilter] = useState<string[]>([]);
  const searchWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panzoomRef = useRef<PanZoomHandle>(null);
  const others = usePresence(id, identity);

  // Live-sync the shared search state. Ignore the echo of our own writes (by === us).
  useEffect(() => {
    return subscribeSearch(id, (s) => {
      if (s.by && s.by === identity?.uid) return;
      setShowSearch(s.active);
      setSearchView(s.view);
      setSearchQuery(s.query);
      setSearchStatusFilter(s.statusFilter);
      if (!s.active) setSearchMatches(null);
    });
  }, [id, identity?.uid]);

  // Push a search change to all collaborators (query writes are debounced).
  const pushSearch = (
    patch: { query?: string; active?: boolean; view?: "list" | "map"; statusFilter?: string[] },
    debounce = false,
  ) => {
    if (!identity) return;
    if (searchWriteTimer.current) clearTimeout(searchWriteTimer.current);
    if (debounce) {
      searchWriteTimer.current = setTimeout(() => setSearchState(id, identity.uid, patch), 200);
    } else {
      setSearchState(id, identity.uid, patch);
    }
  };
  const onSearchQuery = (q: string) => {
    setSearchQuery(q);
    pushSearch({ query: q, active: true }, true);
  };
  const onSearchView = (v: "list" | "map") => {
    setSearchView(v);
    pushSearch({ view: v });
  };
  const onSearchStatusFilter = (statusFilter: string[]) => {
    setSearchStatusFilter(statusFilter);
    pushSearch({ statusFilter });
  };
  const toggleSearch = () => {
    const next = !showSearch;
    setShowSearch(next);
    if (!next) setSearchMatches(null);
    pushSearch({ active: next });
  };
  const closeSearch = () => {
    setShowSearch(false);
    setSearchMatches(null);
    pushSearch({ active: false });
  };

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

  // Live cursors: broadcast ours (throttled) and show collaborators' on this level.
  const cursorThrottle = useRef(0);
  const onCursorMove = (wx: number, wy: number) => {
    if (!identity || !activeLevel) return;
    const now = Date.now();
    if (now - cursorThrottle.current < 100) return; // ~10 updates/sec max
    cursorThrottle.current = now;
    publishCursor(id, identity.uid, wx, wy, activeLevel.id);
  };
  const cursors = useMemo<RemoteCursor[]>(() => {
    const now = Date.now();
    return others
      .filter(
        (p) =>
          p.cursorLevel === activeLevel?.id &&
          typeof p.cx === "number" &&
          typeof p.cy === "number" &&
          now - (p.cursorAt ?? 0) < 5000,
      )
      .map((p) => ({ uid: p.uid, name: p.name, color: p.color, x: p.cx!, y: p.cy! }));
  }, [others, activeLevel?.id]);

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
  const activeStatusType = boothData.activeStatusTypeId
    ? boothData.statusTypes.find((t) => t.id === boothData.activeStatusTypeId) ?? null
    : null;
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
              <button onClick={toggleSearch} className="btn btn-ghost">
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
        <LevelSwitcher
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
            activeStatusTypeId={showSearch ? null : boothData.activeStatusTypeId}
            highlight={searchMatches}
            cursors={cursors}
            onCursorMove={onCursorMove}
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
            activeStatusTypeId={showSearch ? null : boothData.activeStatusTypeId}
            highlight={searchMatches}
            cursors={cursors}
            onCursorMove={onCursorMove}
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
        {!showSearch && activeStatusType && booths && booths.length > 0 && (
          <StatusLegend
            type={activeStatusType}
            booths={booths}
            assignments={boothData.assignments}
            onClear={() => setActiveStatusType(id, null)}
          />
        )}
        {showSearch && booths && (
          <SearchPanel
            booths={booths}
            assignments={boothData.assignments}
            statusTypes={boothData.statusTypes}
            query={searchQuery}
            view={searchView}
            statusFilter={searchStatusFilter}
            onQueryChange={onSearchQuery}
            onViewChange={onSearchView}
            onStatusFilterChange={onSearchStatusFilter}
            onResults={(idx) => setSearchMatches(idx.length ? new Set(idx) : null)}
            onPick={(i) => {
              setSelected(i);
              panzoomRef.current?.focusBooth(i);
            }}
            onFrameAll={(idx) => panzoomRef.current?.frameBooths(idx)}
            onClose={closeSearch}
          />
        )}
        {showImport && activeLevel && (
          <ExhibitorImportDialog
            mapId={id}
            levelId={activeLevel.id}
            boothNumbers={boothNumbers}
            assignments={boothData.assignments}
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
          <StatusManager
            mapId={id}
            statusTypes={boothData.statusTypes}
            activeStatusTypeId={boothData.activeStatusTypeId}
            assignments={boothData.assignments}
            onClose={() => setShowStatuses(false)}
          />
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
