"use client";

import { deleteMap, type MapDoc } from "@/lib/maps";
import { ConfirmDialog } from "./ConfirmDialog";

/* Confirmation modal for deleting a map — slide-to-confirm to avoid accidents. */
export function DeleteMapDialog({ map, onClose }: { map: MapDoc; onClose: () => void }) {
  return (
    <ConfirmDialog
      title="Delete map"
      message={
        <>
          “{map.title}” and its floorplan will be permanently deleted. This can’t be undone.
        </>
      }
      confirmLabel="Slide to delete"
      busyLabel="Deleting…"
      onConfirm={async () => {
        await deleteMap(map.id);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
