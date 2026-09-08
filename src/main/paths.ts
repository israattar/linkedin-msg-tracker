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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type StorageKind = 'onedrive' | 'local' | 'custom';

export interface StorageLocation {
  kind: StorageKind;
  // Folder holding contacts.json and the snapshots folder.
  dir: string;
  // True only when writes are genuinely reaching the cloud right now. A
  // OneDrive folder whose client is signed out or not running is still the
  // right place to write, but it is not a backup, and the difference has to
  // be visible.
  syncing: boolean;
  // Set when the preferred location could not be used, or when it was used
  // but is not actually protecting anything.
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

// Is the OneDrive client actually running? A folder can exist, be writable,
// and be sitting there completely unsynced because nothing is watching it.
// Checking for the folder alone reports a backup that is not happening.
function oneDriveRunning(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq OneDrive.exe', '/NH'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    return /OneDrive\.exe/i.test(out);
  } catch {
    return false;
  }
}

// Folders belonging to a signed-in OneDrive account. Signing out leaves the
// folder on disk, so this is what separates "still linked" from "an ordinary
// folder that used to be OneDrive".
function linkedOneDriveFolders(): string[] {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s', '/v', 'UserFolder'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((line) => /UserFolder\s+REG_SZ\s+(.+?)\s*$/i.exec(line)?.[1])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

type OneDriveState = 'syncing' | 'not-running' | 'not-linked';

function oneDriveState(root: string): OneDriveState {
  const linked = linkedOneDriveFolders();
  // No account claims this folder, so signing out has left an ordinary folder
  // behind and nothing will ever pick these writes up.
  if (linked.length > 0 && !linked.some((f) => samePath(f, root))) return 'not-linked';
  if (linked.length === 0) return 'not-linked';
  return oneDriveRunning() ? 'syncing' : 'not-running';
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
    if (usable(override)) {
      // A hand-picked folder might be synced by something, or nothing. The app
      // cannot tell, so it does not claim either way.
      return {
        kind: 'custom',
        dir: override,
        syncing: false,
        warning: null,
      };
    }
    return {
      kind: 'local',
      dir: appDataDir,
      syncing: false,
      warning: `The chosen data folder (${override}) could not be written to, so this machine is using local storage instead. Nothing is being backed up to the cloud.`,
    };
  }

  const oneDrive = oneDriveRoot();
  if (oneDrive) {
    const dir = join(oneDrive, FOLDER_NAME);
    if (!usable(dir)) {
      return {
        kind: 'local',
        dir: appDataDir,
        syncing: false,
        warning:
          'OneDrive was found but could not be written to, so this machine is using local storage instead. Nothing is being backed up to the cloud.',
      };
    }

    // Keep using the folder either way: the data already there belongs in it,
    // and splitting across two locations would be worse than not syncing. Say
    // plainly when it is not actually a backup.
    switch (oneDriveState(oneDrive)) {
      case 'syncing':
        return { kind: 'onedrive', dir, syncing: true, warning: null };
      case 'not-running':
        return {
          kind: 'onedrive',
          dir,
          syncing: false,
          warning:
            'OneDrive is signed in but not running, so changes are saved on this machine and will not reach the cloud until OneDrive starts. Open OneDrive from the Start menu.',
        };
      case 'not-linked':
        return {
          kind: 'onedrive',
          dir,
          syncing: false,
          warning:
            'This OneDrive folder is not linked to a signed-in account, so nothing in it is being backed up. Sign in to OneDrive and restart the app.',
        };
    }
  }

  return {
    kind: 'local',
    dir: appDataDir,
    syncing: false,
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
