import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, safeStorage, session, powerMonitor } from 'electron';
import { createRuntime } from './lifecycle.js';
import { startLocalApi } from './app/server.js';
import { createWindow } from './window.js';
import { hardenSession } from './hardening.js';
import { MESSAGES, UI_HOST, UI_PORT } from '../config/constants.js';
const here = path.dirname(fileURLToPath(import.meta.url));
let runtime = null;
let api = null;
let window = null;
let quitting = false;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(boot).catch(fatal);
}
function fatal(error) {
  dialog.showErrorBox('DTP2P', error?.code === 'EADDRINUSE' ? MESSAGES.PORT_BUSY : 'The application cannot start.');
  app.exit(1);
}
async function boot() {
  hardenSession(session.defaultSession);
  const dataDir = path.join(app.getPath('appData'), 'DTP2P');
  runtime = await createRuntime({ dataDir, safeStorage });
  api = await startLocalApi({ runtime, uiDir: path.join(here, '..', 'ui'), secureStorageAvailable: runtime.secrets.available });
  window = createWindow({ launchUrl: `http://${UI_HOST}:${UI_PORT}/?launch=${api.launchToken}`, packaged: app.isPackaged });
  window.on('closed', () => {
    window = null;
  });
  powerMonitor.on('resume', () => runtime.onResume());
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting || !runtime) return;
  event.preventDefault();
  quitting = true;
  Promise.resolve(runtime.shutdown())
    .catch(() => {})
    .finally(() => api?.close().finally(() => app.exit(0)));
});
