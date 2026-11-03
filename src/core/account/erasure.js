import fs from 'node:fs';
import path from 'node:path';
import { wipeDatabaseFiles } from '../db/database.js';

export const wipeMarker = (dataDir) => path.join(dataDir, 'wipe.pending');
export const hasPendingWipe = (dataDir) => fs.existsSync(wipeMarker(dataDir));
export function finishPendingWipe({ dataDir, secrets }) {
  secrets.destroy();
  wipeDatabaseFiles(dataDir);
  fs.rmSync(wipeMarker(dataDir), { force: true });
}
export async function eraseInstallation({ dataDir, db, secrets, stopServices }) {
  fs.writeFileSync(wipeMarker(dataDir), String(Date.now()));
  await stopServices();
  secrets.destroy();
  try {
    db.exec('UPDATE local_identity SET private_key_blob = zeroblob(length(private_key_blob))');
  } catch {
    /* table may already be empty */
  }
  await db.eraseAndReopen();
  fs.rmSync(wipeMarker(dataDir), { force: true });
}
