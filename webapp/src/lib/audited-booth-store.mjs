import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { applyAuditedBoothEdit } from './booth-edit.ts';

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} mapId
 * @param {import('./booth-edit').BoothEdit} edit
 * @param {Record<string, unknown>} context
 */
export async function commitAuditedBoothEdit(db, mapId, edit, context) {
  const eventRef = doc(collection(db, 'activity'));
  const ref = doc(db, 'maps', mapId, 'meta', 'booths');
  return runTransaction(db, tx => applyAuditedBoothEdit({
    read: async () => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Map data is unavailable. Refresh before saving.');
      return snap.data();
    },
    writeBooth: (number, patch) => tx.set(ref, { assignments: { [number]: patch } }, { merge: true }),
    writeAudit: (action, metadata) => tx.set(eventRef, { ...context, eventType: 'mutation', action,
      mapId, metadata: { ...metadata, mapId }, createdAt: serverTimestamp() }),
  }, edit));
}
