// Keeps the local contact list and the Team Hub board in step.
//
// Local state is the working copy and every change applies locally first, so
// the app stays fully usable when Team Hub is unreachable. Failed syncs mark
// the contact with an error and are reconciled later via retryFailed().
import type { Contact, ImportResult, RetryResult, Stage, SyncStatus } from '../shared/types';
import {
  messagesSentForSlotTitle,
  milestoneForSlotTitle,
  slotTitleRank,
  SYNCED_STAGES,
  STAGES,
  stageForSlotTitle,
} from '../shared/stages';
import { formatLogLine, isoDateToDueDateTime, todayIso } from '../shared/dates';
import { normaliseLinkedinUrl } from '../shared/linkedin';
import { TeamhubClient, type TeamhubTask } from './teamhub';
import { appendToContent, buildHtmlContent, extractUrls, htmlToText } from './html';
import type { AppConfig } from './config';
import type { Store } from './store';

const IMPORT_PAGE_SIZE = 50;

export class SyncService {
  private readonly client: TeamhubClient | null;
  private readonly envPath: string;
  private slotIdByStage = new Map<Stage, string>();
  private stageBySlotId = new Map<string, Stage>();
  // Kept so an import can read what a card's column was called, which is how
  // milestone columns and per-message columns are recognised.
  private slotTitleById = new Map<string, string>();
  private unmappedStages: Stage[] = [];
  private slotsLoaded = false;

  constructor(config: AppConfig) {
    this.client = config.configured
      ? new TeamhubClient(config.apiKey, config.projectId)
      : null;
    this.envPath = config.envPath;
  }

  status(errorCount: number): SyncStatus {
    if (!this.client) {
      return {
        configured: false,
        slotsMapped: false,
        unmappedStages: [],
        message: `Team Hub not configured. Add TEAMHUB_API_KEY and TEAMHUB_PROJECT_ID to ${this.envPath}.`,
        errorCount,
      };
    }
    if (!this.slotsLoaded) {
      return {
        configured: true,
        slotsMapped: false,
        unmappedStages: [],
        message: 'Connected. Columns are matched on first sync or import.',
        errorCount,
      };
    }
    const unmapped = this.unmappedStages.map((s) => STAGES[s].label);
    return {
      configured: true,
      slotsMapped: this.unmappedStages.length === 0,
      unmappedStages: unmapped,
      message:
        unmapped.length === 0
          ? 'Connected to the sales pipeline board.'
          : `Connected, but no board column found for: ${unmapped.join(', ')}.`,
      errorCount,
    };
  }

  // --- Contact-level operations -------------------------------------------

  // Create the Team Hub card for a contact entering the pipeline.
  async pushNewContact(contact: Contact): Promise<void> {
    await this.guarded(contact, async (client) => {
      const slotId = await this.requireSlot(contact.stage);
      const task = await client.createTask({
        title: contact.name,
        content: buildCardContent(contact),
        slotId,
      });
      contact.teamhubTaskId = task.id;
      // Some APIs ignore slotId on create; move if the card landed elsewhere.
      if (task.slotId && task.slotId !== slotId) {
        await client.moveTask(task.id, slotId);
      }
      if (contact.followUpDate) {
        await this.pushDueDate(client, contact);
      }
      contact.pendingLines = [];
    });
  }

  // Sync a stage change: move the card, append the new log line, update the
  // due date. The log line is appended to the card's *current* description so
  // manual edits made in Team Hub are preserved.
  async pushAction(contact: Contact, line: string): Promise<void> {
    // A contact without a card (an earlier create failed) gets one now.
    // pushNewContact records its own success or failure on the contact.
    if (!contact.teamhubTaskId) {
      await this.pushNewContact(contact);
      return;
    }
    await this.guarded(contact, async (client) => {
      const slotId = await this.requireSlot(contact.stage);
      await client.moveTask(contact.teamhubTaskId as string, slotId);

      const task = await client.getTask(contact.teamhubTaskId as string);
      const content = appendToContent(task.content ?? '', [line]);
      await client.updateTask(contact.teamhubTaskId as string, { content });
      contact.pendingLines = contact.pendingLines.filter((l) => l !== line);

      await this.pushDueDate(client, contact);
    });
  }

  // Best-effort undo on the Team Hub side: move the card back and remove the
  // log line that the undone action appended.
  async pushRevert(contact: Contact, removedLine: string): Promise<void> {
    await this.guarded(contact, async (client) => {
      if (!contact.teamhubTaskId) return;
      const slotId = await this.requireSlot(contact.stage);
      await client.moveTask(contact.teamhubTaskId, slotId);

      const task = await client.getTask(contact.teamhubTaskId);
      const content = (task.content ?? '').replace(`\n${removedLine}`, '');
      await client.updateTask(contact.teamhubTaskId, { content });

      await this.pushDueDate(client, contact);
    });
  }

