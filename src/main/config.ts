// Reads Team Hub credentials from a .env file. The key never leaves the
// main process: the renderer has no network access to the Team Hub API.
//
// In dev, .env lives in the project root (the usual convention). In an
// installed build there is no project folder to read from, so credentials
// instead live in the app's per-user data folder (the same place contacts
// are stored), seeded on first run from the .env.example bundled with the
// installer, ready for the user to fill in.
import { app } from 'electron';
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import * as dotenv from 'dotenv';

function resolveEnvPath(): string {
  if (!app.isPackaged) return join(process.cwd(), '.env');

  const envPath = join(app.getPath('userData'), '.env');
  if (!existsSync(envPath)) {
    const bundledExample = join(process.resourcesPath, '.env.example');
    if (existsSync(bundledExample)) copyFileSync(bundledExample, envPath);
  }
  return envPath;
}

dotenv.config({ path: resolveEnvPath() });

// Team Hub sync is switched off deliberately: the tracker runs as a purely
// local app and every contact is entered by hand. The client, the sync
// service and the import path are all still here and still compiled; this
// flag is the only thing standing between them and the network.
//
// To reconnect: set this to false and make sure TEAMHUB_API_KEY and
// TEAMHUB_PROJECT_ID are in the .env described above. Nothing else changed,
// so cards created before the disconnect are still matched by task id.
const SYNC_ENABLED = false;

export interface AppConfig {
  apiKey: string;
  projectId: string;
  configured: boolean;
  envPath: string;
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.TEAMHUB_API_KEY?.trim() ?? '';
  const projectId = process.env.TEAMHUB_PROJECT_ID?.trim() ?? '';
  return {
    apiKey,
    projectId,
    // Credentials sitting in .env are ignored while sync is off, so leaving
    // the key in place does not quietly reconnect the app.
    configured: SYNC_ENABLED && apiKey.length > 0 && projectId.length > 0,
    envPath: resolveEnvPath(),
  };
}
