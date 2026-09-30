import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../src/js/store.js';

const NOW = new Date(2026, 9, 1, 8, 0); // Thu 1 Oct 2026

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
}
const make = (storage = memoryStorage()) => createStore({ storage, now: () => NOW });

test('create, read, update and delete a task', () => {
  const s = make();
  const t = s.addTask({ title: '  Pay bill  ' });
  assert.equal(t.title, 'Pay bill');
  assert.equal(t.due, '2026-10-01');
  assert.equal(s.tasksOn('2026-10-01').length, 1);

  s.updateTask(t.id, { title: 'Pay electricity bill', tag: 'Home' });
  assert.equal(s.findTask(t.id).title, 'Pay electricity bill');

  s.updateTask(t.id, { title: '   ' });
  assert.equal(s.findTask(t.id).title, 'Pay electricity bill', 'blank title is ignored');

  s.deleteTask(t.id);
  assert.equal(s.findTask(t.id), undefined);
});

test('empty titles are rejected', () => {
  assert.throws(() => make().addTask({ title: '  ' }));
});

test('delete can be undone in place', () => {
  const s = make();
  const a = s.addTask({ title: 'A' });
  s.addTask({ title: 'B' });
  const snap = s.deleteTask(a.id);
  s.restoreTask(snap);
  assert.equal(s.state.tasks[0].id, a.id);
  s.restoreTask(snap);
  assert.equal(s.state.tasks.length, 2, 'restoring twice does not duplicate');
});

test('status cycles todo → progress → done → todo', () => {
  const s = make();
  const t = s.addTask({ title: 'A' });
  assert.equal(s.cycleStatus(t.id).status, 'progress');
  assert.equal(s.cycleStatus(t.id).status, 'done');
  assert.ok(s.findTask(t.id).doneAt);
  assert.equal(s.cycleStatus(t.id).status, 'todo');
  assert.equal(s.findTask(t.id).doneAt, null);
});

test('completing a repeating task schedules the next one exactly once', () => {
  const s = make();
  const t = s.addTask({ title: 'Standup', due: '2026-10-01', repeat: 'daily' });
  s.toggleDone(t.id);
  s.toggleDone(t.id);
  s.toggleDone(t.id);
  const copies = s.state.tasks.filter((x) => x.title === 'Standup');
  assert.equal(copies.length, 2);
  assert.equal(copies[1].due, '2026-10-02');
  assert.equal(copies[1].status, 'todo');
});

test('overdue, upcoming, in progress and done selectors', () => {
  const s = make();
  const late = s.addTask({ title: 'Late', due: '2026-09-29' });
  s.addTask({ title: 'Soon', due: '2026-10-03' });
  const wip = s.addTask({ title: 'Wip' });
  s.setStatus(wip.id, 'progress');
  assert.deepEqual(s.overdue().map((t) => t.id), [late.id]);
  assert.deepEqual(s.upcoming().map((t) => t.title), ['Soon']);
  assert.deepEqual(s.inProgress().map((t) => t.title), ['Wip']);
  s.toggleDone(late.id);
  assert.equal(s.overdue().length, 0);
  assert.equal(s.done().length, 1);
});

test('today summary counts overdue + today and picks what is up next', () => {
  const s = make();
  s.addTask({ title: 'Old', due: '2026-09-30' });
  s.addTask({ title: 'Later', time: '18:00' });
  s.addTask({ title: 'Morning', time: '10:00' });
  const sum = s.todaySummary();
  assert.equal(sum.total, 3);
  assert.equal(sum.doneCount, 0);
  assert.equal(sum.upNext.title, 'Morning');
});

test('moveToTomorrow skips finished tasks', () => {
  const s = make();
  const a = s.addTask({ title: 'A', due: '2026-09-30' });
  const b = s.addTask({ title: 'B' });
  s.toggleDone(b.id);
  s.moveToTomorrow([a.id, b.id]);
  assert.equal(s.findTask(a.id).due, '2026-10-02');
  assert.equal(s.findTask(b.id).due, '2026-10-01');
});