  // Bring one contact fully in line with local state. Used by retry: it is
  // idempotent, so running it repeatedly is safe.
  async reconcile(contact: Contact): Promise<void> {
    if (contact.stage === 'draft') return;
    if (!contact.teamhubTaskId) {
      await this.pushNewContact(contact);
      return;
    }
    await this.guarded(contact, async (client) => {
      const slotId = await this.requireSlot(contact.stage);
      await client.moveTask(contact.teamhubTaskId as string, slotId);

      if (contact.pendingLines.length > 0) {
        const task = await client.getTask(contact.teamhubTaskId as string);
        const existing = task.content ?? '';
        const existingText = htmlToText(existing);
        const missing = contact.pendingLines.filter((l) => !existingText.includes(l));
        if (missing.length > 0) {
          await client.updateTask(contact.teamhubTaskId as string, {
            content: appendToContent(existing, missing),
          });
        }
      }
      contact.pendingLines = [];

      await this.pushDueDate(client, contact);
    });
  }

  async retryFailed(store: Store): Promise<RetryResult> {
    const failed = store
      .list()
      .filter((c) => c.sync.state === 'error' || (c.sync.state === 'local-only' && c.stage !== 'draft'));
    let fixed = 0;
    for (const contact of failed) {
      await this.reconcile(contact);
      if (contact.sync.state === 'synced') fixed += 1;
      store.upsert(contact);
    }
    return { fixed, remaining: failed.length - fixed };
  }

  // --- Import ---------------------------------------------------------------

