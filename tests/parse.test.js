import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, nextOccurrence, repeatLabel, fillCapture } from '../src/js/parse.js';

// Thursday 1 October 2026, 8:00 am
const NOW = new Date(2026, 9, 1, 8, 0);

test('parses the design example: date, time, repeat and tag', () => {
  const r = parseQuickAdd('Revise design notes tomorrow 9pm every Monday #school', NOW);
  assert.equal(r.title, 'Revise design notes');
  assert.equal(r.due, '2026-10-02');
  assert.equal(r.time, '21:00');
  assert.equal(r.repeat, 'weekly:1');
  assert.equal(r.tag, 'School');
  assert.equal(r.priority, 0);
});

test('plain text stays as the title with defaults', () => {
  const r = parseQuickAdd('Call mum', NOW);
  assert.deepEqual(r, { title: 'Call mum', due: null, time: null, tag: null, priority: 0, repeat: null });
});

test('time without a date means today', () => {
  const r = parseQuickAdd('Standup 9:30am', NOW);
  assert.equal(r.due, '2026-10-01');
  assert.equal(r.time, '09:30');
  assert.equal(r.title, 'Standup');
});

test('24h times, noon and "at N"', () => {
  assert.equal(parseQuickAdd('Lunch at noon', NOW).time, '12:00');
  assert.equal(parseQuickAdd('Deploy 14:45', NOW).time, '14:45');
  assert.equal(parseQuickAdd('Dinner at 7', NOW).time, '19:00');
  assert.equal(parseQuickAdd('Run at 9', NOW).time, '09:00');
  assert.equal(parseQuickAdd('Midnight snack at 12am', NOW).time, '00:00');
});

test('weekday names resolve to the next such day, never today', () => {
  assert.equal(parseQuickAdd('Gym friday', NOW).due, '2026-10-02');
  assert.equal(parseQuickAdd('Review on thu', NOW).due, '2026-10-08');
});

test('month/day in either order, rolling into next year when past', () => {
  assert.equal(parseQuickAdd('Rent 5 Oct', NOW).due, '2026-10-05');
  assert.equal(parseQuickAdd('Party Dec 24th', NOW).due, '2026-12-24');
  assert.equal(parseQuickAdd('Taxes 1 Sep', NOW).due, '2027-09-01');
  assert.equal(parseQuickAdd('Nope 31 Feb', NOW).due, null);
});

test('relative days', () => {
  assert.equal(parseQuickAdd('Ship it today', NOW).due, '2026-10-01');
  assert.equal(parseQuickAdd('Follow up in 3 days', NOW).due, '2026-10-04');
  assert.equal(parseQuickAdd('Plan next week', NOW).due, '2026-10-05');
});

test('priority markers', () => {
  assert.equal(parseQuickAdd('Fix bug !1', NOW).priority, 3);
  assert.equal(parseQuickAdd('Fix bug p3', NOW).priority, 1);
  assert.equal(parseQuickAdd('Fix bug !1', NOW).title, 'Fix bug');
});

test('repeating task with no date starts on its next occurrence', () => {
  assert.equal(parseQuickAdd('Water plants every monday', NOW).due, '2026-10-05');
  assert.equal(parseQuickAdd('Journal daily', NOW).due, '2026-10-01');
  assert.equal(parseQuickAdd('Standup every thursday', NOW).due, '2026-10-01');
});

test('words that only look like dates stay in the title', () => {
  const r = parseQuickAdd('Read Monday.com docs', NOW);
  assert.equal(r.title, 'Read Monday.com docs');
  assert.equal(r.due, null);
});

test('nextOccurrence and labels', () => {
  assert.equal(nextOccurrence('daily', '2026-10-01'), '2026-10-02');
  assert.equal(nextOccurrence('weekly', '2026-10-01'), '2026-10-08');
  assert.equal(nextOccurrence('weekly:1', '2026-10-05'), '2026-10-12');
  assert.equal(nextOccurrence('weekdays', '2026-10-02'), '2026-10-05');
  assert.equal(nextOccurrence(null, '2026-10-02'), null);
  assert.equal(repeatLabel('weekly:1'), 'Every Monday');
});

test('fillCapture takes date, time and tag from the text by default', () => {
  const { title, fields } = fillCapture('Pay rent tomorrow 9am #home', {}, new Set(), '2026-10-01', NOW);
  assert.equal(title, 'Pay rent');
  assert.deepEqual(fields, { due: '2026-10-02', time: '09:00', tag: 'Home', priority: 0, repeat: null });
});

test('fillCapture keeps fields the user set by hand, even if the text disagrees', () => {
  const touched = new Set(['due', 'tag', 'time']);
  const { fields } = fillCapture('Pay rent tomorrow 9am #home', { due: '2026-10-09', tag: 'work', time: null }, touched, '2026-10-01', NOW);
  assert.equal(fields.due, '2026-10-09');
  assert.equal(fields.tag, 'Work');
  assert.equal(fields.time, null, 'a cleared time stays cleared');
});

test('fillCapture falls back to the default day and cleans tags', () => {
  const { title, fields } = fillCapture('Call mum', { due: '', tag: '  #school ' }, new Set(['due', 'tag']), '2026-10-03', NOW);
  assert.equal(title, 'Call mum');
  assert.equal(fields.due, '2026-10-03');
  assert.equal(fields.tag, 'School');
  const blank = fillCapture('x', { tag: '   ' }, new Set(['tag']), '2026-10-03', NOW);
  assert.equal(blank.fields.tag, null);
});

test('a time with no date lands on the day being planned', () => {
  assert.equal(parseQuickAdd('Gym 7am', NOW, { baseDay: '2026-10-06' }).due, '2026-10-06');
  assert.equal(fillCapture('Gym 7am', {}, new Set(), '2026-10-06', NOW).fields.due, '2026-10-06');
  assert.equal(fillCapture('Gym 7am tomorrow', {}, new Set(), '2026-10-06', NOW).fields.due, '2026-10-02');
});
