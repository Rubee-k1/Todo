// App state and every mutation on it. No DOM access here: the UI calls these
// functions and re-renders on `subscribe`. Persistence goes through an
// injected Storage-like object so tests can pass an in-memory one.

import { dayKey, addDays } from './dates.js';
import { nextOccurrence } from './parse.js';

export const STORAGE_KEY = 'tidy:v1';
export const STATUSES = ['todo', 'progress', 'done'];
export const TAGS = {
  Work: '#2f55c4',
  Personal: '#0f7b45',
  Home: '#8a4b06',
  School: '#1f5a3d',
};
export const NOTE_CATEGORIES = ['Lists', 'Ideas', 'Class'];

export function tagColor(tag) {
  return TAGS[tag] || '#6b3fa0';
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyState() {
  return { version: 1, profile: { name: '' }, tasks: [], notes: [], focusLog: [] };
}

export function createStore({ storage = null, now = () => new Date() } = {}) {
  let state = load();
  const listeners = new Set();

  function load() {
    if (!storage) return emptyState();
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  function commit() {
    if (storage) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
    }
    listeners.forEach((fn) => fn(state));
  }

  const today = () => dayKey(now());
  const findTask = (id) => state.tasks.find((t) => t.id === id);
  const findNote = (id) => state.notes.find((n) => n.id === id);

  // ---------- profile ----------
  function setName(name) {
    state.profile.name = name.trim();
    commit();
  }

  // ---------- tasks ----------
  function addTask(fields) {
    const title = (fields.title || '').trim();
    if (!title) throw new Error('A task needs a title');
    const task = {
      id: uid(),
      title,
      status: 'todo',
      due: fields.due ?? today(),
      time: fields.time ?? null,
      tag: fields.tag ?? null,
      priority: fields.priority ?? 0,
      repeat: fields.repeat ?? null,
      duration: fields.duration ?? 25,
      noteId: fields.noteId ?? null,
      createdAt: now().getTime(),
      doneAt: null,
    };
    state.tasks.push(task);
    commit();
    return task;
  }

  function updateTask(id, patch) {
    const task = findTask(id);
    if (!task) return null;
    const next = { ...patch };
    if ('title' in next) {
      next.title = String(next.title).trim();
      if (!next.title) delete next.title;
    }
    Object.assign(task, next);
    commit();
    return task;
  }

  function setStatus(id, status) {
    const task = findTask(id);
    if (!task || !STATUSES.includes(status)) return null;
    const wasDone = task.status === 'done';
    task.status = status;
    task.doneAt = status === 'done' ? now().getTime() : null;
    // Completing a repeating task schedules its next occurrence once.
    if (status === 'done' && !wasDone && task.repeat && !task.spawnedNext) {
      const due = nextOccurrence(task.repeat, task.due || today());
      const copy = { ...task, id: uid(), status: 'todo', due, doneAt: null, createdAt: now().getTime() };
      delete copy.spawnedNext;
      task.spawnedNext = copy.id;
      state.tasks.push(copy);
    }
    commit();
    return task;
  }

  function cycleStatus(id) {
    const task = findTask(id);
    if (!task) return null;
    return setStatus(id, STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length]);
  }

  function toggleDone(id) {
    const task = findTask(id);
    if (!task) return null;
    return setStatus(id, task.status === 'done' ? 'todo' : 'done');
  }

  /** Removes a task and returns a snapshot that `restoreTask` can put back. */
  function deleteTask(id) {
    const index = state.tasks.findIndex((t) => t.id === id);
    if (index < 0) return null;
    const [task] = state.tasks.splice(index, 1);
    const links = [];
    state.notes.forEach((n) => n.items.forEach((it) => {
      if (it.taskId === id) { links.push([n.id, it.id]); it.taskId = null; }
    }));
    commit();
    return { task, index, links };
  }

  function restoreTask(snapshot) {
    if (!snapshot || findTask(snapshot.task.id)) return;
    state.tasks.splice(Math.min(snapshot.index, state.tasks.length), 0, snapshot.task);
    snapshot.links.forEach(([noteId, itemId]) => {
      const item = findNote(noteId)?.items.find((i) => i.id === itemId);
      if (item) item.taskId = snapshot.task.id;
    });
    commit();
  }

  function moveToTomorrow(ids) {
    const tomorrow = addDays(today(), 1);
    ids.forEach((id) => {
      const t = findTask(id);
      if (t && t.status !== 'done') t.due = tomorrow;
    });
    commit();
  }

  // ---------- notes ----------
  function addNote(fields = {}) {
    const note = {
      id: uid(),
      title: (fields.title || '').trim() || 'Untitled note',
      body: fields.body || '',
      category: fields.category || 'Lists',
      pinned: !!fields.pinned,
      items: (fields.items || []).map((text) => ({ id: uid(), text, taskId: null })),
      updatedAt: now().getTime(),
    };
    state.notes.push(note);
    commit();
    return note;
  }

  function updateNote(id, patch) {
    const note = findNote(id);
    if (!note) return null;
    Object.assign(note, patch, { updatedAt: now().getTime() });
    commit();
    return note;
  }

  function togglePin(id) {
    const note = findNote(id);
    if (!note) return null;
    note.pinned = !note.pinned;
    commit();
    return note;
  }

  /** Deletes the note. Tasks made from it are kept, only unlinked. */
  function deleteNote(id) {
    const index = state.notes.findIndex((n) => n.id === id);
    if (index < 0) return null;
    const [note] = state.notes.splice(index, 1);
    state.tasks.forEach((t) => { if (t.noteId === id) t.noteId = null; });
    commit();
    return note;
  }

  function addNoteItem(noteId, text) {
    const note = findNote(noteId);
    const clean = String(text).trim();
    if (!note || !clean) return null;
    const item = { id: uid(), text: clean, taskId: null };
    note.items.push(item);
    note.updatedAt = now().getTime();
    commit();
    return item;
  }

  function updateNoteItem(noteId, itemId, text) {
    const item = findNote(noteId)?.items.find((i) => i.id === itemId);
    if (!item) return null;
    item.text = String(text).trim() || item.text;
    findNote(noteId).updatedAt = now().getTime();
    commit();
    return item;
  }

  function removeNoteItem(noteId, itemId) {
    const note = findNote(noteId);
    if (!note) return;
    note.items = note.items.filter((i) => i.id !== itemId);
    note.updatedAt = now().getTime();
    commit();
  }

  /** Custom feature: turn checklist items into tasks due today. */
  function sendItemsToToday(noteId, itemIds) {
    const note = findNote(noteId);
    if (!note) return [];
    const created = [];
    note.items.forEach((item) => {
      if (!itemIds.includes(item.id) || (item.taskId && findTask(item.taskId))) return;
      const task = {
        id: uid(), title: item.text, status: 'todo', due: today(), time: null, tag: null,
        priority: 0, repeat: null, duration: 25, noteId, createdAt: now().getTime(), doneAt: null,
      };
      state.tasks.push(task);
      item.taskId = task.id;
      created.push(task);
    });
    note.updatedAt = now().getTime();
    commit();
    return created;
  }

  // ---------- focus ----------
  function logFocus(minutes, taskId = null) {
    const m = Math.round(minutes);
    if (m < 1) return;
    state.focusLog.push({ day: today(), minutes: m, taskId, at: now().getTime() });
    commit();
  }

  // ---------- selectors ----------
  const byTime = (a, b) => (a.due || '').localeCompare(b.due || '')
    || (a.time || '99').localeCompare(b.time || '99')
    || b.priority - a.priority
    || a.createdAt - b.createdAt;

  const open = (t) => t.status !== 'done';

  function overdue() {
    const t = today();
    return state.tasks.filter((x) => open(x) && x.due && x.due < t).sort(byTime);
  }

  function tasksOn(key) {
    return state.tasks.filter((x) => x.due === key).sort(byTime);
  }

  function inProgress() {
    return state.tasks.filter((x) => x.status === 'progress').sort(byTime);
  }

  function upcoming() {
    const t = today();
    return state.tasks.filter((x) => x.status === 'todo' && x.due && x.due > t).sort(byTime);
  }

  function done() {
    return state.tasks.filter((x) => x.status === 'done').sort((a, b) => b.doneAt - a.doneAt);
  }

  /** What Today shows: overdue + due today, and the first open timed task "up next". */
  function todaySummary() {
    const list = [...overdue(), ...tasksOn(today())];
    const doneCount = list.filter((x) => x.status === 'done').length;
    const nowHm = now().toTimeString().slice(0, 5);
    const todays = tasksOn(today()).filter(open);
    const upNext = todays.find((x) => x.status === 'progress')
      || todays.find((x) => x.time && x.time >= nowHm)
      || todays[0]
      || null;
    return { list, doneCount, total: list.length, upNext };
  }

  function focusMinutesOn(key) {
    return state.focusLog.filter((f) => f.day === key).reduce((s, f) => s + f.minutes, 0);
  }

  function search(query, scope = 'all') {
    const q = query.trim().toLowerCase();
    if (!q) return { tasks: [], notes: [] };
    const hit = (s) => (s || '').toLowerCase().includes(q);
    let tasks = state.tasks.filter((t) => hit(t.title) || hit(t.tag));
    if (scope === 'done') tasks = tasks.filter((t) => t.status === 'done');
    const notes = scope === 'all' || scope === 'notes'
      ? state.notes.filter((n) => hit(n.title) || hit(n.body) || n.items.some((i) => hit(i.text)))
      : [];
    return { tasks: scope === 'notes' ? [] : tasks.sort(byTime), notes };
  }

  function loadSample() {
    const t = today();
    const mk = (title, due, extra = {}) => ({
      id: uid(), title, status: 'todo', due, time: null, tag: null, priority: 0, repeat: null,
      duration: 25, noteId: null, createdAt: now().getTime(), doneAt: null, ...extra,
    });
    const errands = {
      id: uid(), title: 'Weekend errands', category: 'Lists', pinned: true,
      body: 'Saturday morning before the rain. Take the big bag and the old receipts.',
      items: ['Buy printer ink', 'Pick up laundry', 'Renew gym membership', 'Groceries', 'Return library book']
        .map((text) => ({ id: uid(), text, taskId: null })),
      updatedAt: now().getTime() - 5 * 60000,
    };
    const groceries = mk('Groceries', t, { tag: 'Home', noteId: errands.id, status: 'done', doneAt: now().getTime() });
    errands.items[3].taskId = groceries.id;
    state.tasks.push(
      mk('Submit HNG stage 2 task', addDays(t, -1), { tag: 'School', priority: 3 }),
      mk('Pay electricity bill', addDays(t, -2), { tag: 'Home' }),
      mk('Design review with Ada', t, { tag: 'Work', time: '10:00', duration: 45, status: 'progress' }),
      mk('Call mum', t, { tag: 'Personal', time: '18:00' }),
      mk('Reply to client emails', t, { tag: 'Work', time: '08:30', status: 'done', doneAt: now().getTime() }),
      groceries,
      mk('Revise design notes', addDays(t, 1), { tag: 'School', time: '21:00', repeat: 'weekly:1' }),
      mk('Plan portfolio case study', addDays(t, 2), { tag: 'Work' }),
      mk('Gym: leg day', addDays(t, 3), { tag: 'Personal', time: '07:00' }),
    );
    state.notes.push(
      errands,
      { id: uid(), title: 'Portfolio ideas', category: 'Ideas', pinned: true, items: [],
        body: 'Case study on the HR module. Show before and after of the onboarding flow.',
        updatedAt: now().getTime() - 3 * 86400000 },
      { id: uid(), title: 'UX class notes', category: 'Class', pinned: false, items: [],
        body: "Hick's law: more choices mean slower decisions. Fitts's law: bigger, closer targets are faster to hit.",
        updatedAt: now().getTime() - 86400000 },
      { id: uid(), title: 'Book list', category: 'Lists', pinned: false, body: '',
        items: ['Atomic Habits', "Don't Make Me Think"].map((text) => ({ id: uid(), text, taskId: null })),
        updatedAt: now().getTime() - 5 * 86400000 },
    );
    state.focusLog.push({ day: t, minutes: 50, taskId: null, at: now().getTime() });
    commit();
  }

  function reset() {
    const name = state.profile.name;
    state = emptyState();
    state.profile.name = name;
    commit();
  }

  return {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    today, findTask, findNote,
    setName,
    addTask, updateTask, setStatus, cycleStatus, toggleDone, deleteTask, restoreTask, moveToTomorrow,
    addNote, updateNote, togglePin, deleteNote, addNoteItem, updateNoteItem, removeNoteItem, sendItemsToToday,
    logFocus, focusMinutesOn,
    overdue, tasksOn, inProgress, upcoming, done, todaySummary, search,
    loadSample, reset,
  };
}
