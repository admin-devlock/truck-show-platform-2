"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  renameLevel,
  replaceLevelCad,
  removeLevel,
  type Level,
  type MapDoc,
} from "@/lib/maps";

/**
 * Level switcher. Collapsed it's a compact bar showing the active level + actions;
 * expanded it opens a 3D "fanned deck" — the active floorplan stands flat in front,
 * the others tilt behind it. Click a card to bring it forward (switch levels).
 */
const TILT = 38; // degrees, back cards
const SPREAD = 54; // px each card rises/recedes behind the front one

export function LevelSwitcher({
  map,
  levels,
  activeLevelId,
  onSelect,
  onAdd,
}: {
  map: MapDoc;
  levels: Level[];
  activeLevelId: string;
  onSelect: (levelId: string) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = levels.find((l) => l.id === activeLevelId) ?? levels[0];

  return (
    <div className="flex items-center gap-1 px-4 h-10 border-b border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
      <button
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-2 h-7 pl-2 pr-2.5 rounded-md text-xs hover:bg-[#f1f3f4]"
        title="Switch level"
      >
        <DeckGlyph />
        <span className="font-medium max-w-[12rem] truncate">{active?.name ?? "Level"}</span>
        {levels.length > 1 && (
          <span className="text-[color:var(--color-ink-soft)]">· {levels.length} levels</span>
        )}
        {active?.status === "processing" && (
          <span className="h-2.5 w-2.5 rounded-full border border-current border-t-transparent animate-spin" />
        )}
        {active?.status === "error" && <span className="text-[#c5221f]" title="Conversion failed">!</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[color:var(--color-ink-soft)]">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {active && (
        <LevelActions map={map} level={active} canRemove={levels.length > 1} onSwitched={onSelect} />
      )}

      <button
        onClick={onAdd}
        className="ml-1 inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
        title="Add a CAD level"
      >
        <span className="text-base leading-none">+</span> Add level
      </button>

      {open && (
        <LevelDeck
          levels={levels}
          activeLevelId={active?.id ?? ""}
          onSelect={onSelect}
          onAdd={() => {
            setOpen(false);
            onAdd();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** The expanded 3D deck overlay. */
function LevelDeck({
  levels,
  activeLevelId,
  onSelect,
  onAdd,
  onClose,
}: {
  levels: Level[];
  activeLevelId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(activeLevelId);
  const closing = useRef(false);

  // Stack order: active first (flat, front), then the rest in their natural order.
  const ordered = useMemo(() => {
    const front = levels.find((l) => l.id === current);
    const rest = levels.filter((l) => l.id !== current);
    return front ? [front, ...rest] : levels;
  }, [levels, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (id: string) => {
    if (closing.current) return;
    if (id === current) {
      onClose();
      return;
    }
    setCurrent(id); // animate the chosen card to the front…
    onSelect(id);
    closing.current = true;
    setTimeout(onClose, 430); // …then close once it's settled
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onClose}>
      <div className="card w-full max-w-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium">Levels</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 grid place-items-center rounded-full hover:bg-[#f1f3f4] text-[color:var(--color-ink-soft)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          className="relative rounded-md bg-[color:var(--color-canvas)]"
          style={{ height: 360, perspective: "1300px", perspectiveOrigin: "50% 34%" }}
        >
          {ordered.map((lvl, p) => {
            const dy = -(p * SPREAD);
            const dz = -(p * SPREAD * 0.85);
            const rot = p === 0 ? 0 : TILT;
            const scale = 1 - p * 0.05;
            return (
              <button
                key={lvl.id}
                onClick={() => pick(lvl.id)}
                className="absolute block text-left overflow-hidden bg-white border border-[color:var(--color-line)] rounded-md"
                style={{
                  left: "50%",
                  bottom: 28,
                  width: 360,
                  height: 226,
                  transformOrigin: "50% 100%",
                  transform: `translateX(-50%) translateY(${dy}px) translateZ(${dz}px) rotateX(${rot}deg) scale(${scale})`,
                  opacity: Math.max(0.5, 1 - p * 0.2),
                  zIndex: 100 - p,
                  boxShadow: `0 ${10 - p * 2}px ${26 - p * 5}px rgba(60,64,67,${(0.22 - p * 0.05).toFixed(2)})`,
                  transition:
                    "transform .5s cubic-bezier(.2,.7,.2,1), opacity .5s, box-shadow .5s",
                  cursor: "pointer",
                }}
              >
                <div className="lvl-thumb h-[182px] border-b border-[color:var(--color-line)]">
                  <LevelThumb level={lvl} />
                </div>
                <div className="h-[44px] flex items-center gap-2 px-3.5">
                  <span className="text-sm font-medium truncate">{lvl.name}</span>
                  {p === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#e8f0fe] text-[color:var(--color-accent)]">
                      Active
                    </span>
                  )}
                  <span className="ml-auto text-xs text-[color:var(--color-ink-soft)]">
                    {lvl.status === "processing"
                      ? "Converting…"
                      : lvl.boothCount != null
                        ? `${lvl.boothCount} booths`
                        : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-between items-center mt-1 pt-3 border-t border-[color:var(--color-line)]">
          <button onClick={onAdd} className="text-sm text-[color:var(--color-accent)] hover:underline">
            + Add level
          </button>
          <button onClick={onClose} className="btn btn-ghost">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function LevelThumb({ level }: { level: Level }) {
  if (level.svgUrl) return <img src={level.svgUrl} alt="" />;
  if (level.thumbSvg) return <div dangerouslySetInnerHTML={{ __html: level.thumbSvg }} />;
  return (
    <div className="w-full h-full grid place-items-center text-xs text-[color:var(--color-ink-soft)] bg-[#fbfbfa]">
      {level.status === "processing" ? "Rendering…" : level.status === "error" ? "Failed" : "No preview"}
    </div>
  );
}

/** Active-level actions: rename (inline), replace CAD, remove. */
function LevelActions({
  map,
  level,
  canRemove,
  onSwitched,
}: {
  map: MapDoc;
  level: Level;
  canRemove: boolean;
  onSwitched: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(level.name);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setName(level.name), [level.name]);

  const commitRename = () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== level.name) renameLevel(map.id, level.id, name.trim());
  };

  if (renaming) {
    return (
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setName(level.name);
            setRenaming(false);
          }
        }}
        className="h-7 text-xs px-2 rounded-md border border-[color:var(--color-accent)] outline-none ring-1 ring-[color:var(--color-accent)] w-32"
      />
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenu((v) => !v)}
        aria-label="Level actions"
        className="h-7 w-7 grid place-items-center rounded-md text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
      >
        ⋮
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="absolute z-40 mt-1 left-0 w-40 card py-1 text-sm">
            <button
              onClick={() => {
                setMenu(false);
                setRenaming(true);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f1f3f4]"
            >
              Rename
            </button>
            <button
              onClick={() => {
                setMenu(false);
                fileRef.current?.click();
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#f1f3f4]"
            >
              Replace CAD…
            </button>
            {canRemove && (
              <button
                onClick={async () => {
                  setMenu(false);
                  if (confirm(`Remove level “${level.name}”? Its floorplan and assignments will be deleted.`)) {
                    try {
                      await removeLevel(map, level.id);
                    } catch (e) {
                      alert(String(e instanceof Error ? e.message : e));
                    }
                  }
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#f1f3f4] text-[#c5221f]"
              >
                Remove level
              </button>
            )}
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".dwg,.dxf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              await replaceLevelCad(map, level.id, f);
              onSwitched(level.id);
            } catch (err) {
              alert("Couldn’t replace CAD: " + err);
            }
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

function DeckGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[color:var(--color-accent)]">
      <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" />
      <polyline points="2 15.5 12 22 22 15.5" />
    </svg>
  );
}
