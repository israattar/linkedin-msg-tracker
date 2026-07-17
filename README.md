# LinkedIn outreach tracker

A personal desktop app for tracking LinkedIn outreach through a sales
pipeline, with two-way sync to a Team Hub board. You read the LinkedIn
conversation and judge the outcome; the app handles everything downstream:
stage moves, date stamping, the Team Hub card, and follow-up reminders.

Reading or sending LinkedIn messages is deliberately out of scope: LinkedIn
has no API for personal inboxes and automating them breaks their terms of
service. The only LinkedIn data this app ever touches is the profile URL you
paste in.

## The pipeline

```
First msg -> Connected -> Second msg -> In conversation
          -> Meeting held -> Proposal sent -> Active client

Exits: Maybe later (follow-up after 1 month), Went cold, Not interested
```

Each contact is one card on the Team Hub board. A stage change moves the
card to the matching column, stamps today's date into the card description,
and (for "maybe later") sets the card's due date to the follow-up date.

## Pages

- **Focus** - the day's queue: overdue "maybe later" follow-ups and first
  messages with no reply for 7 days. One contact at a time; press 1-9 to
  pick an action, S to skip, Z to undo.
- **Reply** - everyone waiting on a message from you: people who accepted
  your connection (tick = second message sent, they advance) and anyone
  flagged as awaiting a reply (tick = replied, flag clears). Each row has an
  auto-saving draft box for half-written messages, with copy-to-clipboard.
  The flag sets itself whenever you record that someone messaged you.
- **Add** - paste a LinkedIn profile URL, the name is guessed from the URL
  slug (editable), add a website if they have one, and confirm whether the
  first message was sent.
- **All** - search and filter everyone, expand a row for the full history
  and actions, import the existing board, retry failed syncs, flag someone
  for the Reply page.
- **Analytics** - added/messaged counts (7, 10, 30 days), connections made
  (7, 30 days, all time), live counts per stage including "met, then went
  cold", the all-time conversion funnel, activity over a chosen range
  (past week, month, or custom dates) with a weekly chart, and derived
  rates: connection rate, conversation rate, close rate, average days to
  client.

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

`npm run dist` builds `release/Outreach Tracker Setup <version>.exe` — a
normal Windows installer with a Start Menu entry and a desktop shortcut, so
day-to-day use never needs a terminal.

Credentials work differently once installed: there is no project folder to
read `.env` from, so the app reads it from its own per-user data folder
(`%APPDATA%\linkedin-msg-tracker\.env`) instead — the same folder
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
| `src/renderer/` | The React UI: Focus, Add, and All pages. |

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

## Data

Contacts live in `contacts.json` under Electron's user data folder
(`%APPDATA%/linkedin-msg-tracker`). Team Hub credentials live in `.env`,
which is gitignored; never commit it, and rotate the key if it may have
been exposed.
