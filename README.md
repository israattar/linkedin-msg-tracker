# LinkedIn outreach tracker

A personal desktop app for tracking LinkedIn outreach through a sales
pipeline. You read the LinkedIn conversation and judge the outcome; the app
handles everything downstream: stage moves, date stamping, and follow-up
reminders.

> **Team Hub sync is currently switched off.** The app runs entirely on this
> machine and every contact is entered by hand. The Team Hub client, the sync
> service and the import path are all still in the codebase and still
> compiled; `SYNC_ENABLED` in `src/main/config.ts` is the single switch. Set
> it back to `true`, put `TEAMHUB_API_KEY` and `TEAMHUB_PROJECT_ID` in `.env`,
> and everything below about syncing applies again.

Reading or sending LinkedIn messages is deliberately out of scope: LinkedIn
has no API for personal inboxes and automating them breaks their terms of
service. The only LinkedIn data this app ever touches is the profile URL you
paste in.

## The pipeline

```
Draft -> Awaiting reply -> In conversation -> Active client

Exits: No response (three messages, still silence), Maybe later (follow up
       in 1 week, 2 weeks, 1 month or a date you pick), Went cold,
       Not interested
```

Three things deliberately are **not** stages:

- **Messages are a counter.** "First message" and "second message" are the
  same queue at different points, so a contact awaiting a reply carries the
  number of messages sent instead of moving between stages.
- **Meetings and proposals are milestones.** They are dated flags on a
  contact, so one person can have held a meeting *and* been sent a proposal
  and still read as "In conversation" everywhere.
- **Connections are a tally.** At fifty a day nobody wants a card each, so
  the Connected page counts them per day and never ties them to a contact.

Each contact is one card on the Team Hub board. A stage change moves the
card to the matching column, stamps today's date into the card description,
and (for "maybe later") sets the card's due date to the follow-up date.

Choosing "maybe later" asks when the contact should come back: one of the
preset timeframes (a month is the default) or any date from the calendar,
each shown with the date it resolves to. That date is stored on the contact,
written into their log line and Team Hub due date, and brings them back into
the Focus queue on the day it falls due.

### The chase cadence

Silence is measured from the last message you sent. Nothing moves on its
own: a timer surfaces the contact in Focus and Reply with the move
pre-selected as one keypress, and it stays put until you press it.

| Situation | After | What appears |
| --- | --- | --- |
| First message, no reply | 3 days | Send the second |
| Second message, no reply | 7 days | Send the final |
| Final message, no reply | 7 days | Move to **No response** |
| In conversation, gone quiet | 3 days | Follow up, or **Went cold** |
| "Maybe later" date arrives | - | Pick up the conversation |

From **No response** and **Went cold**, a contact can be moved to Not
interested by hand, or back into the conversation if they resurface.

## Pages

- **Focus** - the day's queue: everything above except "they are waiting on
  your reply", which belongs to Reply. One contact at a time; press 1-9 to
  pick an action, S to skip, Z to undo. The move a timer suggests is
  highlighted rather than reordered, so the number keys stay put.
- **Reply** - everyone owed a message from you: people who wrote to you
  (tick = messaged them back), people whose last message went unanswered
  long enough to chase (tick = logs the next message), and conversations
  that have gone quiet (tick = follow-up sent). Each row has an auto-saving
  draft box for half-written messages, with copy-to-clipboard.
- **In conversation** - everyone who replied, in four overlapping sections:
  must respond to, awaiting response, held a meeting, sent a proposal. The
  same person appears in every section that fits them.
- **Connected** - the daily connection tally: one big button (or the space
  bar) per connection, today's count against the 50-a-day goal, a bar chart
  per date with the goal line, totals against the previous stretch, best
  day, days at goal and the current streak. Click any bar to correct that
  day's count.
- **Add** - paste a LinkedIn profile URL, the name is guessed from the URL
  slug (editable), add a website if they have one, notes if you have any,
  and confirm whether the first message was sent.
- **All** - search and filter everyone, click a row for the full history,
  notes and actions, flag someone for the Reply page, delete a contact.
  Deleting is reversible: it moves the contact to **Recently deleted**, which
  has its own filter chip, and an Undo appears straight after. The Data and
  backups panel at the bottom shows where the file is saved and exports or
  restores a copy.
- **Analytics** - people messaged (7, 10, 30 days), connections made (7, 30
  days, all time), live counts per stage including "met, then went cold",
  the all-time funnel (messaged, replied, meeting, proposal, client),
  activity over a chosen range with a weekly chart, and derived rates:
  reply rate, meeting rate, close rate, messages needed to get a reply,
  average days to client.

A native Windows notification fires once a day when follow-ups are due.
If the laptop was off, nothing is lost: the queue waits in the Focus tab.

## Setup

```
npm install
copy .env.example .env    (then fill in your key and project id)
npm run dev
```

- `npm run dev` - run the app with hot reload, for active development
- `npm run start` - run the last production build, no dev server
- `npm run build` - production build into out/
- `npm run dist` - build a proper Windows installer (see below)
- `npm run typecheck` - strict TypeScript check of all three processes
- `npx vite --config vite.preview.config.ts` - browser-only UI preview
  using mock data (no Electron, no network)

## Installing it as a real app

`npm run dist` builds `release/Outreach Tracker Setup <version>.exe`, a
normal Windows installer with a Start Menu entry and a desktop shortcut, so
day-to-day use never needs a terminal.

