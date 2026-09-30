// Quick capture parser: turns "Revise design notes tomorrow 9pm every Monday #school"
// into a structured task. Pure function, no DOM, so it is unit tested directly.

import { WEEKDAYS, MONTHS, addDays, nextWeekday, dayKey, fromKey } from './dates.js';

const DAY_ALIASES = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};
const DAY_RE = Object.keys(DAY_ALIASES).sort((a, b) => b.length - a.length).join('|');
const MONTH_RE = MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|');

function monthIndex(word) {
  return MONTHS.findIndex((m) => m.startsWith(word.toLowerCase().slice(0, 3)));
}

function to24h(h, m, meridiem) {
  let hour = Number(h);
  const min = Number(m || 0);
  if (hour > 23 || min > 59) return null;
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith('p');
    if (hour < 1 || hour > 12) return null;
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * @param {string} text   raw input
 * @param {Date}   now    reference time (injectable for tests)
 * @param {{baseDay?:string}} [opts] day a time-only entry lands on (defaults to today)
 * @returns {{title:string,due:string|null,time:string|null,tag:string|null,priority:number,repeat:string|null}}
 */
export function parseQuickAdd(text, now = new Date(), { baseDay = null } = {}) {
  const today = dayKey(now);
  let rest = ` ${text} `;
  const out = { title: '', due: null, time: null, tag: null, priority: 0, repeat: null };

  const take = (re, fn) => {
    const m = rest.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return true;
  };

  // #tag → category (first one wins, all are removed)
  take(/\s#([\p{L}\p{N}_-]+)/u, (m) => { out.tag = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); });
  while (take(/\s#[\p{L}\p{N}_-]+/u, () => {}));

  // Priority: !1..!3 or p1..p3 (1 is highest)
  take(/\s(?:!|p)([1-3])(?=\s)/i, (m) => { out.priority = 4 - Number(m[1]); });

  // Repeat: "every day", "daily", "every week", "weekly", "every monday", "weekdays"
  take(new RegExp(`\\severy\\s+(${DAY_RE})(?=\\s)`, 'i'), (m) => { out.repeat = `weekly:${DAY_ALIASES[m[1].toLowerCase()]}`; })
    || take(/\s(?:every\s+day|daily)(?=\s)/i, () => { out.repeat = 'daily'; })
    || take(/\s(?:every\s+week|weekly)(?=\s)/i, () => { out.repeat = 'weekly'; })
    || take(/\s(?:every\s+weekday|weekdays)(?=\s)/i, () => { out.repeat = 'weekdays'; });

  // Time: "at 9", "9pm", "9:30 pm", "21:00", "noon", "midnight"
  take(/\s(?:at\s+)?(noon|midday|midnight)(?=\s)/i, (m) => { out.time = m[1].toLowerCase() === 'midnight' ? '00:00' : '12:00'; })
    || take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s)/i, (m) => {
      const t = to24h(m[1], m[2], m[3]);
      if (!t) return false;
      out.time = t;
    })
    || take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => { out.time = to24h(m[1], m[2]); })
    || take(/\sat\s+(\d{1,2})(?=\s)/i, (m) => {
      const h = Number(m[1]);
      if (h < 1 || h > 12) return false;
      // "at 7" means the next sensible 7: before 8 is assumed pm.
      out.time = to24h(h, 0, h < 8 ? 'pm' : 'am');
    });

  // Date
  take(/\s(?:today|tonight)(?=\s)/i, () => { out.due = today; })
    || take(/\s(?:tomorrow|tmrw|tmr)(?=\s)/i, () => { out.due = addDays(today, 1); })
    || take(/\sin\s+(\d{1,3})\s+days?(?=\s)/i, (m) => { out.due = addDays(today, Number(m[1])); })
    || take(/\snext\s+week(?=\s)/i, () => { out.due = nextWeekday(today, 1); })
    || take(new RegExp(`\\s(?:on\\s+|next\\s+)?(${DAY_RE})(?=\\s)`, 'i'), (m) => {
      out.due = nextWeekday(today, DAY_ALIASES[m[1].toLowerCase()], false);
    })
    || take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})(?=\\s)`, 'i'), (m) => {
      out.due = resolveMonthDay(Number(m[1]), monthIndex(m[2]), now);
      if (!out.due) return false;
    })
    || take(new RegExp(`\\s(?:on\\s+)?(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s)`, 'i'), (m) => {
      out.due = resolveMonthDay(Number(m[2]), monthIndex(m[1]), now);
      if (!out.due) return false;
    });

  // A repeating task with no explicit date starts on its next occurrence.
  if (out.repeat && !out.due) out.due = firstOccurrence(out.repeat, today);
  // A time with no date means the day being planned (today unless told otherwise).
  if (out.time && !out.due) out.due = baseDay || today;

  out.title = rest.replace(/\s+/g, ' ').trim();
  return out;
}

function resolveMonthDay(day, month, now) {
  if (month < 0 || day < 1 || day > 31) return null;
  let d = new Date(now.getFullYear(), month, day);
  if (d.getMonth() !== month) return null;
  if (dayKey(d) < dayKey(now)) d = new Date(now.getFullYear() + 1, month, day);
  return dayKey(d);
}

function firstOccurrence(repeat, today) {
  if (repeat.startsWith('weekly:')) return nextWeekday(today, Number(repeat.split(':')[1]), true);
  if (repeat === 'weekdays') {
    const dow = fromKey(today).getDay();
    return dow === 0 ? addDays(today, 1) : dow === 6 ? addDays(today, 2) : today;
  }
  return today;
}

/** Date of the next occurrence after `fromDue`, or null if not repeating. */
export function nextOccurrence(repeat, fromDue) {
  if (!repeat) return null;
  if (repeat === 'daily') return addDays(fromDue, 1);
  if (repeat === 'weekly') return addDays(fromDue, 7);
  if (repeat.startsWith('weekly:')) return nextWeekday(fromDue, Number(repeat.split(':')[1]));
  if (repeat === 'weekdays') {
    const dow = fromKey(fromDue).getDay();
    return addDays(fromDue, dow === 5 ? 3 : dow === 6 ? 2 : 1);
  }
  return null;
}

export function repeatLabel(repeat) {
  if (!repeat) return 'No repeat';
  if (repeat === 'daily') return 'Every day';
  if (repeat === 'weekly') return 'Every week';
  if (repeat === 'weekdays') return 'Every weekday';
  if (repeat.startsWith('weekly:')) {
    const n = WEEKDAYS[Number(repeat.split(':')[1])];
    return `Every ${n[0].toUpperCase()}${n.slice(1)}`;
  }
  return 'No repeat';
}

export const PRIORITY_LABELS = ['No priority', 'Low priority', 'Medium priority', 'High priority'];

export const CAPTURE_FIELDS = ['due', 'time', 'tag', 'priority', 'repeat'];

/**
 * Quick-capture form state from the typed text plus any fields the user set by hand.
 * Fields in `touched` keep the user's value; the rest follow what the text says.
 * @returns {{title:string, fields:{due:string,time:string|null,tag:string|null,priority:number,repeat:string|null}}}
 */
export function fillCapture(text, fields = {}, touched = new Set(), defaultDue = null, now = new Date()) {
  const parsed = parseQuickAdd(text, now, { baseDay: defaultDue });
  const fallback = { due: defaultDue, time: null, tag: null, priority: 0, repeat: null };
  const out = {};
  CAPTURE_FIELDS.forEach((k) => {
    out[k] = touched.has(k) ? fields[k] ?? fallback[k] : parsed[k] ?? fallback[k];
  });
  if (!out.due) out.due = defaultDue;
  if (out.tag) out.tag = String(out.tag).trim().replace(/^#/, '') || null;
  if (out.tag) out.tag = out.tag[0].toUpperCase() + out.tag.slice(1);
  out.priority = Number(out.priority) || 0;
  return { title: parsed.title || text.trim(), fields: out };
}