  // Pull every card on the board into the local list. Existing links are
  // matched by task id first, then by LinkedIn URL; the board's stage wins.
  async importAll(store: Store): Promise<ImportResult> {
    if (!this.client) {
      return { ok: false, imported: 0, updated: 0, skipped: 0, message: 'Team Hub is not configured.' };
    }
    try {
      await this.loadSlots();
      const tasks = await this.fetchAllTasks(this.client);

      let imported = 0;
      let updated = 0;
      let skipped = 0;

      for (const task of tasks) {
        const stage = task.slotId ? (this.stageBySlotId.get(task.slotId) ?? null) : null;
        if (!stage) {
          skipped += 1;
          continue;
        }
        // The column title still carries meaning the stage alone has lost:
        // "Meeting held" is a milestone now, "Second msg" a message count.
        const slotTitle = (task.slotId ? this.slotTitleById.get(task.slotId) : '') ?? '';
        const milestone = milestoneForSlotTitle(slotTitle);

        const existing = this.matchExisting(store, task);
        if (existing) {
          existing.teamhubTaskId = task.id;
          // Refresh the readable copy of the card description and fill in
          // any URLs that an earlier import missed.
          existing.importedNotes = htmlToText(task.content ?? '');
          if (!existing.linkedinUrl) existing.linkedinUrl = extractLinkedinUrl(task.content ?? '');
          if (!existing.websiteUrl) existing.websiteUrl = extractWebsiteUrl(task.content ?? '');
          if (milestone === 'meeting') existing.meetingHeldDate ??= todayIso();
          if (milestone === 'proposal') existing.proposalSentDate ??= todayIso();
          if (existing.stage !== stage) {
            existing.stage = stage;
            existing.followUpDate = stage === 'maybe-later' ? (existing.followUpDate ?? todayIso()) : null;
            existing.updatedAt = new Date().toISOString();
            updated += 1;
          }
          existing.sync = { state: 'synced' };
          store.upsert(existing);
          continue;
        }

        store.upsert(contactFromTask(task, stage, slotTitle));
        imported += 1;
      }

      const parts = [`Imported ${imported}`, `updated ${updated}`];
      if (skipped > 0) parts.push(`skipped ${skipped} in unrecognised columns`);
      return { ok: true, imported, updated, skipped, message: `${parts.join(', ')}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, imported: 0, updated: 0, skipped: 0, message: `Import failed: ${message}` };
    }
  }

  // --- Internals ------------------------------------------------------------

  // Run a sync step and record the outcome on the contact instead of throwing,
  // so a network failure never blocks the local workflow.
  private async guarded(
    contact: Contact,
    step: (client: TeamhubClient) => Promise<void>,
  ): Promise<void> {
    if (!this.client) {
      contact.sync = { state: 'local-only' };
      return;
    }
    try {
      await step(this.client);
      contact.sync = { state: 'synced' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      contact.sync = { state: 'error', message };
    }
  }

  private async requireSlot(stage: Stage): Promise<string> {
    await this.loadSlots();
    const slotId = this.slotIdByStage.get(stage);
    if (!slotId) {
      throw new Error(`No Team Hub column matches the "${STAGES[stage].label}" stage.`);
    }
    return slotId;
  }

  private async loadSlots(): Promise<void> {
    if (!this.client || this.slotsLoaded) return;
    const slots = await this.client.getSlots();

    this.slotIdByStage.clear();
    this.stageBySlotId.clear();
    this.slotTitleById.clear();

    // Several old column titles now fold into one stage, so a board can offer
    // more than one match. Moves go to the best-named column (rank 0 is the
    // stage's own title); reads still recognise every one of them.
    const best = new Map<Stage, number>();
    for (const slot of slots) {
      const stage = stageForSlotTitle(slot.title);
      if (!stage) continue;
      this.stageBySlotId.set(slot.id, stage);
      this.slotTitleById.set(slot.id, slot.title);

      const rank = slotTitleRank(stage, slot.title) ?? Number.MAX_SAFE_INTEGER;
      if (rank < (best.get(stage) ?? Number.MAX_SAFE_INTEGER)) {
        best.set(stage, rank);
        this.slotIdByStage.set(stage, slot.id);
      }
    }
    this.unmappedStages = SYNCED_STAGES.filter((s) => !this.slotIdByStage.has(s));
    this.slotsLoaded = true;
  }

  // The due date mirrors the follow-up reminder; a failure here is recorded
  // but deliberately does not fail the whole sync step.
  private async pushDueDate(client: TeamhubClient, contact: Contact): Promise<void> {
    if (!contact.teamhubTaskId) return;
    const dueDate = contact.followUpDate ? isoDateToDueDateTime(contact.followUpDate) : null;
    try {
      await client.updateTask(contact.teamhubTaskId, { dueDate });
    } catch (error) {
      console.warn('Could not update Team Hub due date:', error);
    }
  }

  // Page through all tasks. The spec does not say whether pages start at 0 or
  // 1, so this walks forward from 0 and de-duplicates by task id.
  private async fetchAllTasks(client: TeamhubClient): Promise<TeamhubTask[]> {
    const seen = new Map<string, TeamhubTask>();
    let page = 0;
    for (;;) {
      let batch: TeamhubTask[];
      try {
        batch = await client.listTasks(page, IMPORT_PAGE_SIZE);
      } catch (error) {
        if (page === 0) {
          page = 1;
          continue;
        }
        throw error;
      }
      if (!Array.isArray(batch) || batch.length === 0) {
        if (page === 0 && seen.size === 0) {
          page = 1;
          continue;
        }
        break;
      }
      const before = seen.size;
      for (const task of batch) seen.set(task.id, task);
      if (seen.size === before) break; // page repeated: end reached
      page += 1;
    }
    return [...seen.values()];
  }

  private matchExisting(store: Store, task: TeamhubTask): Contact | null {
    const byId = store.findByTeamhubTaskId(task.id);
    if (byId) return byId;

    const url = extractLinkedinUrl(task.content ?? '');
    if (!url) return null;
    const key = normaliseLinkedinUrl(url);
    return (
      store.list().find((c) => c.linkedinUrl && normaliseLinkedinUrl(c.linkedinUrl) === key) ?? null
    );
  }
}

// --- Pure helpers -----------------------------------------------------------

// Description written when the app creates a card, as HTML paragraphs so it
// renders cleanly in Team Hub. Imported cards keep their original content
// and only ever have lines appended.
export function buildCardContent(contact: Contact): string {
  const lines = [contact.linkedinUrl];
  if (contact.websiteUrl) lines.push(`Website: ${contact.websiteUrl}`);
  lines.push(...contact.history.map(formatLogLine));
  return buildHtmlContent(lines);
}

function extractLinkedinUrl(content: string): string {
  return extractUrls(content).find((url) => /linkedin\.com/i.test(url)) ?? '';
}

function extractWebsiteUrl(content: string): string {
  return extractUrls(content).find((url) => !/linkedin\.com/i.test(url)) ?? '';
}

function contactFromTask(task: TeamhubTask, stage: Stage, slotTitle: string): Contact {
  const content = task.content ?? '';
  const now = new Date().toISOString();
  const today = todayIso();
  const followUpDate =
    stage === 'maybe-later'
      ? task.dueDate
        ? task.dueDate.slice(0, 10)
        : today
      : null;
  const milestone = milestoneForSlotTitle(slotTitle);

  return {
    id: crypto.randomUUID(),
    teamhubTaskId: task.id,
    name: task.title?.trim() || 'Unnamed contact',
    linkedinUrl: extractLinkedinUrl(content),
    websiteUrl: extractWebsiteUrl(content),
    stage,
    // An imported card has clearly been messaged; a per-message column says
    // how many times. The timers start from the import rather than pretending
    // to know when the last message actually went out.
    messagesSent: stage === 'awaiting-reply' ? messagesSentForSlotTitle(slotTitle) : 1,
    lastMessageDate: today,
    meetingHeldDate: milestone === 'meeting' ? today : null,
    proposalSentDate: milestone === 'proposal' ? today : null,
    followUpDate,
    history: [{ date: today, text: 'Imported from Team Hub', stage }],
    pendingLines: [],
    importedNotes: htmlToText(content),
    notes: '',
    needsReply: false,
    draft: '',
    sync: { state: 'synced' },
    createdAt: now,
    updatedAt: now,
  };
}
