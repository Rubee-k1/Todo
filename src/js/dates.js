// Date helpers. Days are stored as local "YYYY-MM-DD" keys so a task due
// "today" stays today regardless of time zone offsets.

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function diffDays(a, b) {
  return Math.round((fromKey(a) - fromKey(b)) / 86400000);
}

/** Next date (strictly after `fromKeyStr` unless `includeSame`) that falls on `weekday`. */
export function nextWeekday(fromKeyStr, weekday, includeSame = false) {
  const d = fromKey(fromKeyStr);
  let delta = (weekday - d.getDay() + 7) % 7;
  if (delta === 0 && !includeSame) delta = 7;
  return addDays(fromKeyStr, delta);
}

/** Monday-first week containing `key`. */
export function weekOf(key) {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7;
  const start = addDays(key, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

const short = (s) => s[0].toUpperCase() + s.slice(1, 3);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** "Today", "Tomorrow", "Yesterday", "Tue", or "12 Oct". */
export function relativeDay(key, todayKey) {
  const diff = diffDays(key, todayKey);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = fromKey(key);
  if (diff > -7 && diff < 7) return short(WEEKDAYS[d.getDay()]);
  return `${d.getDate()} ${short(MONTHS[d.getMonth()])}`;
}

/** "Fri 2 Oct" */
export function shortDate(key) {
  const d = fromKey(key);
  return `${short(WEEKDAYS[d.getDay()])} ${d.getDate()} ${short(MONTHS[d.getMonth()])}`;
}

/** "Thursday, 1 October" */
export function longDate(date) {
  return `${cap(WEEKDAYS[date.getDay()])}, ${date.getDate()} ${cap(MONTHS[date.getMonth()])}`;
}

export function monthYear(key) {
  const d = fromKey(key);
  return `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
}

export function weekdayName(i, length = 'long') {
  return length === 'short' ? short(WEEKDAYS[i]) : cap(WEEKDAYS[i]);
}

export function greeting(date) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "just now", "5 min ago", "2 h ago", "Yesterday", "Mon", "26 Sep" */
export function timeAgo(ms, now) {
  const mins = Math.floor((now - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const todayK = dayKey(new Date(now));
  const thenK = dayKey(new Date(ms));
  if (thenK === todayK) return `${hours} h ago`;
  return relativeDay(thenK, todayK);
}
