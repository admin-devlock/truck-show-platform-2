"use client";

// Live presence: while a user has a map open we write a presence doc under
// maps/{id}/presence/{uid} and heartbeat it. Everyone subscribes to the collection
// to render "who's here" avatars — the Google-Docs collaboration foundation. Stale
// entries (no heartbeat for >30s) are filtered out client-side.
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  deleteDoc,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Identity } from "./auth";

export type Presence = {
  uid: string;
  name: string;
  photo: string | null;
  color: string;
  lastActive: Timestamp | null;
  // Live cursor (world/SVG coords) + which level it's on, with a client timestamp so
  // stale cursors can be aged out independently of the slower presence heartbeat.
  cx?: number;
  cy?: number;
  cursorLevel?: string;
  cursorAt?: number;
};

/** Publish this user's cursor position (world coords). Throttle calls at the caller. */
export function publishCursor(
  mapId: string,
  uid: string,
  cx: number,
  cy: number,
  levelId: string,
) {
  return setDoc(
    doc(db, "maps", mapId, "presence", uid),
    { cx, cy, cursorLevel: levelId, cursorAt: Date.now(), lastActive: serverTimestamp() },
    { merge: true },
  ).catch(() => {});
}

const COLORS = [
  "#1a73e8", "#d93025", "#1e8e3e", "#e37400",
  "#9334e6", "#129eaf", "#c5221f", "#a142f4",
];

/** Deterministic per-user colour so a person keeps the same dot across sessions. */
export function colorForUid(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

const STALE_MS = 30_000;

export function usePresence(mapId: string | null, me: Identity | null) {
  const [others, setOthers] = useState<Presence[]>([]);

  useEffect(() => {
    if (!mapId || !me) return;
    const meRef = doc(db, "maps", mapId, "presence", me.uid);
    const write = () =>
      setDoc(
        meRef,
        {
          uid: me.uid,
          name: me.name,
          photo: me.photo,
          color: me.color,
          lastActive: serverTimestamp(),
        },
        { merge: true }, // preserve live cursor fields written between heartbeats
      ).catch(() => {}); // e.g. guest personas are denied under prod rules — presence is best-effort

    write();
    const beat = setInterval(write, 10_000);

    const unsub = onSnapshot(collection(db, "maps", mapId, "presence"), (snap) => {
      const now = Date.now();
      const list = snap.docs
        .map((d) => d.data() as Presence)
        .filter((p) => p.uid !== me.uid)
        .filter((p) => {
          const t = p.lastActive?.toMillis?.() ?? 0;
          return now - t < STALE_MS;
        });
      setOthers(list);
    });

    const leave = () => deleteDoc(meRef).catch(() => {});
    window.addEventListener("beforeunload", leave);

    return () => {
      clearInterval(beat);
      unsub();
      window.removeEventListener("beforeunload", leave);
      leave();
    };
  }, [mapId, me]);

  return others;
}
