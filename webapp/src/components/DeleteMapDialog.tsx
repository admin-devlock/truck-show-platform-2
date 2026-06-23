"use client";

import { useState } from "react";
import { deleteMap, type MapDoc } from "@/lib/maps";
import { SlideToConfirm } from "./SlideToConfirm";

/* Confirmation modal for deleting a map — uses slide-to-confirm to avoid accidents. */
export function DeleteMapDialog({ map, onClose }: { map: MapDoc; onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await deleteMap(map.id);
      onClose();
    } catch (e) {
      setBusy(false);
      alert("Couldn’t delete: " + e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium mb-1">Delete map</h2>
        <p className="text-sm text-[color:var(--color-ink-soft)] mb-5 leading-relaxed">
          “{map.title}” and its floorplan will be permanently deleted. This can’t be
          undone.
        </p>

        <SlideToConfirm
          onConfirm={confirm}
          busy={busy}
          label="Slide to delete"
          busyLabel="Deleting…"
        />

        <div className="flex justify-end mt-5">
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
