// Daily reminder: one native notification per day when follow-ups are due.
// If the laptop was off, the queue simply waits in the Focus tab instead.
import { Notification, type BrowserWindow } from 'electron';
import { todayIso } from '../shared/dates';
import type { Store } from './store';
import { buildQueue } from './ipc';

export function checkAndNotify(store: Store, getWindow: () => BrowserWindow | null): void {
  if (!Notification.isSupported()) return;

  const today = todayIso();
  if (store.lastNotifiedDate === today) return;

  const queueSize = buildQueue(store.list()).length;
  if (queueSize === 0) return;

  const notification = new Notification({
    title: 'Outreach follow-ups',
    body:
      queueSize === 1
        ? '1 person needs a follow-up today.'
        : `${queueSize} people need a follow-up today.`,
  });

  notification.on('click', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('nav:focus');
  });

  notification.show();
  store.lastNotifiedDate = today;
}
