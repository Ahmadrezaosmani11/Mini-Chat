import { BrowserWindow } from 'electron';
import { hardenWebContents } from './hardening.js';

export function createWindow({ launchUrl, packaged }) {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'DTP2P',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !packaged,
    },
  });
  hardenWebContents(win.webContents, { packaged });
  win.once('ready-to-show', () => win.show());
  win.loadURL(launchUrl);
  return win;
}
