// Electron entry point: window, app lifecycle, and the hourly reminder tick.
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { loadConfig } from './config';
import { Store } from './store';
import { SyncService } from './sync';
import { registerIpc } from './ipc';
import { checkAndNotify } from './notify';
import { migrateExistingData, resolveStorage } from './paths';

const REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    show: false,
    // Matches --bg in theme.css, so there is no flash of another colour
    // before the renderer paints.
    backgroundColor: '#232320',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // All external links (LinkedIn profiles, websites) open in the default
  // browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.israattar.linkedin-msg-tracker');

    // Data prefers a OneDrive folder over AppData so it survives this
    // machine. An older AppData file is copied across the first time.
    const appDataDir = app.getPath('userData');
    const storage = resolveStorage(appDataDir);
    migrateExistingData(appDataDir, storage.dir);

    const store = await Store.open(storage.dir);
    const sync = new SyncService(loadConfig());
    registerIpc(store, sync, storage);
    createWindow();

    const runReminderCheck = (): void => checkAndNotify(store, () => mainWindow);
    runReminderCheck();
    setInterval(runReminderCheck, REMINDER_CHECK_INTERVAL_MS);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
