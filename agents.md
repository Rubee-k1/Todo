# agents.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository. Read this before making changes. If these rules conflict with a direct request from the user, follow the user and mention the conflict.

## Project at a glance

**Tidy** is a mobile-first to-do list with notes, built from the design files in `design/`.

| Path | What lives there |
|---|---|
| `src/index.html` | Single page shell. |
| `src/css/styles.css` | All styles. Design tokens are CSS variables on `:root`. |
| `src/js/dates.js` | Pure date helpers. Days are local `YYYY-MM-DD` strings. |
| `src/js/parse.js` | Pure quick-capture parser (`parseQuickAdd`), repeat rules. |
| `src/js/store.js` | App state and **every** mutation. No DOM access. |
| `src/js/app.js` | Router, view templates and event handling. |
| `src/js/icons.js` | Inline SVG icons. |
| `tests/*.test.js` | Unit tests (`node:test`). |
| `scripts/serve.js` | Zero-dependency static dev server. |
| `design/` | Reference screens (PNG). Treat as the source of truth for look and copy. |

## Hard rules

1. **No dependencies and no build step.** Vanilla ES modules only. Do not add npm packages, frameworks, bundlers or CDNs without the user's explicit approval. The app must run with `npm start`, and Node 18 or newer must be the only requirement.
2. **Layering.** `dates.js` and `parse.js` are pure. `store.js` may import them, never the DOM. `app.js` is the only file that touches `document` or `window`. Every data change goes through a store function. Never mutate `store.state` from `app.js`.
3. **Escape all user text.** Any string that came from the user (titles, bodies, tags, search queries) must go through `esc()` before it is put into a template string. No exceptions, including `aria-label` and `value` attributes.
4. **Persistence is backwards compatible.** State is saved in `localStorage` under `tidy:v1`. If you change the shape, keep old data loading (default missing fields) or bump the key with a migration. Never throw on bad or missing storage.
5. **Don't lose typing.** Re-rendering replaces the view's HTML. Text fields that update the store while the user types must use the existing quiet or debounced patterns (`suppressRender`, `pendingNoteSave`, `refreshCapture`) so focus, caret and unsaved text survive.
6. **Accessibility is not optional.** Tap targets are 44×44px or larger. Icon-only buttons need an `aria-label`. Toggles use `aria-pressed`, tabs use `role="tab"` and `aria-selected`, dialogs use `role="dialog"` or `alertdialog` with `aria-modal`. Keep text contrast at WCAG AA. Keep `:focus-visible` outlines.
7. **Destructive actions are recoverable.** Deleting a task shows an Undo toast. Deleting a note asks for confirmation first. Keep it that way for anything new.

## Code testing rules

- Run `npm test` before every commit. It must pass with zero failures. Never commit red tests, and never skip, delete or weaken a test just to get green.
- **Every change to `dates.js`, `parse.js` or `store.js` needs a test** in `tests/`. Bug fixes start with a failing test that reproduces the bug.
- Tests must be deterministic. Inject time (`createStore({ now: () => FIXED })`, `parseQuickAdd(text, FIXED)`) and use an in-memory storage object. Never depend on the real clock, time zone or `localStorage`.
- Name tests after behaviour ("completing a repeating task schedules the next one exactly once"), not after functions.
- For UI changes, also run the app (`npm start`, open http://localhost:5173) at a 390×844 viewport. Click through the flow you touched: create, edit, complete, delete plus undo, and reload to confirm it persisted. Check the browser console shows no errors. Say in your summary what you checked by hand.

## Formatting conventions

- 2-space indent, semicolons, single quotes, trailing commas in multi-line literals. Aim for 120 columns or fewer.
- `const` by default, `let` only when reassigned, never `var`. Use arrow functions for callbacks.
- camelCase for functions and variables, UPPER_SNAKE for module constants, kebab-case for CSS classes and `data-act` names.
- Event handling is delegated. Add a `data-act="name"` attribute and an entry in the `actions` map in `app.js`. Don't add inline `onclick` handlers or per-element listeners.
- Styles go in `styles.css` and use the tokens (`var(--green)`, `var(--muted)` and so on). Don't hard-code new colours when a token exists. Inline `style` is only for one-off layout tweaks.
- Comments explain *why*, not *what*. Keep the short header comment at the top of each module up to date.
- UI copy is sentence case, friendly and brief, matching `design/`. Use curly quotes (“ ”) around user content in messages, e.g. `“Call mum” deleted`.

## Commits

- One logical change per commit. Use a short imperative subject (`Add weekly repeat to quick capture`) and a body explaining why, if it isn't obvious.
- Don't commit `node_modules/`, screenshots, editor files or secrets.

## Definition of done

- [ ] `npm test` passes.
- [ ] New logic has tests.
- [ ] The UI flow was checked in the browser with no console errors.
- [ ] User text is escaped, and new controls are labelled and 44px or larger.
- [ ] README updated if behaviour, scripts or structure changed.
