import type { Matrix, FYMap } from './types';

/** Parse anything that looks like a number: 1,23,456.00 · (1,234) · -  · 12.5% · ₹ 1,000 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (v instanceof Date) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^[-–—]+$/.test(s) || /^(na|n\/a|nil|none|null|-|—)$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const pct = s.endsWith('%');
  s = s.replace(/[₹,%\s]|rs\.?|inr/gi, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  let n = parseFloat(s);
  if (pct) n = n / 100;
  return neg ? -n : n;
}

export const n0 = (v: unknown) => num(v) ?? 0;

export function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoDate(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "2021-2022", "FY 2023-24", "FY24", "2023-24" -> "FY 2023-24" */
export function normFY(v: unknown): string | null {
  const s = str(v);
  if (!s || /ttm/i.test(s)) return null;
  let m = s.match(/(?:fy\s*)?(20\d{2})\s*[-–/]\s*(20)?(\d{2})\b/i);
  if (m) {
    const a = +m[1];
    const b = +m[3];
    if ((a + 1) % 100 === b) return `FY ${a}-${String(b).padStart(2, '0')}`;
  }
  m = s.match(/^fy\s*'?(\d{2})$/i);
  if (m) {
    const e = 2000 + +m[1];
    return `FY ${e - 1}-${m[1]}`;
  }
  return null;
}

/** FY that contains a yyyy-mm month (Indian FY, April–March) */
export function fyOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function fyStartYear(fy: string): number {
  const m = fy.match(/(\d{4})/);
  return m ? +m[1] : 0;
}

export function shortFY(fy: string): string {
  const m = fy.match(/(\d{4})-(\d{2})/);
  return m ? `FY${m[2]}` : fy;
}

/** "Aug-22", "Apr-2024", "Mar-24", "2024-04" -> "2024-04" */
export function normMonth(v: unknown): string | null {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  const s = str(v).toLowerCase();
  let m = s.match(/^([a-z]{3})[a-z]*[-\s'/]*(\d{2}|\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1]);
    if (mi < 0) return null;
    const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    return `${y}-${String(mi + 1).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse 30-Apr-2024, 20-09-2023, 2024-04-30, 20/12/2024, Date, excel serial */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isoDate(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = str(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/ ](\d{2,4})$/i);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi < 0) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS[+m - 1].replace(/^./, (c) => c.toUpperCase())}-${y.slice(2)}`;
}

/* ---------- matrix helpers ---------- */
export function cell(mx: Matrix, r: number, c: number) {
  return mx[r]?.[c] ?? null;
}

/** first row index (>= from) where predicate on col A (or any col) holds */
export function findRow(mx: Matrix, re: RegExp, opts: { col?: number; from?: number; anyCol?: boolean } = {}): number {
  const { col = 0, from = 0, anyCol = false } = opts;
  for (let r = from; r < mx.length; r++) {
    const row = mx[r] || [];
    if (anyCol) {
      for (const v of row) if (re.test(str(v))) return r;
    } else if (re.test(str(row[col]))) return r;
  }
  return -1;
}

export function findCell(mx: Matrix, re: RegExp, from = 0): [number, number] | null {
  for (let r = from; r < mx.length; r++) {
    const row = mx[r] || [];
    for (let c = 0; c < row.length; c++) if (re.test(str(row[c]))) return [r, c];
  }
  return null;
}

/** Map of column index -> FY for a header row */
export function fyColumns(row: unknown[] | undefined): Map<number, string> {
  const out = new Map<number, string>();
  (row || []).forEach((v, i) => {
    const f = normFY(v);
    if (f) out.set(i, f);
  });
  return out;
}

export function monthColumns(row: unknown[] | undefined): Map<number, string> {
  const out = new Map<number, string>();
  (row || []).forEach((v, i) => {
    const m = normMonth(v);
    if (m) out.set(i, m);
  });
  return out;
}

export function sortFYs(fys: Iterable<string>): string[] {
  return [...new Set(fys)].sort((a, b) => fyStartYear(a) - fyStartYear(b));
}

/* ---------- party-name normalisation & matching ---------- */
const STOP = new Set([
  'm', 's', 'ms', 'mss', 'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'the', 'and', 'na', 'none',
  'nanonenone', 'nanone', 'india', 'enterprise', 'enterprises', 'traders', 'trading', 'inc', 'corp', 'corporation',
  'p', 'l', 'pl', 'opc', 'firm', 'industries', 'industry', 'works', 'international', 'intl',
]);
export function nameTokens(s: string): string[] {
  return str(s)
    .toLowerCase()
    .replace(/m\/s\.?/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}
export function normName(s: string): string {
  return nameTokens(s).join(' ');
}
/** 0..1 similarity on significant tokens (handles truncated bank narrations) */
const compact = (s: string) => str(s).toLowerCase().replace(/m\/s\.?/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).join('');
export function nameSimilarity(a: string, b: string): number {
  // spacing in bank narrations is unreliable ("R C LAMINATIONS" vs "r claminations")
  const ca = compact(a), cb = compact(b);
  if (ca.length >= 6 && cb.length >= 6 && (ca === cb || ca.startsWith(cb) || cb.startsWith(ca))) return 0.95;
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  let hit = 0;
  for (const t of A) if (B.some((u) => u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t) || t.startsWith(u))))) hit++;
  return hit / Math.min(A.length, B.length) * (Math.min(A.length, B.length) / Math.max(A.length, B.length)) ** 0.25;
}

export function sum(xs: (number | null | undefined)[]): number {
  let s = 0;
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x)) s += x;
  return s;
}

export function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function growth(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export function fyMapSum(map: FYMap): number {
  return sum(Object.values(map));
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
