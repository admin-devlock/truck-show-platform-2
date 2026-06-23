"use client";

import { useRef, useState } from "react";
import {
  renameLevel,
  replaceLevelCad,
  removeLevel,
  type Level,
  type MapDoc,
} from "@/lib/maps";

/**
 * Horizontal switcher for a map's levels (CAD floorplans). Click a tab to switch; the
 * active tab's ⋮ menu can rename it, swap its CAD file, or remove it. "+" adds a level.
 */
export function LevelBar({
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
  // Don't clutter the UI for a brand-new single-level map until it's worth it: still
  // show the bar (so "Add level" is discoverable), but it's compact.
  return (
    <div className="flex items-center gap-1 px-4 h-10 border-b border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-x-auto">
      {levels.map((lvl) => (
        <LevelTab
          key={lvl.id}
          map={map}
          level={lvl}
          active={lvl.id === activeLevelId}
          canRemove={levels.length > 1}
          onSelect={() => onSelect(lvl.id)}
          onRemoved={() => {
            // if the active level was removed, fall back to the first remaining one
            if (lvl.id === activeLevelId) {
              const next = levels.find((l) => l.id !== lvl.id);
              if (next) onSelect(next.id);
            }
          }}
        />
      ))}
      <button
        onClick={onAdd}
        className="ml-1 shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
        title="Add a CAD level"
      >
        <span className="text-base leading-none">+</span> Add level
      </button>
    </div>
  );
}

function LevelTab({
  map,
  level,
  active,
  canRemove,
  onSelect,
  onRemoved,
}: {
  map: MapDoc;
  level: Level;
  active: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemoved: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(level.name);
  const fileRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== level.name) renameLevel(map.id, level.id, name.trim());
  };

  return (
    <div className="relative shrink-0">
      {renaming ? (
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
          className="h-7 text-xs px-2 rounded-md border border-[color:var(--color-accent)] outline-none ring-1 ring-[color:var(--color-accent)] w-28"
        />
      ) : (
        <div
          className={`group flex items-center h-7 rounded-md text-xs ${
            active
              ? "bg-[#e8f0fe] text-[color:var(--color-accent)]"
              : "text-[color:var(--color-ink-soft)] hover:bg-[#f1f3f4]"
          }`}
        >
          <button onClick={onSelect} className="pl-2.5 pr-1 h-full flex items-center gap-1.5 max-w-[12rem]">
            <span className="truncate">{level.name}</span>
            {level.status === "processing" && (
              <span className="h-2.5 w-2.5 rounded-full border border-current border-t-transparent animate-spin" />
            )}
            {level.status === "error" && <span className="text-[#c5221f]" title="Conversion failed">!</span>}
          </button>
          <button
            onClick={() => setMenu((v) => !v)}
            aria-label="Level actions"
            className="px-1.5 h-full opacity-60 hover:opacity-100"
          >
            ⋮
          </button>
        </div>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="absolute z-40 mt-1 left-0 w-40 card py-1 text-sm">
            <MenuItem
              onClick={() => {
                setMenu(false);
                setRenaming(true);
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(false);
                fileRef.current?.click();
              }}
            >
              Replace CAD…
            </MenuItem>
            {canRemove && (
              <MenuItem
                danger
                onClick={async () => {
                  setMenu(false);
                  if (confirm(`Remove level “${level.name}”? Its floorplan and assignments will be deleted.`)) {
                    try {
                      await removeLevel(map, level.id);
                      onRemoved();
                    } catch (e) {
                      alert(String(e instanceof Error ? e.message : e));
                    }
                  }
                }}
              >
                Remove level
              </MenuItem>
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
              onSelect();
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

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-[#f1f3f4] ${
        danger ? "text-[#c5221f]" : ""
      }`}
    >
      {children}
    </button>
  );
}
