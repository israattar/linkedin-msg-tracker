import type { TrackerApi } from '../../shared/types';

declare global {
  interface Window {
    // Injected by the preload script. Absent in a plain browser (see lib/api.ts).
    tracker?: TrackerApi;
  }
}

export {};
