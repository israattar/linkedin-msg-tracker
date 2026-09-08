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
    configured: apiKey.length > 0 && projectId.length > 0,
    envPath: resolveEnvPath(),
  };
}
