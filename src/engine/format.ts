/** Indian number formatting helpers (lakh / crore grouping). */
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function fmtINR(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v < 0 ? '-₹' : '₹') + (decimals ? nf2 : nf0).format(Math.abs(v));
}
export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return decimals ? v.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) : nf0.format(v);
}
/** ₹ in crore / lakh with 2 decimals — the way credit notes are written */
export function fmtCr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${nf0.format(a)}`;
}
export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}
export function fmtX(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(decimals)}x`;
}
export function fmtDays(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${Math.round(v)} days`;
}
export function fmtUnit(v: number | null | undefined, unit: string): string {
  switch (unit) {
    case 'inr': return fmtINR(v);
    case 'pct': return fmtPct(v, 2);
    case 'x': return fmtX(v);
    case 'days': return fmtDays(v);
    default: return v === null || v === undefined ? '—' : String(v);
  }
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2024-06-10 -> 10-Jun-24 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${MON[+m[2] - 1]}-${m[1].slice(2)}` : iso;
}
