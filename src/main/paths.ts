// Where the data actually lives.
//
// The app prefers a OneDrive folder, because a file that only exists in
// AppData dies with the laptop. OneDrive syncs every write to the cloud
// within seconds and keeps its own version history, which is the only thing
// here that survives the machine being lost or stolen.
//
// Falling back to AppData is deliberate but never silent: the app reports
// which location it ended up in so the UI can say so plainly. A backup you
// think you have and do not is worse than no backup.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type StorageKind = 'onedrive' | 'local' | 'custom';

export interface StorageLocation {
  kind: StorageKind;
  // Folder holding contacts.json and the snapshots folder.
  dir: string;
  // Set when the preferred location could not be used, for the UI to show.
  warning: string | null;
}

const FOLDER_NAME = 'Outreach Tracker';
// Written into AppData, never into the data folder itself, so moving or
// losing the data folder cannot strand the app.
const OVERRIDE_FILE = 'data-location.json';

// Windows sets these when OneDrive is signed in. Personal accounts get
// OneDrive/OneDriveConsumer, work or school accounts get OneDriveCommercial.
function oneDriveRoot(): string | null {
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const value = process.env[key]?.trim();
    if (value && existsSync(value)) return value;
  }
  return null;
}

// A folder the app has explicitly been pointed at, if the user ever moves it.
function readOverride(appDataDir: string): string | null {
  try {
    const raw = readFileSync(join(appDataDir, OVERRIDE_FILE), 'utf8');
    const parsed = JSON.parse(raw) as { dir?: string };
    const dir = parsed.dir?.trim();
    return dir && dir.length > 0 ? dir : null;
  } catch {
    return null;
  }
}

export function writeOverride(appDataDir: string, dir: string | null): void {
  const file = join(appDataDir, OVERRIDE_FILE);
  writeFileSync(file, JSON.stringify({ dir }, null, 2), 'utf8');
}

// True only if the folder exists (or can be made) and a write actually lands.
// OneDrive can be present but unwritable, and finding that out at save time
// would mean losing the save.
function usable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.write-test');
    writeFileSync(probe, 'ok', 'utf8');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function resolveStorage(appDataDir: string): StorageLocation {
  const override = readOverride(appDataDir);
  if (override) {
    if (usable(override)) return { kind: 'custom', dir: override, warning: null };
    return {
      kind: 'local',
      dir: appDataDir,
      warning: `The chosen data folder (${override}) could not be written to, so this machine is using local storage instead. Nothing is being backed up to the cloud.`,
    };
  }

  const oneDrive = oneDriveRoot();
  if (oneDrive) {
    const dir = join(oneDrive, FOLDER_NAME);
    if (usable(dir)) return { kind: 'onedrive', dir, warning: null };
    return {
      kind: 'local',
      dir: appDataDir,
      warning: `OneDrive was found but could not be written to, so this machine is using local storage instead. Nothing is being backed up to the cloud.`,
    };
  }

  return {
    kind: 'local',
    dir: appDataDir,
    warning:
      'OneDrive is not set up on this machine, so data is stored locally and is not backed up anywhere. Sign in to OneDrive and restart the app to fix this.',
  };
}

// Bring an older local file across the first time a cloud folder is picked up,
// so switching machines or signing in to OneDrive never looks like data loss.
export function migrateExistingData(fromDir: string, toDir: string): boolean {
  if (fromDir === toDir) return false;
  const from = join(fromDir, 'contacts.json');
  const to = join(toDir, 'contacts.json');
  if (!existsSync(from) || existsSync(to)) return false;
  try {
    mkdirSync(toDir, { recursive: true });
    writeFileSync(to, readFileSync(from, 'utf8'), 'utf8');
    return true;
  } catch {
    return false;
  }
}