test('notes: create, update, pin, items and delete', () => {
  const s = make();
  const n = s.addNote({ title: 'Errands', items: ['Ink', 'Laundry'] });
  assert.equal(n.items.length, 2);
  s.updateNote(n.id, { body: 'Saturday' });
  assert.equal(s.findNote(n.id).body, 'Saturday');
  s.togglePin(n.id);
  assert.equal(s.findNote(n.id).pinned, true);
  const item = s.addNoteItem(n.id, 'Gym');
  s.updateNoteItem(n.id, item.id, 'Renew gym');
  assert.equal(s.findNote(n.id).items[2].text, 'Renew gym');
  s.removeNoteItem(n.id, item.id);
  assert.equal(s.findNote(n.id).items.length, 2);
  assert.equal(s.addNote({}).title, 'Untitled note');
});

test('checklist items become tasks, once, and survive note deletion', () => {
  const s = make();
  const n = s.addNote({ title: 'Errands', items: ['Ink', 'Laundry', 'Books'] });
  const ids = n.items.slice(0, 2).map((i) => i.id);
  const made = s.sendItemsToToday(n.id, ids);
  assert.deepEqual(made.map((t) => t.title), ['Ink', 'Laundry']);
  assert.equal(s.sendItemsToToday(n.id, ids).length, 0, 'no duplicates');
  assert.equal(s.findNote(n.id).items[0].taskId, made[0].id);

  s.deleteNote(n.id);
  assert.equal(s.findNote(n.id), undefined);
  assert.equal(s.tasksOn('2026-10-01').length, 2);
  assert.ok(s.state.tasks.every((t) => t.noteId === null));
});

test('deleting a task unlinks its checklist item and undo relinks it', () => {
  const s = make();
  const n = s.addNote({ title: 'N', items: ['Ink'] });
  const [task] = s.sendItemsToToday(n.id, [n.items[0].id]);
  const snap = s.deleteTask(task.id);
  assert.equal(s.findNote(n.id).items[0].taskId, null);
  s.restoreTask(snap);
  assert.equal(s.findNote(n.id).items[0].taskId, task.id);
});

test('search covers tasks, notes and checklist items with scopes', () => {
  const s = make();
  s.addTask({ title: 'Send invoice' });
  s.addNote({ title: 'Money', body: 'invoice template' });
  s.addNote({ title: 'List', items: ['Print invoice'] });
  assert.equal(s.search('INVOICE').tasks.length, 1);
  assert.equal(s.search('invoice').notes.length, 2);
  assert.equal(s.search('invoice', 'tasks').notes.length, 0);
  assert.equal(s.search('invoice', 'done').tasks.length, 0);
  assert.equal(s.search('   ').tasks.length, 0);
});

test('focus minutes are logged per day', () => {
  const s = make();
  s.logFocus(24.6);
  s.logFocus(0.2);
  assert.equal(s.focusMinutesOn('2026-10-01'), 25);
});

test('state persists and survives corrupt storage', () => {
  const storage = memoryStorage();
  const s1 = make(storage);
  s1.addTask({ title: 'Persist me' });
  const s2 = make(storage);
  assert.equal(s2.state.tasks[0].title, 'Persist me');

  const broken = make(memoryStorage({ [STORAGE_KEY]: '{not json' }));
  assert.deepEqual(broken.state.tasks, []);
});

test('old saves with a profile still load, and the profile is dropped', () => {
  const old = { version: 1, profile: { name: 'Tomi' }, tasks: [], notes: [], focusLog: [] };
  const s = make(memoryStorage({ [STORAGE_KEY]: JSON.stringify(old) }));
  assert.equal(s.state.profile, undefined);
  assert.deepEqual(s.state.tasks, []);
});

test('sample day loads tasks and notes, and reset empties the app', () => {
  const s = make();
  assert.equal(s.isEmpty(), true);
  s.loadSample();
  assert.equal(s.isEmpty(), false);
  assert.ok(s.todaySummary().total > 0);
  assert.ok(s.state.notes.some((n) => n.pinned));
  s.reset();
  assert.equal(s.isEmpty(), true);
  assert.equal(s.todaySummary().total, 0);
});

test('loading the sample again replaces data instead of duplicating it', () => {
  const s = make();
  s.addTask({ title: 'My own task' });
  s.loadSample();
  const counts = [s.state.tasks.length, s.state.notes.length, s.state.focusLog.length];
  s.loadSample();
  assert.deepEqual([s.state.tasks.length, s.state.notes.length, s.state.focusLog.length], counts);
  assert.ok(!s.state.tasks.some((t) => t.title === 'My own task'));
});

test('clearing persists, so a reload starts empty', () => {
  const storage = memoryStorage();
  const s1 = make(storage);
  s1.loadSample();
  s1.reset();
  assert.equal(make(storage).isEmpty(), true);
});
