# Tidy: tasks and notes, focus more and scroll less

A mobile-first to-do list with a built-in notes feature, built from the *Tidy* UI designs in [`design/`](design). Plain HTML, CSS and JavaScript with no frameworks and no build step. Data is saved in your browser, so it works offline.

## Run it

```bash
npm start      # serves src/ at http://localhost:5173
npm test       # unit tests (Node's built-in test runner)
```

Node 18 or newer is the only requirement, and there is nothing to install. You can also serve the `src/` folder with any static server, or deploy it as-is to GitHub Pages, Netlify or Vercel.

## Core features (CRUD)

| | Tasks | Notes |
|---|---|---|
| **Create** | "Add a task or note…" bar, the + button, or press `n` | Compose button on Notes, the Note tab in quick capture, or "Jot a quick note" during focus |
| **View** | **Today** (overdue + today, "up next" card), **Tasks** (week strip, month calendar, tabs for All / In progress / Next / Done) | **Notes** list with Pinned / Recent sections and Lists / Ideas / Class filters |
| **Update** | Tap a task to edit the title, date, time, tag, priority, repeat, status and focus length. Tap the box to change status. | Edit the title, body and category in place (autosaves). Pin or unpin. Add, edit and remove checklist items. |
| **Delete** | Delete from the edit sheet, with an **Undo** toast | Delete from the ••• menu, with a confirmation dialog |

## Extra features

- **Smart quick capture.** Type naturally, e.g. `Revise design notes tomorrow 9pm every Monday #school !1`. Tidy picks out the date, time, repeat, tag and priority, and shows them as chips. Tap a chip to undo that part.
- **Note → tasks.** Select checklist items in a note and tap **Add to Today**. They become tasks linked back to the note ("In Today"), and ticking them off in either place stays in sync.
- **Focus sessions.** A timer ring for any task (15 to 90 min), with pause and resume, and "Mark done". Focused minutes are tracked.
- **Wind down.** An end-of-day review showing tasks done, time focused and what's still open. Tick what should move to tomorrow and close the day.
- **Repeating tasks.** Every day, weekday, week or a specific weekday. Completing one schedules the next.
- **Search** across tasks, notes and checklist items, with an empty state that offers to create the task or note you searched for.
- Offline banner, first-run welcome, a sample day to explore, and keyboard shortcuts (`n` for new, `/` for search, `Esc` to close).

## Project structure

```
src/
  index.html        page shell
  css/styles.css    design tokens + styles
  js/dates.js       date helpers (pure)
  js/parse.js       quick-capture parser (pure)
  js/store.js       state, mutations, persistence (no DOM)
  js/app.js         router, views, events
  js/icons.js       inline SVG icons
  fonts/            Figtree (self-hosted)
tests/              node:test unit tests for parser + store
scripts/serve.js    zero-dependency dev server
design/             reference screens from the Tidy UI kit
agents.md           rules for AI coding agents working on this repo
```

## AI agent instructions

[`agents.md`](agents.md) has the custom instructions, testing rules and formatting conventions that AI coding agents must follow in this repo.
