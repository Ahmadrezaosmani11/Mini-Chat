import { UI_HOST, UI_PORT } from '../config/constants.js';

const ORIGIN = `http://${UI_HOST}:${UI_PORT}`;
export function hardenSession(session) {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
export function hardenWebContents(contents, { packaged }) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  if (packaged) contents.on('devtools-opened', () => contents.closeDevTools());
}