Credentials work differently once installed: there is no project folder to
read `.env` from, so the app reads it from its own per-user data folder
(`%APPDATA%\linkedin-msg-tracker\.env`) instead, the same folder
`contacts.json` already lives in. On first launch this file is seeded
(empty) from the bundled `.env.example`; fill it in there, or copy an
existing `.env` into that folder, then restart the app.

Rebuilding after a code change means running `npm run dist` again and
reinstalling; the installer overwrites the previous version in place.

## Architecture

| Path | Role |
| --- | --- |
| `src/shared/` | Data model, pipeline definitions, date and URL helpers. Used by all three processes. |
| `src/main/` | Electron main process: JSON persistence, the Team Hub client, sync logic, reminders. |
| `src/preload/` | The typed bridge (`window.tracker`) between renderer and main. |
| `src/renderer/` | The React UI: Focus, Reply, In conversation, Connected, Add, All and Analytics pages. |

Key decisions:

- **Local first.** Every change applies to the local store immediately and
  syncs afterwards; a network failure marks the contact with a sync error
  that "Retry sync" reconciles. The app is fully usable offline.
- **The API key stays in the main process.** The renderer has no network
  access to Team Hub (its CSP allows no external hosts) and only talks
  through the typed IPC bridge.
- **Scoped to one board.** Every Team Hub call is under
  `/project/{TEAMHUB_PROJECT_ID}/`; the client has no code for hubs, users,
  chat, or other projects, and no delete method at all.
- **Descriptions are append-only and HTML-aware.** Team Hub stores card
  descriptions as rich text; the app appends log lines as paragraphs,
  displays imported notes as plain text, and never overwrites notes typed
  manually in Team Hub.
- **Column matching is by name.** On first sync the board's columns are
  matched to stages by normalised title ("First Msg", "first msg", and
  "1st msg" all match). Renaming a column to something unrecognisable shows
  a "columns missing" warning rather than guessing.
- **Retired columns still map.** The old per-message and connection columns
  fold into Awaiting reply, and the meeting and proposal columns into In
  conversation, so an existing board keeps working: cards import to the
  right stage, and a card sitting in "Meeting held" keeps that milestone.
  Moves go to the best-named column when a board offers several matches.
  Adding "Awaiting reply" and "No response" columns clears the warning.
- **One set of cadence rules.** `src/shared/cadence.ts` decides who is due
  what; Focus, Reply and the browser preview all read it, so they cannot
  drift apart.
- **Two colours, one meaning each.** Lime (`#B9D432`) is progress: actions,
  good numbers, the suggested move, the daily tally. Pink (`#EC1B7C`) is
  heat: someone waiting on a reply, and moves that cannot be taken back.
  Everything else is charcoal (`#333333`) and grey (`#848484`). A colour that
  means two things means nothing, so new colours need a new job first. Tokens
  live at the top of `src/renderer/src/theme.css`.

## Data and backups

Everything the app knows lives in one file, `contacts.json`: contacts, the
Recently deleted bin, and the connection tally. It carries a version number
and upgrades itself on load (v4 retired the per-message and milestone stages,
v5 added the bin and snapshots).

### Where that file goes

On startup the app picks a folder, in this order:

1. A folder named in `data-location.json` in AppData, if one has been set.
2. `%OneDrive%\Outreach Tracker\`, if OneDrive is signed in and writable.
3. `%APPDATA%\linkedin-msg-tracker\`, as a fallback.

OneDrive is preferred because a file that only exists in AppData dies with
the laptop. If the app ends up on the fallback it says so in a banner across
the top of every page, because a backup you think you have and do not is
worse than no backup at all. The All page shows the exact path it is writing
to, with an **Open folder** button.

The first time it picks up a cloud folder, an existing AppData file is copied
across, so signing in to OneDrive later never looks like data loss.

### Three layers of protection

| Layer | What it covers | Where it lives |
| --- | --- | --- |
| Recently deleted | A contact deleted by mistake. Kept indefinitely, restored with one click | Inside `contacts.json` |
| Daily snapshots | A bad save, a bulk mistake, anything you want to roll back past. Last 10 days | `snapshots/` beside the data file |
| OneDrive sync | The laptop dying, being stolen, or ransomware | Microsoft's servers, plus 30 days of OneDrive version history |
| Export a copy | Anything at all, on your terms | Wherever you save it |

Snapshots are taken once a day, on the first launch of that day, before
anything can change the data. Writes are atomic (temp file, then rename), so
a crash halfway through a save cannot corrupt the file.

**Restore** reads an exported file back in and replaces everything, so it
asks first. The day's snapshot is already on disk, so even that is
reversible.

### Setting this up on a new machine

1. Sign in to OneDrive and let it finish its first sync.
2. Install the app and open it.
3. Go to **All** and check the **Data and backups** panel. It should say
   *Backed up to OneDrive* and show a path inside your OneDrive folder.
4. If a pink banner says **Not backed up**, OneDrive was not available. Fix
   OneDrive, then restart the app.
5. Optional: right click the `Outreach Tracker` folder in OneDrive and choose
   **Always keep on this device**, so the file is local as well as in the
   cloud.

Team Hub credentials live in `.env`, which is gitignored; never commit it,
and rotate the key if it may have been exposed. Sync is currently off, so
that file is unused.
