// UI layer: hash router, view templates and event handling.
// All data changes go through the store; views are re-rendered from state.

import { createStore, TAGS, NOTE_CATEGORIES, tagColor } from './store.js';
import { parseQuickAdd, repeatLabel, PRIORITY_LABELS } from './parse.js';
import {
  dayKey, fromKey, addDays, weekOf, formatTime, relativeDay, shortDate, longDate,
  monthYear, weekdayName, greeting, timeAgo,
} from './dates.js';
import { icon } from './icons.js';

const store = createStore({ storage: safeStorage() });

function safeStorage() {
  try {
    const k = '__tidy_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------- UI state (not persisted) ----------
const ui = {
  route: 'today',
  param: null,
  selectedDay: store.today(),
  tab: 'all',
  monthOpen: false,
  noteFilter: 'All',
  noteSelection: new Set(),
  menuOpen: false,
  searchQuery: '',
  searchScope: 'all',
  skipped: new Set(),
  windSel: null,
  sheet: null,
  dialog: null,
  toast: null,
  online: navigator.onLine,
};

// Focus session lives outside `ui` so it survives navigation.
const focus = {
  taskId: null, minutes: 25, running: false, startedAt: 0, elapsedMs: 0, finished: false, active: false,
};

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let suppressRender = false;

// ---------- Routing ----------
function parseHash() {
  const [, route = 'today', param = null] = (location.hash || '#/today').split('/');
  ui.route = route || 'today';
  ui.param = param ? decodeURIComponent(param) : null;
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => {
  const prev = ui.route + ui.param;
  parseHash();
  if (prev !== ui.route + ui.param) {
    ui.menuOpen = false;
    ui.noteSelection.clear();
    ui.windSel = null;
    viewScroll = 0;
  }
  render();
});

store.subscribe(() => { if (!suppressRender) render(); });
window.addEventListener('online', () => { ui.online = true; render(); });
window.addEventListener('offline', () => { ui.online = false; render(); });

// ---------- Shared bits ----------
const NAV = [
  ['today', 'Today', 'home'], ['tasks', 'Tasks', 'list'], ['focus', 'Focus', 'timer'],
  ['notes', 'Notes', 'note'], ['winddown', 'Wind down', 'moon'],
];

function nav() {
  const active = ui.route === 'note' ? 'notes' : ui.route;
  return `<nav class="nav" aria-label="Main">${NAV.map(([r, label, ic]) =>
    `<a href="#/${r}" ${active === r ? 'aria-current="page"' : ''}>${icon(ic, { size: 22 })}${label}</a>`).join('')}</nav>`;
}

function box(task) {
  if (task.status === 'done') return `<span class="box done">${icon('check', { size: 13, color: '#fff', width: 3 })}</span>`;
  if (task.status === 'progress') return '<span class="box progress"></span>';
  return '<span class="box"></span>';
}

function whenLabel(task, today) {
  const parts = [];
  if (task.due && task.due !== today) parts.push(relativeDay(task.due, today));
  if (task.time) parts.push(formatTime(task.time));
  return parts.join(', ');
}

const STATUS_NAME = { todo: 'To do', progress: 'In progress', done: 'Done' };

/** Row used on Tasks, Search and Focus: checkbox cycles status. */
function taskRow(task, { toggleOnly = false } = {}) {
  const today = store.today();
  const late = task.status !== 'done' && task.due && task.due < today;
  const meta = [task.tag, whenLabel(task, today) || (task.due === today ? 'Today' : '')].filter(Boolean).join(' · ');
  const act = toggleOnly ? 'toggle' : 'cycle';
  const label = toggleOnly
    ? `${task.status === 'done' ? 'Mark not done' : 'Mark done'}: ${task.title}`
    : `${task.title}: ${STATUS_NAME[task.status]}. Change status`;
  return `<div class="row-item">
    <button class="check" data-act="${act}" data-id="${task.id}" aria-label="${esc(label)}">${box(task)}</button>
    <button class="row-main" data-act="edit" data-id="${task.id}">
      <div class="row-title ${task.status === 'done' ? 'done' : ''}">${esc(task.title)}${task.priority === 3 ? ' <span class="flag" aria-label="High priority">!</span>' : ''}</div>
      ${meta || task.repeat ? `<div class="row-meta ${late ? 'bad' : ''}">${task.tag ? `<span class="dot" style="background:${tagColor(task.tag)}"></span>` : ''}${esc(meta)}${task.repeat ? ` ${icon('repeat', { size: 13 })}` : ''}</div>` : ''}
    </button>
  </div>`;
}

/** Compact row used on Today: checkbox toggles done. */
function todayRow(task) {
  const today = store.today();
  const late = task.status !== 'done' && task.due < today;
  const side = task.status === 'done' ? 'Done' : late ? 'Overdue' : task.status === 'progress' ? 'In progress' : formatTime(task.time);
  return `<div class="row-item compact">
    <button class="check" data-act="toggle" data-id="${task.id}" aria-label="${task.status === 'done' ? 'Mark not done' : 'Mark done'}: ${esc(task.title)}">${box(task)}</button>
    <button class="row-main" data-act="edit" data-id="${task.id}"><div class="row-title ${task.status === 'done' ? 'done' : ''}">${esc(task.title)}</div></button>
    ${side ? `<span class="row-side ${late ? 'bad' : ''}">${side}</span>` : ''}
  </div>`;
}

function section(title, body, count = '', countClass = '') {
  return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${count !== '' ? `<span class="count ${countClass}">${count}</span>` : ''}</div>${body}</section>`;
}

function emptyState({ ic, title, text, actions = '' }) {
  return `<div class="empty"><div class="ico">${icon(ic, { size: 30, color: 'var(--green)' })}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function itemsLeft(note) {
  return note.items.filter((i) => {
    const t = i.taskId && store.findTask(i.taskId);
    return !(t && t.status === 'done');
  }).length;
}

// ---------- Views ----------
function viewWelcome() {
  return `<main class="welcome">
    <div>
      <div class="brand">tidy<span>.</span></div>
      <h1>Focus more.<br>Scroll less.</h1>
      <p>Tasks and notes in one calm place, with a timer that keeps you on the one thing that matters.</p>
      <div class="hero">
        <div>${icon('check', { color: 'var(--green)' })} Capture tasks in plain words</div>
        <div>${icon('note', { color: 'var(--green)' })} Turn notes into today's tasks</div>
        <div>${icon('timer', { color: 'var(--green)' })} Focus sessions and a calm wind-down</div>
      </div>
    </div>
    <form data-form="welcome">
      <label for="name">What should we call you?</label>
      <input id="name" name="name" autocomplete="given-name" placeholder="Your first name" maxlength="40" required>
      <button class="btn primary block" type="submit">Get started</button>
    </form>
  </main>`;
}

function viewToday() {
  const now = new Date();
  const { list, doneCount, total, upNext: rawNext } = store.todaySummary();
  let upNext = rawNext;
  if (upNext && ui.skipped.has(upNext.id)) {
    upNext = store.tasksOn(store.today()).find((t) => t.status !== 'done' && !ui.skipped.has(t.id)) || null;
  }
  const recentNote = [...store.state.notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const isBlank = store.state.tasks.length === 0 && store.state.notes.length === 0;

  let body;
  if (total === 0) {
    body = emptyState({
      ic: 'sun', title: 'Your day is clear',
      text: 'Add the first thing you want to get done today. Tidy will keep it in front of you.',
      actions: `<button class="btn primary block" data-act="capture">${icon('plus')} Add a task</button>
        ${isBlank ? '<button class="btn block" data-act="sample">Start with a sample day</button>' : ''}`,
    });
  } else {
    const hero = doneCount === total
      ? `<section class="now" aria-label="All done">
          <div><div class="label">All done</div><div class="title">You cleared today 🎉</div>
          <div class="meta">${total} ${total === 1 ? 'task' : 'tasks'} finished. Close the day when you're ready.</div></div>
          <div class="row"><a class="btn light grow" href="#/winddown">${icon('moon', { size: 18 })} Wind down</a></div>
        </section>`
      : upNext ? `<section class="now" aria-labelledby="now-label">
          <div><div class="label" id="now-label">${upNext.status === 'progress' ? 'In progress' : 'Up next'}${upNext.time ? ` · ${formatTime(upNext.time)}` : ''}</div>
          <div class="title">${esc(upNext.title)}</div>
          <div class="meta">${esc([upNext.tag, `${upNext.duration || 25} minutes`].filter(Boolean).join(' · '))}</div></div>
          <div class="row"><button class="btn light grow" data-act="focus-task" data-id="${upNext.id}">${icon('play', { size: 18 })} Start focus</button>
          <button class="btn ghost-light" data-act="later" data-id="${upNext.id}">Later</button></div>
        </section>` : '';
    body = `${hero}
      ${section('Today', `<div class="card">${list.map(todayRow).join('')}</div>`, `${doneCount} of ${total} done`)}`;
  }

  const resume = recentNote ? section('Continue writing', `<a class="link-card" href="#/note/${recentNote.id}">
      <span class="ico">${icon('note', { size: 19, color: 'var(--green)' })}</span>
      <span class="grow"><span class="t">${esc(recentNote.title)}</span><span class="s">Edited ${timeAgo(recentNote.updatedAt, Date.now())}${recentNote.items.length ? ` · ${itemsLeft(recentNote)} items left` : ''}</span></span>
      ${icon('chevronRight', { size: 18, color: 'var(--muted)' })}</a>`) : '';

  return `<header class="head">
      <div><div class="eyebrow">${longDate(now)}</div><h1>${greeting(now)}${store.state.profile.name ? `, ${esc(store.state.profile.name)}` : ''}</h1></div>
      <div class="actions"><a class="icon-btn" href="#/search" aria-label="Search">${icon('search')}</a></div>
    </header>
    <div class="stack">
      <button class="capture" data-act="capture">${icon('plus', { color: 'var(--green)', width: 2.2 })}<span>Add a task or note…</span></button>
      ${body}
      ${total ? resume : ''}
    </div>`;
}

function viewTasks() {
  const today = store.today();
  const sel = ui.selectedDay;
  const hasTasks = (k) => store.state.tasks.some((t) => t.due === k);

  const week = weekOf(sel).map((k) => {
    const d = fromKey(k);
    return `<button class="day ${k === today ? 'is-today' : ''}" data-act="day" data-day="${k}" aria-pressed="${k === sel}" aria-label="${weekdayName(d.getDay())} ${d.getDate()}${k === today ? ', today' : ''}">
      <span class="d">${weekdayName(d.getDay(), 'short')}</span><span class="n">${d.getDate()}</span><span class="pip ${hasTasks(k) ? 'on' : ''}"></span></button>`;
  }).join('');

  const overdue = sel === today ? store.overdue() : [];
  const dayTasks = store.tasksOn(sel);
  const counts = {
    all: overdue.length + dayTasks.length,
    progress: store.inProgress().length,
    next: store.upcoming().length,
    done: store.done().length,
  };
  const tabs = [['all', 'All'], ['progress', 'In progress'], ['next', 'Next'], ['done', 'Done']]
    .map(([id, label]) => `<button role="tab" class="tab" data-act="tab" data-tab="${id}" aria-selected="${ui.tab === id}">${label} <span>${counts[id]}</span></button>`).join('');

  let panel = '';
  const card = (list) => `<div class="card">${list.map((t) => taskRow(t)).join('')}</div>`;
  if (ui.tab === 'all') {
    if (overdue.length) panel += section('Overdue', card(overdue), overdue.length, 'bad');
    panel += dayTasks.length
      ? section(relativeDay(sel, today) === 'Today' ? 'Today' : shortDate(sel), card(dayTasks))
      : `<p class="empty-inline">Nothing planned for ${sel === today ? 'today' : shortDate(sel)}. Tap + to add something.</p>`;
  } else if (ui.tab === 'progress') {
    const list = store.inProgress();
    panel = list.length ? section('In progress', card(list))
      : '<p class="empty-inline">Nothing in progress. Tap a task\'s box once to start it.</p>';
  } else if (ui.tab === 'next') {
    const groups = new Map();
    store.upcoming().forEach((t) => { if (!groups.has(t.due)) groups.set(t.due, []); groups.get(t.due).push(t); });
    panel = [...groups].map(([k, list]) => section(relativeDay(k, today) === 'Tomorrow' ? 'Tomorrow' : shortDate(k), card(list))).join('')
      || '<p class="empty-inline">Nothing coming up yet.</p>';
  } else {
    const list = store.done();
    panel = list.length ? section('Done', card(list), list.length) : '<p class="empty-inline">Finished tasks show up here.</p>';
  }

  return `<header class="head">
      <div><div class="eyebrow">${monthYear(sel)}</div><h1>Tasks</h1></div>
      <div class="actions">
        <a class="icon-btn" href="#/search" aria-label="Search tasks">${icon('search')}</a>
        <button class="icon-btn" data-act="month" aria-label="Show month" aria-pressed="${ui.monthOpen}" ${ui.monthOpen ? 'style="background:var(--green-soft)"' : ''}>${icon('calendar')}</button>
      </div>
    </header>
    <div class="stack tight">
      ${ui.monthOpen ? monthGrid(sel, today, hasTasks) : ''}
      <div class="week-nav">
        <button class="icon-btn" data-act="week" data-dir="-1" aria-label="Previous week">${icon('chevronLeft')}</button>
        ${sel !== today ? '<button class="link-btn" data-act="day" data-day="' + today + '">Jump to today</button>' : '<span></span>'}
        <button class="icon-btn" data-act="week" data-dir="1" aria-label="Next week">${icon('chevronRight')}</button>
      </div>
      <div class="week" role="group" aria-label="Choose a day">${week}</div>
      <div class="tabs" role="tablist" aria-label="Task status">${tabs}</div>
      <div role="tabpanel" style="display:flex;flex-direction:column;gap:16px">${panel}</div>
    </div>
    <button class="fab" data-act="capture" aria-label="Add task">${icon('plus', { size: 24, width: 2.4 })}</button>`;
}

function monthGrid(sel, today, hasTasks) {
  const d = fromKey(sel);
  const first = dayKey(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = weekOf(first)[0];
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const k = addDays(start, i);
    const inMonth = fromKey(k).getMonth() === d.getMonth();
    if (i >= 35 && !inMonth) break;
    cells.push(`<button class="day ${k === today ? 'is-today' : ''}" style="min-height:44px;${inMonth ? '' : 'opacity:.4'}" data-act="day" data-day="${k}" aria-pressed="${k === sel}" aria-label="${shortDate(k)}">
      <span class="n" style="font-size:14px">${fromKey(k).getDate()}</span><span class="pip ${hasTasks(k) ? 'on' : ''}"></span></button>`);
  }
  return `<div class="card" style="padding:12px">
    <div class="section-head" style="margin-bottom:8px">
      <button class="icon-btn" data-act="month-step" data-dir="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
      <strong>${monthYear(sel)}</strong>
      <button class="icon-btn" data-act="month-step" data-dir="1" aria-label="Next month">${icon('chevronRight')}</button>
    </div>
    <div class="week" style="margin-bottom:4px">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span style="text-align:center;font-size:12px;color:var(--muted)">${x}</span>`).join('')}</div>
    <div class="week">${cells.join('')}</div></div>`;
}

function viewNotes() {
  const cats = ['All', ...NOTE_CATEGORIES];
  const notes = store.state.notes
    .filter((n) => ui.noteFilter === 'All' || n.category === ui.noteFilter)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const preview = (n) => n.body.trim() || n.items.map((i) => i.text).join(', ') || 'No content yet';
  const row = (n) => `<a class="note-row" href="#/note/${n.id}" style="text-decoration:none">
      <span class="t"><span>${esc(n.title)}</span>${n.pinned ? icon('pin', { size: 18, color: 'var(--muted)' }) : ''}</span>
      <span class="p">${esc(preview(n))}</span>
      <span class="m">${esc(n.category)} · ${timeAgo(n.updatedAt, Date.now())}</span></a>`;
  const pinned = notes.filter((n) => n.pinned);
  const recent = notes.filter((n) => !n.pinned);

  const body = notes.length
    ? `${pinned.length ? section('Pinned', `<div class="card">${pinned.map(row).join('')}</div>`) : ''}
       ${recent.length ? section('Recent', `<div class="card">${recent.map(row).join('')}</div>`) : ''}`
    : emptyState({
      ic: 'note', title: ui.noteFilter === 'All' ? 'No notes yet' : `No ${ui.noteFilter.toLowerCase()} notes`,
      text: 'Write down ideas, lists and class notes. Checklist items can become tasks for today.',
      actions: `<button class="btn primary block" data-act="new-note">${icon('pen')} New note</button>`,
    });

  return `<header class="head">
      <div><h1 style="font-size:30px">Notes</h1></div>
      <div class="actions">
        <a class="icon-btn" href="#/search" aria-label="Search notes">${icon('search')}</a>
        <button class="icon-btn" data-act="new-note" aria-label="New note">${icon('pen')}</button>
      </div>
    </header>
    <div class="stack">
      <div class="chips" role="group" aria-label="Filter notes">${cats.map((c) => `<button class="chip" data-act="note-filter" data-cat="${c}" aria-pressed="${ui.noteFilter === c}">${c}</button>`).join('')}</div>
      ${body}
    </div>`;
}

function viewNote() {
  const note = store.findNote(ui.param);
  if (!note) {
    return `<header class="head"><a class="icon-btn" href="#/notes" aria-label="Back">${icon('chevronLeft')}</a></header>
      ${emptyState({ ic: 'note', title: 'Note not found', text: 'It may have been deleted.', actions: '<a class="btn primary block" href="#/notes">Back to notes</a>' })}`;
  }
  const items = note.items.map((item) => {
    const task = item.taskId ? store.findTask(item.taskId) : null;
    const selected = ui.noteSelection.has(item.id);
    let check;
    if (task) {
      check = `<button class="check" data-act="toggle" data-id="${task.id}" aria-label="${task.status === 'done' ? 'Mark not done' : 'Mark done'}: ${esc(item.text)}">
        <span class="box ${task.status === 'done' ? 'linked' : ''}">${task.status === 'done' ? icon('check', { size: 13, color: '#fff', width: 3 }) : ''}</span></button>`;
    } else {
      check = `<button class="check" data-act="select-item" data-item="${item.id}" aria-pressed="${selected}" aria-label="Select ${esc(item.text)}">
        <span class="box ${selected ? 'done' : ''}">${selected ? icon('check', { size: 13, color: '#fff', width: 3 }) : ''}</span></button>`;
    }
    return `<div class="item ${selected ? 'selected' : ''}">
      ${check}
      <input class="txt ${task?.status === 'done' ? 'done' : ''}" value="${esc(item.text)}" data-input="item" data-item="${item.id}" aria-label="Checklist item">
      ${task ? `<a class="in-today" href="#/tasks" title="This item is a task">${icon('link')} In ${task.due === store.today() ? 'Today' : 'Tasks'}</a>` : ''}
      <button class="icon-btn rm" data-act="remove-item" data-item="${item.id}" aria-label="Remove ${esc(item.text)}">${icon('close', { size: 16 })}</button>
    </div>`;
  }).join('');
  const n = ui.noteSelection.size;

  return `<div class="view-inner note-edit" style="display:flex;flex-direction:column;min-height:100%">
    <header class="head" style="align-items:center;padding:12px 12px 8px 8px">
      <a class="icon-btn" href="#/notes" aria-label="Back to notes">${icon('chevronLeft', { size: 22 })}</a>
      <div class="actions">
        <button class="icon-btn" data-act="pin" aria-pressed="${note.pinned}" aria-label="${note.pinned ? 'Unpin note' : 'Pin note'}" ${note.pinned ? 'style="background:var(--green-soft)"' : ''}>${icon('pin', { color: note.pinned ? 'var(--green)' : 'currentColor' })}</button>
        <button class="icon-btn" data-act="menu" aria-label="More options" aria-expanded="${ui.menuOpen}">${icon('more')}</button>
      </div>
    </header>
    ${ui.menuOpen ? `<div class="menu" role="menu">
      <button role="menuitem" data-act="note-to-tasks-all">${icon('arrowRight')} Add all items to Today</button>
      <button role="menuitem" class="bad" data-act="delete-note">${icon('trash')} Delete note</button></div>` : ''}
    <div class="stack tight" style="flex:1">
      <div>
        <input class="title" value="${esc(note.title)}" data-input="note-title" aria-label="Note title" placeholder="Title">
        <div class="meta">
          <select data-input="note-category" aria-label="Category">${NOTE_CATEGORIES.map((c) => `<option ${c === note.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <span>· edited <span data-edited>${timeAgo(note.updatedAt, Date.now())}</span></span>
        </div>
      </div>
      <textarea class="body" data-input="note-body" rows="2" aria-label="Note text" placeholder="Start writing…">${esc(note.body)}</textarea>
      <div class="items">${items}</div>
      <form class="add-item" data-form="add-item">
        <span style="width:22px;display:flex;justify-content:center;color:var(--green)">${icon('plus', { size: 18 })}</span>
        <input name="text" placeholder="Add a checklist item" aria-label="Add a checklist item" autocomplete="off">
      </form>
    </div>
    ${n ? `<div class="bottom-bar" style="position:sticky;bottom:0"><strong>${n} selected</strong>
      <button class="btn primary" data-act="note-to-tasks">${icon('arrowRight')} Add to Today</button></div>` : ''}
  </div>`;
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function focusElapsed() {
  return focus.elapsedMs + (focus.running ? Date.now() - focus.startedAt : 0);
}

function viewFocus() {
  if (!focus.active) {
    const today = store.today();
    const options = [...store.overdue(), ...store.tasksOn(today)].filter((t) => t.status !== 'done');
    const picks = options.map((t) => `<button class="link-card focus-pick" data-act="focus-pick" data-id="${t.id}" aria-pressed="${focus.taskId === t.id}" ${focus.taskId === t.id ? 'style="border-color:var(--green);background:var(--green-soft)"' : ''}>
        <span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${esc([t.tag, whenLabel(t, today)].filter(Boolean).join(' · ') || 'Today')}</span></span>
        ${focus.taskId === t.id ? icon('check', { color: 'var(--green)' }) : ''}</button>`).join('');
    return `<header class="head"><div><div class="eyebrow">Focus more, scroll less</div><h1>Focus</h1></div></header>
      <div class="stack">
        ${section('What are you working on?', `<div style="display:flex;flex-direction:column;gap:8px">
          <button class="link-card focus-pick" data-act="focus-pick" data-id="" aria-pressed="${!focus.taskId}" ${!focus.taskId ? 'style="border-color:var(--green);background:var(--green-soft)"' : ''}>
            <span class="grow"><span class="t">Just focus</span><span class="s">No task attached</span></span>${!focus.taskId ? icon('check', { color: 'var(--green)' }) : ''}</button>
          ${picks}</div>`)}
        ${section('Session length', `<div class="chips durations" role="group" aria-label="Session length">${[15, 25, 45, 60].map((m) =>
    `<button class="chip" data-act="focus-len" data-min="${m}" aria-pressed="${focus.minutes === m}">${m} min</button>`).join('')}</div>`)}
        <button class="btn primary block" data-act="focus-start">${icon('play', { size: 18 })} Start focus</button>
      </div>`;
  }
  const task = focus.taskId ? store.findTask(focus.taskId) : null;
  const total = focus.minutes * 60000;
  const left = total - focusElapsed();
  const C = 2 * Math.PI * 118;
  const progress = Math.min(1, focusElapsed() / total);
  return `<header class="head" style="align-items:center;padding-top:16px">
      <strong style="font-size:18px">Focus</strong>
      <button class="icon-btn" data-act="focus-end" aria-label="End session">${icon('close', { size: 22 })}</button>
    </header>
    <div class="focus-wrap">
      <div><div class="working">${focus.finished ? 'Session complete' : 'Working on'}</div><h2>${esc(task ? task.title : 'Deep focus')}</h2></div>
      <div class="ring" role="timer" aria-live="off">
        <svg viewBox="0 0 260 260"><circle cx="130" cy="130" r="118" fill="none" stroke="#e6e8e4" stroke-width="14"/>
          <circle data-ring cx="130" cy="130" r="118" fill="none" stroke="var(--green)" stroke-width="14" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - progress)}"/></svg>
        <div class="time"><span class="big" data-clock>${fmtClock(left)}</span><span class="sub">of ${focus.minutes} min${focus.running ? '' : focus.finished ? ' · nice work' : ' · paused'}</span></div>
      </div>
      <div class="card" style="width:100%;text-align:left;padding:16px">
        <div style="display:flex;gap:10px;align-items:center;font-weight:600">${icon('shield', { color: 'var(--green)' })} Stay on one thing</div>
        <p style="margin:8px 0 12px;color:var(--muted)">Distractions can wait. Park stray thoughts in a note and get back to it.</p>
        <button class="link-card" style="border:0;padding:12px 0 0;border-top:1px solid var(--line-2);border-radius:0" data-act="jot">
          ${icon('pen', { color: 'var(--green)' })}<span class="grow"><span class="t" style="font-weight:500">Jot a quick note</span></span>${icon('chevronRight', { size: 18, color: 'var(--muted)' })}</button>
      </div>
      <div class="focus-actions">
        ${focus.finished
    ? '<button class="btn grow" data-act="focus-end">Close</button>'
    : `<button class="btn grow" data-act="focus-toggle">${icon(focus.running ? 'pause' : 'play')} ${focus.running ? 'Pause' : 'Resume'}</button>`}
        ${task && task.status !== 'done' ? `<button class="btn primary grow" data-act="focus-done">${icon('check')} Mark done</button>` : ''}
      </div>
    </div>`;
}

function viewWindDown() {
  const now = new Date();
  const today = store.today();
  const doneToday = store.state.tasks.filter((t) => t.status === 'done' && t.doneAt && dayKey(new Date(t.doneAt)) === today).length;
  const mins = store.focusMinutesOn(today);
  const focused = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const open = [...store.overdue(), ...store.tasksOn(today)].filter((t) => t.status !== 'done');
  if (!ui.windSel) ui.windSel = new Set(open.map((t) => t.id));
  const tomorrow = addDays(today, 1);
  const tomorrowList = [...store.tasksOn(tomorrow).filter((t) => t.status !== 'done'), ...open.filter((t) => ui.windSel.has(t.id))]
    .sort((a, b) => b.priority - a.priority || (a.time || '99').localeCompare(b.time || '99'));
  const first = tomorrowList[0];

  const moveRows = open.map((t) => {
    const on = ui.windSel.has(t.id);
    return `<div class="row-item compact"><button class="check" data-act="wind-sel" data-id="${t.id}" aria-pressed="${on}" aria-label="Move ${esc(t.title)} to tomorrow">
      <span class="box ${on ? 'done' : ''}">${on ? icon('check', { size: 13, color: '#fff', width: 3 }) : ''}</span></button>
      <div class="row-main" style="cursor:default"><div class="row-title">${esc(t.title)}</div></div>
      ${t.due < today ? '<span class="row-side bad">Overdue</span>' : ''}</div>`;
  }).join('');

  return `<header class="head"><div><div class="eyebrow">${weekdayName(now.getDay())} · ${formatTime(now.toTimeString().slice(0, 5))}</div><h1 style="font-size:30px">Close your day</h1></div></header>
    <div class="stack">
      <div class="stats">
        <div class="stat"><b>${doneToday}</b><span>tasks done</span></div>
        <div class="stat"><b>${focused}</b><span>focused</span></div>
        <div class="stat"><b>${open.length}</b><span>still open</span></div>
      </div>
      ${open.length ? section('Move to tomorrow?', `<div class="card">${moveRows}</div>`) : `<div class="card" style="padding:16px;color:var(--muted)">Nothing left open. Enjoy your evening.</div>`}
      ${first ? section('Tomorrow starts with', `<a class="link-card" href="#/tasks" data-act="day-link" data-day="${tomorrow}">${icon('sun', { color: 'var(--warm)' })}<span class="grow"><span class="t" style="font-weight:500">${esc(first.title)}</span></span>${icon('chevronRight', { size: 18, color: 'var(--muted)' })}</a>`) : ''}
      <button class="btn primary block" data-act="close-day">${icon('moon', { size: 18 })} Close the day</button>
      <p class="center-note">${ui.windSel.size ? `${ui.windSel.size} ${ui.windSel.size === 1 ? 'task moves' : 'tasks move'} to ${shortDate(tomorrow)}.` : 'Everything stays where it is.'}</p>
    </div>`;
}

function viewSearch() {
  const q = ui.searchQuery;
  const scopes = [['all', 'Everything'], ['tasks', 'Tasks'], ['notes', 'Notes'], ['done', 'Done']];
  const { tasks, notes } = store.search(q, ui.searchScope);
  let results = '';
  if (q.trim()) {
    if (!tasks.length && !notes.length) {
      results = emptyState({
        ic: 'search', title: `No results for “${q.trim()}”`,
        text: 'Nothing in your tasks or notes matches. Check the spelling, or turn it into something new.',
        actions: `<button class="btn primary block" data-act="create-from-search" data-kind="task">${icon('plus')} Create task “${esc(q.trim())}”</button>
          <button class="btn block" data-act="create-from-search" data-kind="note">${icon('note')} Create note “${esc(q.trim())}”</button>`,
      });
    } else {
      if (tasks.length) results += section('Tasks', `<div class="card">${tasks.map((t) => taskRow(t)).join('')}</div>`, tasks.length);
      if (notes.length) {
        results += section('Notes', `<div class="card">${notes.map((n) => `<a class="note-row" href="#/note/${n.id}" style="text-decoration:none"><span class="t">${esc(n.title)}</span><span class="m">${esc(n.category)} · ${timeAgo(n.updatedAt, Date.now())}</span></a>`).join('')}</div>`, notes.length);
      }
    }
  } else {
    results = '<p class="empty-inline">Search tasks, notes and checklist items.</p>';
  }
  return `<div class="search-bar">
      <button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronLeft', { size: 22 })}</button>
      <label class="sr-only" for="q">Search tasks and notes</label>
      <input id="q" type="search" value="${esc(q)}" data-input="search" placeholder="Search tasks and notes" autocomplete="off">
    </div>
    <div class="stack tight">
      <div class="chips scroll" role="group" aria-label="Search in">${scopes.map(([id, l]) => `<button class="chip" data-act="scope" data-scope="${id}" aria-pressed="${ui.searchScope === id}">${l}</button>`).join('')}</div>
      <div data-results style="display:flex;flex-direction:column;gap:16px">${results}</div>
    </div>`;
}

// ---------- Overlays ----------
function captureChips(parsed, sheet) {
  const r = sheet.removed;
  const chips = [];
  const due = r.has('due') ? null : parsed.due;
  const time = r.has('time') ? null : parsed.time;
  if (due || time) chips.push(['date', 'calendar', `${shortDate(due || sheet.defaultDue)}${time ? `, ${formatTime(time)}` : ''}`]);
  if (parsed.repeat && !r.has('repeat')) chips.push(['repeat', 'repeat', repeatLabel(parsed.repeat)]);
  if (parsed.tag && !r.has('tag')) chips.push(['tag', 'tag', parsed.tag]);
  chips.push(['priority', 'flag', PRIORITY_LABELS[r.has('priority') ? 0 : parsed.priority]]);
  return chips.map(([k, ic, label]) => `<button class="chip parsed" type="button" data-act="unparse" data-key="${k}" aria-label="${esc(label)}. Tap to remove" ${k === 'priority' && (!parsed.priority || r.has('priority')) ? 'disabled style="cursor:default"' : ''}>${icon(ic, { color: 'var(--green)' })}${esc(label)}</button>`).join('');
}

function sheetCapture(sheet) {
  const isTask = sheet.mode === 'task';
  const parsed = parseQuickAdd(sheet.text || '');
  return `<div class="scrim" data-act="scrim"><form class="sheet" role="dialog" aria-modal="true" aria-label="Quick capture" data-form="capture">
    <div class="grip"></div>
    <div class="sheet-top">
      <div class="seg" role="group" aria-label="Type">
        <button type="button" data-act="cap-mode" data-mode="task" aria-pressed="${isTask}">Task</button>
        <button type="button" data-act="cap-mode" data-mode="note" aria-pressed="${!isTask}">Note</button>
      </div>
      <button type="button" class="icon-btn" data-act="close-sheet" aria-label="Close">${icon('close', { size: 22 })}</button>
    </div>
    ${isTask ? `
      <label class="sr-only" for="cap">Task</label>
      <textarea id="cap" class="field" rows="2" data-input="capture" placeholder="e.g. Revise notes tomorrow 9pm every Monday #school">${esc(sheet.text)}</textarea>
      <p class="hint">${sheet.text.trim() ? 'Tidy understood this. Tap a chip to undo it.' : 'Type naturally: dates, times, “every Monday”, #tags and !1 for priority.'}</p>
      <div class="chips" data-chips>${sheet.text.trim() ? captureChips(parsed, sheet) : ''}</div>
      <button class="btn primary block" type="submit" style="margin-top:8px" ${sheet.text.trim() ? '' : 'disabled'} data-save>Save task</button>`
    : `
      <label class="sr-only" for="cap-title">Note title</label>
      <input id="cap-title" class="field" data-input="capture-title" placeholder="Title" value="${esc(sheet.title || '')}">
      <label class="sr-only" for="cap">Note</label>
      <textarea id="cap" class="field" rows="5" data-input="capture" placeholder="Write it down…">${esc(sheet.text)}</textarea>
      <button class="btn primary block" type="submit" data-save ${(sheet.text + (sheet.title || '')).trim() ? '' : 'disabled'}>Save note</button>`}
  </form></div>`;
}

function sheetEdit(sheet) {
  const t = store.findTask(sheet.id);
  if (!t) return '';
  const tags = [...new Set([...Object.keys(TAGS), ...store.state.tasks.map((x) => x.tag).filter(Boolean)])];
  const repeats = [null, 'daily', 'weekdays', 'weekly', ...[1, 2, 3, 4, 5, 6, 0].map((d) => `weekly:${d}`)];
  return `<div class="scrim" data-act="scrim"><form class="sheet" role="dialog" aria-modal="true" aria-label="Edit task" data-form="edit">
    <div class="grip"></div>
    <div class="sheet-top"><strong style="font-size:18px">Edit task</strong>
      <button type="button" class="icon-btn" data-act="close-sheet" aria-label="Close">${icon('close', { size: 22 })}</button></div>
    <label class="sr-only" for="ed-title">Title</label>
    <textarea id="ed-title" class="field" name="title" rows="2" required>${esc(t.title)}</textarea>
    <div class="form-grid">
      <label>Date<input type="date" name="due" value="${t.due || ''}"></label>
      <label>Time<input type="time" name="time" value="${t.time || ''}"></label>
      <label>Status<select name="status">${Object.entries(STATUS_NAME).map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Tag<select name="tag"><option value="">None</option>${tags.map((x) => `<option ${t.tag === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label>Priority<select name="priority">${PRIORITY_LABELS.map((l, i) => `<option value="${i}" ${t.priority === i ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Focus length<select name="duration">${[15, 25, 45, 60, 90].map((m) => `<option value="${m}" ${t.duration === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
      <label class="full">Repeat<select name="repeat">${repeats.map((r) => `<option value="${r || ''}" ${t.repeat === r ? 'selected' : ''}>${repeatLabel(r)}</option>`).join('')}</select></label>
    </div>
    <div style="display:flex;gap:10px">
      <button type="button" class="btn" style="color:var(--danger)" data-act="delete-task" data-id="${t.id}">${icon('trash', { size: 18 })} Delete</button>
      ${t.status !== 'done' ? `<button type="button" class="btn" data-act="focus-task" data-id="${t.id}">${icon('play', { size: 18 })} Focus</button>` : ''}
      <button type="submit" class="btn primary grow">Save</button>
    </div>
  </form></div>`;
}

function dialogDeleteNote(d) {
  const note = store.findNote(d.id);
  if (!note) return '';
  const linked = note.items.filter((i) => i.taskId && store.findTask(i.taskId)).length;
  const items = note.items.length;
  let text = items ? `This note and its ${items} checklist ${items === 1 ? 'item' : 'items'} will be deleted.` : 'This note will be deleted.';
  if (linked) text += ` The ${linked} ${linked === 1 ? 'task' : 'tasks'} you made from it ${linked === 1 ? 'stays' : 'stay'} in Tasks.`;
  return `<div class="scrim center" data-act="scrim"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">
    <div class="ico">${icon('trash', { size: 22 })}</div>
    <h2 id="dlg-t">Delete “${esc(note.title)}”?</h2>
    <p id="dlg-d">${esc(text)}</p>
    <button class="btn danger block" data-act="confirm-delete-note">Delete note</button>
    <button class="btn block" data-act="close-dialog" data-autofocus>Keep note</button>
  </div></div>`;
}

function modalHtml() {
  if (ui.sheet?.kind === 'capture') return sheetCapture(ui.sheet);
  if (ui.sheet?.kind === 'edit') return sheetEdit(ui.sheet);
  if (ui.dialog?.kind === 'delete-note') return dialogDeleteNote(ui.dialog);
  return '';
}

function overlays() {
  let html = '<div data-modal-slot></div>';
  if (ui.toast) {
    const fresh = !ui.toast.shown;
    ui.toast.shown = true;
    html += `<div class="toast ${fresh ? 'enter' : ''}" role="status"><span>${esc(ui.toast.text)}</span>${ui.toast.undo ? '<button data-act="undo">Undo</button>' : ''}</div>`;
  }
  return html;
}

// ---------- Render ----------
let viewScroll = 0;
let lastOverlayKey = '';

function render() {
  // Never let a re-render throw away note text that is still being debounced.
  if (pendingNoteSave) { clearTimeout(noteSaveTimer); pendingNoteSave(); }
  const onboarding = !store.state.profile.name;
  const views = { today: viewToday, tasks: viewTasks, focus: viewFocus, notes: viewNotes, note: viewNote, winddown: viewWindDown, search: viewSearch };
  const viewFn = views[ui.route] || viewToday;

  const prevView = $app.querySelector('.view');
  if (prevView) viewScroll = prevView.scrollTop;
  const active = document.activeElement;
  const focusKey = active?.dataset?.input ? `[data-input="${active.dataset.input}"]${active.dataset.item ? `[data-item="${active.dataset.item}"]` : ''}` : null;
  const caret = focusKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  // An open sheet keeps its DOM across re-renders so typed values survive.
  const overlayKey = `${ui.sheet?.kind || ''}${ui.sheet?.mode || ''}${ui.sheet?.id || ''}${ui.dialog?.kind || ''}`;
  const keepModal = overlayKey && overlayKey === lastOverlayKey ? $app.querySelector('#overlay .scrim') : null;

  const showNav = !onboarding && !['search', 'note'].includes(ui.route) && !(ui.route === 'focus' && focus.active);
  $app.innerHTML = onboarding ? viewWelcome() : `
    ${ui.online ? '' : `<div class="banner" role="status">${icon('wifiOff', { size: 18 })} You're offline. Everything is saved on this device.</div>`}
    <main class="view ${ui.route === 'tasks' ? 'has-fab' : ''}" id="main">${viewFn()}</main>
    ${showNav ? nav() : ''}
    <div id="overlay">${overlays()}</div>`;

  const view = $app.querySelector('.view');
  if (view) view.scrollTop = viewScroll;
  if (focusKey) {
    const el = $app.querySelector(focusKey);
    if (el) { el.focus(); if (caret) try { el.setSelectionRange(...caret); } catch { /* not a text field */ } }
  }
  const slot = $app.querySelector('[data-modal-slot]');
  if (slot) {
    if (keepModal) slot.replaceWith(keepModal);
    else if (overlayKey) slot.outerHTML = modalHtml();
    else slot.remove();
  }
  if (keepModal && focusKey) $app.querySelector(focusKey)?.focus();
  if (overlayKey && overlayKey !== lastOverlayKey) {
    const target = $app.querySelector('#overlay [data-autofocus], #overlay textarea, #overlay input');
    target?.focus();
  }
  lastOverlayKey = overlayKey;
  if (ui.focusNoteTitle && ui.route === 'note') {
    ui.focusNoteTitle = false;
    const t = $app.querySelector('.note-edit .title');
    t?.focus();
    t?.select();
  }
  autoGrow();
  document.title = focus.active && focus.running ? `${fmtClock(focus.minutes * 60000 - focusElapsed())} · Tidy` : 'Tidy';
}

function autoGrow() {
  $app.querySelectorAll('textarea.body').forEach((ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; });
}

// Partial update of the capture sheet so typing never loses the caret.
function refreshCapture() {
  const sheet = ui.sheet;
  const form = $app.querySelector('[data-form="capture"]');
  if (!form) return;
  const save = form.querySelector('[data-save]');
  if (sheet.mode === 'task') {
    const has = !!sheet.text.trim();
    form.querySelector('[data-chips]').innerHTML = has ? captureChips(parseQuickAdd(sheet.text), sheet) : '';
    form.querySelector('.hint').textContent = has ? 'Tidy understood this. Tap a chip to undo it.' : 'Type naturally: dates, times, “every Monday”, #tags and !1 for priority.';
    save.disabled = !has;
  } else {
    save.disabled = !(sheet.text + (sheet.title || '')).trim();
  }
}

// ---------- Actions ----------
function toast(text, undo = null) {
  clearTimeout(ui.toast?.timer);
  ui.toast = { text, undo, timer: setTimeout(() => { ui.toast = null; render(); }, 5000) };
  render();
}

function openCapture(opts = {}) {
  ui.sheet = {
    kind: 'capture', mode: opts.mode || 'task', text: opts.text || '', title: opts.title || '',
    removed: new Set(), defaultDue: opts.due || (ui.route === 'tasks' ? ui.selectedDay : store.today()),
  };
  render();
}

function closeOverlays() {
  ui.sheet = null;
  ui.dialog = null;
  ui.menuOpen = false;
  render();
}

function saveCapture() {
  const s = ui.sheet;
  if (s.mode === 'task') {
    const p = parseQuickAdd(s.text);
    const r = s.removed;
    const title = p.title || s.text.trim();
    if (!title) return;
    store.addTask({
      title,
      due: r.has('due') ? s.defaultDue : (p.due || s.defaultDue),
      time: r.has('time') ? null : p.time,
      tag: r.has('tag') ? null : p.tag,
      priority: r.has('priority') ? 0 : p.priority,
      repeat: r.has('repeat') ? null : p.repeat,
    });
    ui.sheet = null;
    toast(`“${title}” added`);
  } else {
    const firstLine = s.text.trim().split('\n')[0];
    const note = store.addNote({ title: s.title || firstLine.slice(0, 60), body: s.title ? s.text : s.text.trim().split('\n').slice(1).join('\n') });
    ui.sheet = null;
    if (ui.route === 'focus' && focus.active) toast('Note saved');
    else go(`#/note/${note.id}`);
  }
}

function deleteTask(id) {
  const snap = store.deleteTask(id);
  ui.sheet = null;
  if (snap) toast(`“${snap.task.title}” deleted`, () => store.restoreTask(snap));
}

let ticker = null;
function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (!focus.active || !focus.running) return;
    const left = focus.minutes * 60000 - focusElapsed();
    if (left <= 0) {
      focus.elapsedMs = focus.minutes * 60000;
      focus.running = false;
      focus.finished = true;
      store.logFocus(focus.minutes, focus.taskId);
      clearInterval(ticker);
      try { navigator.vibrate?.(200); } catch { /* unsupported */ }
      render();
      return;
    }
    document.title = `${fmtClock(left)} · Tidy`;
    const clock = $app.querySelector('[data-clock]');
    if (clock) {
      clock.textContent = fmtClock(left);
      const ring = $app.querySelector('[data-ring]');
      const C = 2 * Math.PI * 118;
      ring.setAttribute('stroke-dashoffset', C * (1 - focusElapsed() / (focus.minutes * 60000)));
    }
  }, 250);
}

function beginFocus(taskId) {
  const t = taskId ? store.findTask(taskId) : null;
  Object.assign(focus, {
    taskId: t ? t.id : null, minutes: t ? t.duration || focus.minutes : focus.minutes,
    active: true, running: true, startedAt: Date.now(), elapsedMs: 0, finished: false,
  });
  if (t && t.status === 'todo') { suppressRender = true; store.setStatus(t.id, 'progress'); suppressRender = false; }
  ui.sheet = null;
  startTicker();
  go('#/focus');
}

function endFocus() {
  if (!focus.finished) store.logFocus(focusElapsed() / 60000, focus.taskId);
  clearInterval(ticker);
  Object.assign(focus, { active: false, running: false, elapsedMs: 0, finished: false });
  render();
}

const actions = {
  capture: () => openCapture(),
  sample: () => store.loadSample(),
  'close-sheet': closeOverlays,
  'close-dialog': closeOverlays,
  scrim: (el, e) => { if (e.target === el) closeOverlays(); },
  'cap-mode': (el) => { ui.sheet.mode = el.dataset.mode; render(); },
  unparse: (el) => {
    const k = el.dataset.key;
    if (k === 'date') { ui.sheet.removed.add('due'); ui.sheet.removed.add('time'); } else ui.sheet.removed.add(k);
    refreshCapture();
  },
  toggle: (el) => store.toggleDone(el.dataset.id),
  cycle: (el) => store.cycleStatus(el.dataset.id),
  edit: (el) => { ui.sheet = { kind: 'edit', id: el.dataset.id }; render(); },
  'delete-task': (el) => deleteTask(el.dataset.id),
  undo: () => { const fn = ui.toast?.undo; clearTimeout(ui.toast?.timer); ui.toast = null; fn ? fn() : render(); },
  later: (el) => { ui.skipped.add(el.dataset.id); render(); },
  'focus-task': (el) => beginFocus(el.dataset.id),

  day: (el) => { ui.selectedDay = el.dataset.day; ui.tab = 'all'; render(); },
  'day-link': (el) => { ui.selectedDay = el.dataset.day; ui.tab = 'all'; },
  week: (el) => { ui.selectedDay = addDays(ui.selectedDay, 7 * Number(el.dataset.dir)); render(); },
  month: () => { ui.monthOpen = !ui.monthOpen; render(); },
  'month-step': (el) => {
    const d = fromKey(ui.selectedDay);
    ui.selectedDay = dayKey(new Date(d.getFullYear(), d.getMonth() + Number(el.dataset.dir), 1));
    render();
  },
  tab: (el) => { ui.tab = el.dataset.tab; render(); },

  'note-filter': (el) => { ui.noteFilter = el.dataset.cat; render(); },
  'new-note': () => {
    const n = store.addNote({ category: ui.noteFilter !== 'All' ? ui.noteFilter : 'Lists' });
    ui.focusNoteTitle = true;
    go(`#/note/${n.id}`);
  },
  pin: () => store.togglePin(ui.param),
  menu: () => { ui.menuOpen = !ui.menuOpen; render(); },
  'delete-note': () => { ui.menuOpen = false; ui.dialog = { kind: 'delete-note', id: ui.param }; render(); },
  'confirm-delete-note': () => {
    const note = store.findNote(ui.dialog.id);
    ui.dialog = null;
    suppressRender = true;
    store.deleteNote(note.id);
    suppressRender = false;
    go('#/notes');
    toast(`“${note.title}” deleted`);
  },
  'select-item': (el) => {
    const id = el.dataset.item;
    if (ui.noteSelection.has(id)) ui.noteSelection.delete(id); else ui.noteSelection.add(id);
    render();
  },
  'remove-item': (el) => { ui.noteSelection.delete(el.dataset.item); store.removeNoteItem(ui.param, el.dataset.item); },
  'note-to-tasks': () => {
    const made = store.sendItemsToToday(ui.param, [...ui.noteSelection]);
    ui.noteSelection.clear();
    toast(`${made.length} ${made.length === 1 ? 'task' : 'tasks'} added to Today`);
  },
  'note-to-tasks-all': () => {
    ui.menuOpen = false;
    const note = store.findNote(ui.param);
    const made = store.sendItemsToToday(ui.param, note.items.map((i) => i.id));
    ui.noteSelection.clear();
    toast(made.length ? `${made.length} ${made.length === 1 ? 'task' : 'tasks'} added to Today` : 'All items are already tasks');
  },

  'focus-pick': (el) => { focus.taskId = el.dataset.id || null; const t = store.findTask(focus.taskId); if (t) focus.minutes = t.duration || 25; render(); },
  'focus-len': (el) => { focus.minutes = Number(el.dataset.min); render(); },
  'focus-start': () => beginFocus(focus.taskId),
  'focus-toggle': () => {
    if (focus.running) { focus.elapsedMs = focusElapsed(); focus.running = false; } else { focus.startedAt = Date.now(); focus.running = true; startTicker(); }
    render();
  },
  'focus-done': () => {
    const id = focus.taskId;
    endFocus();
    store.setStatus(id, 'done');
    toast('Nice work. Task done.');
  },
  'focus-end': endFocus,
  jot: () => openCapture({ mode: 'note' }),

  'wind-sel': (el) => { const id = el.dataset.id; if (ui.windSel.has(id)) ui.windSel.delete(id); else ui.windSel.add(id); render(); },
  'close-day': () => {
    const ids = [...ui.windSel];
    ui.windSel = null;
    store.moveToTomorrow(ids);
    toast(ids.length ? `Moved ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'} to tomorrow. Rest well.` : 'Day closed. Rest well.');
  },

  back: () => (history.length > 1 ? history.back() : go('#/today')),
  scope: (el) => { ui.searchScope = el.dataset.scope; render(); },
  'create-from-search': (el) => {
    const q = ui.searchQuery.trim();
    if (el.dataset.kind === 'task') {
      store.addTask({ title: q });
      toast(`“${q}” added to Today`);
    } else {
      const n = store.addNote({ title: q });
      go(`#/note/${n.id}`);
    }
  },
};

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !$app.contains(el)) {
    if (ui.menuOpen && !e.target.closest('.menu')) { ui.menuOpen = false; render(); }
    return;
  }
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || (el.dataset.act === 'scrim' && e.target === el)) e.preventDefault();
  fn(el, e);
});

let noteSaveTimer = null;
let pendingNoteSave = null;
$app.addEventListener('input', (e) => {
  const el = e.target;
  const kind = el.dataset.input;
  if (!kind) return;
  const quiet = (fn) => { suppressRender = true; try { fn(); } finally { suppressRender = false; } };
  if (kind === 'capture') { ui.sheet.text = el.value; refreshCapture(); }
  else if (kind === 'capture-title') { ui.sheet.title = el.value; refreshCapture(); }
  else if (kind === 'search') {
    ui.searchQuery = el.value;
    render();
  } else if (kind === 'note-title' || kind === 'note-body') {
    if (kind === 'note-body') autoGrow();
    clearTimeout(noteSaveTimer);
    const id = ui.param;
    const value = el.value;
    pendingNoteSave = () => {
      pendingNoteSave = null;
      quiet(() => store.updateNote(id, kind === 'note-title' ? { title: value.trim() || 'Untitled note' } : { body: value }));
      const stamp = $app.querySelector('[data-edited]');
      if (stamp) stamp.textContent = 'just now';
    };
    noteSaveTimer = setTimeout(() => pendingNoteSave?.(), 300);
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.input === 'note-category') store.updateNote(ui.param, { category: el.value });
  if (el.dataset.input === 'item') store.updateNoteItem(ui.param, el.dataset.item, el.value);
});

$app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const kind = form.dataset.form;
  if (kind === 'welcome') {
    const name = new FormData(form).get('name').trim();
    if (name) { store.setName(name); go('#/today'); }
  } else if (kind === 'capture') {
    saveCapture();
  } else if (kind === 'edit') {
    const f = new FormData(form);
    const id = ui.sheet.id;
    const status = f.get('status');
    suppressRender = true;
    store.updateTask(id, {
      title: f.get('title'),
      due: f.get('due') || store.today(),
      time: f.get('time') || null,
      tag: f.get('tag') || null,
      priority: Number(f.get('priority')),
      duration: Number(f.get('duration')),
      repeat: f.get('repeat') || null,
    });
    if (store.findTask(id).status !== status) store.setStatus(id, status);
    suppressRender = false;
    ui.sheet = null;
    toast('Task updated');
  } else if (kind === 'add-item') {
    const input = form.elements.text;
    if (input.value.trim()) {
      store.addNoteItem(ui.param, input.value);
      $app.querySelector('[data-form="add-item"] input')?.focus();
    }
  }
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === 'Escape' && (ui.sheet || ui.dialog || ui.menuOpen)) { closeOverlays(); return; }
  if (e.key === 'Enter' && !e.shiftKey && e.target.dataset?.input === 'capture' && ui.sheet?.mode === 'task') {
    e.preventDefault();
    if (ui.sheet.text.trim()) saveCapture();
    return;
  }
  if (e.key === 'Enter' && e.target.dataset?.input === 'item') { e.preventDefault(); e.target.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !store.state.profile.name) return;
  if (e.key === 'n' && !ui.sheet) { e.preventDefault(); openCapture(); }
  if (e.key === '/' && !ui.sheet) { e.preventDefault(); go('#/search'); setTimeout(() => $app.querySelector('#q')?.focus(), 0); }
});

// Keep "today" correct if the app stays open past midnight.
setInterval(() => {
  const k = dayKey(new Date());
  if (k !== render.lastDay) { render.lastDay = k; if (!ui.sheet) render(); }
}, 60000);
render.lastDay = dayKey(new Date());

parseHash();
render();
if (ui.route === 'search') $app.querySelector('#q')?.focus();

// Expose for debugging in the console.
window.tidy = { store, ui };
