/* Excel formats found in loan files besides the analysis reports:
   - Tally "Ledger Vouchers" export (all ledgers)       → party-wise sales / purchases / receipts / payments
   - LoanBazaar "MOM" sales / purchase bills             → top parties month-on-month
   - Invoice ageing (debtors / creditors)                → outstanding ageing buckets + collection days
   - Loan obligation sheet                               → existing loans, EMI
   - INGOVIQ financial input template                     → FinancialData (when audited statements are scanned) */
import type { Workbook, Matrix, FinancialData, CleaningLog, FYMap } from '../types';
import { num, str, parseDate, normFY, sortFYs, isoDate } from '../utils';
import { ITEM_LABELS } from '../parseFinancial';

export type ExcelFormat = 'tally-ledger' | 'mom-sales' | 'mom-purchase' | 'ageing-debtors' | 'ageing-creditors' | 'loan-obligation' | 'financial-template' | 'blank-template' | null;

const rowsOf = (wb: Workbook): Matrix => wb.sheets[wb.sheetOrder[0]] || [];
const head = (mx: Matrix, n = 12) => mx.slice(0, n).map((r) => (r || []).map(str).join(' | ')).join('\n').toLowerCase();

/** Excel serial or text → ISO date */
export function xlDate(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (v instanceof Date) return isoDate(new Date(v.getTime() + 12 * 3600000));
  return parseDate(v);
}

export function detectExcelFormat(wb: Workbook): ExcelFormat {
  const all = wb.sheetOrder.map((s) => head(wb.sheets[s], 14)).join('\n');
  const name = wb.fileName.toLowerCase();
  if (/ingoviq financial input/.test(all)) return 'financial-template';
  if (/ledger vouchers/i.test(wb.sheetOrder.join(' ')) || (/ledger:/.test(all) && /vch type/.test(all))) return 'tally-ledger';
  if (/bills \(amt/.test(all)) return /purchase/.test(name) ? 'mom-purchase' : /sale/.test(name) ? 'mom-sales' : 'mom-sales';
  if (/invoice number/.test(all) && /ageing/.test(all)) return /payment date|payment amount/.test(all) || /cred/.test(name) ? 'ageing-creditors' : 'ageing-debtors';
  if (/financial institution name/.test(all) && /emi/.test(all)) return 'loan-obligation';
  if (/existing borrowing details|shareholding details/.test(all)) return 'blank-template';
  return null;
}

/* ---------------- Tally ledger vouchers ---------------- */
export interface LedgerParty { name: string; sales: Record<string, number>; purchases: Record<string, number>; receipts: number; payments: number; closing: number | null }
const NON_PARTY = /^(cash|h\.?d\.?f\.?c|yes bank|icici|sbi|axis|kotak|.*\bbank\b.*|.*(cgst|sgst|igst|cess|tds|tcs|gst).*|.*(sales|purchase)s?\b.*(\d+%|exempt|account|a\/c).*|exempt (sales|purchase)|round(ing)? off|.*(expenses?|charges|fee|salary|salaries|rent|interest|depreciation|commission|brokerage|freight|electricity|electricty|penalty|penality|insurance|loan|capital|drawings?|suspense|profit|loss|discount|bill)\b.*)$/i;

export function parseTallyLedgers(wb: Workbook, log: CleaningLog[]): { parties: LedgerParty[]; period: string } {
  const mx = rowsOf(wb);
  const parties: LedgerParty[] = [];
  let cur: LedgerParty | null = null;
  let period = '';
  for (const r of mx) {
    if (!r) continue;
    const c0 = str(r[0]);
    if (/^ledger:$/i.test(c0)) {
      cur = { name: str(r[1]).trim(), sales: {}, purchases: {}, receipts: 0, payments: 0, closing: null };
      parties.push(cur);
      period ||= str(r[2]);
      continue;
    }
    if (!cur) continue;
    if (/closing balance/i.test(str(r[2]))) {
      // Tally prints the closing balance on the balancing side, labelled with the balance's own side (Dr = owed to us)
      const amt = Math.abs(num(r[8]) ?? 0) || Math.abs(num(r[7]) ?? 0) || Math.abs(num(r[5]) ?? 0);
      cur.closing = /^cr$/i.test(str(r[1]).trim()) ? -amt : amt;
      continue;
    }
    const date = xlDate(r[0]);
    if (!date) continue;
    const vt = str(r[5]).toLowerCase(), d = num(r[7]) ?? 0, c = num(r[8]) ?? 0, m = date.slice(0, 7);
    if (vt === 'sales') cur.sales[m] = (cur.sales[m] || 0) + d - c;
    else if (vt === 'purchase') cur.purchases[m] = (cur.purchases[m] || 0) + c - d;
    else if (vt === 'receipt') cur.receipts += c;
    else if (vt === 'payment') cur.payments += d;
  }
  const real = parties.filter((p) => !NON_PARTY.test(p.name) && (Object.keys(p.sales).length || Object.keys(p.purchases).length));
  log.push({ source: wb.fileName, level: 'info', message: `Tally ledger export: ${parties.length} ledgers read, ${real.length} trading parties with sales/purchase vouchers (tax, bank, expense ledgers skipped).` });
  return { parties: real, period };
}

/* ---------------- LoanBazaar MOM bills ---------------- */
export interface MomParty { name: string; monthly: Record<string, number> }
export function parseMom(wb: Workbook, log: CleaningLog[]): MomParty[] {
  const mx0 = rowsOf(wb);
  const hi = mx0.findIndex((r) => (r || []).some((c) => /bills/i.test(str(c))));
  const mx = mx0.slice(Math.max(0, hi));
  const hdr = mx[0] || [];
  const out: MomParty[] = [];
  for (let c = 0; c < hdr.length - 1; c++) {
    if (!/bills/i.test(str(hdr[c]))) continue;
    const name = str(hdr[c + 1]).trim();
    if (!name || /^total$/i.test(name)) continue;
    const monthly: Record<string, number> = {};
    for (const r of mx.slice(1)) {
      const d = xlDate(r?.[c]); const v = num(r?.[c + 1]);
      if (d && v) monthly[d.slice(0, 7)] = (monthly[d.slice(0, 7)] || 0) + v;
    }
    out.push({ name, monthly });
  }
  log.push({ source: wb.fileName, level: 'info', message: `Month-on-month bills: ${out.length} parties.` });
  return out;
}

/* ---------------- Invoice ageing ---------------- */
export interface AgeingResult { side: 'receivable' | 'payable'; asOf: string; invoices: number; invoiced: number; settled: number; outstanding: number; buckets: Record<string, number>; avgDays: number | null; parties: { name: string; invoiced: number; outstanding: number; avgDays: number | null }[] }
export const AGE_BUCKETS = ['0–30 Days', '31–60 Days', '61–90 Days', '91–180 Days', 'Above 180 Days'];
export function bucketOf(days: number) { return days <= 30 ? AGE_BUCKETS[0] : days <= 60 ? AGE_BUCKETS[1] : days <= 90 ? AGE_BUCKETS[2] : days <= 180 ? AGE_BUCKETS[3] : AGE_BUCKETS[4]; }

export function parseAgeing(wb: Workbook, side: 'receivable' | 'payable', log: CleaningLog[]): AgeingResult {
  const mx = rowsOf(wb);
  // invoices and money received / paid, per party. Receipts are matched to the oldest open invoice first (FIFO),
  // because one receipt often settles several bills (or part of one).
  const inv = new Map<string, { party: string; date: string; amount: number }>();
  const paidBy = new Map<string, number>();
  const wDaysBy = new Map<string, number>();
  let maxDate = '';
  for (const r of mx.slice(1)) {
    if (!r || !str(r[1])) continue;
    const party = str(r[0]).trim(), no = str(r[1]).trim(), date = xlDate(r[2]) || '', amt = num(r[3]) ?? 0, pd = xlDate(r[4]) || '', paid = num(r[5]) ?? 0, age = num(r[6]);
    const adj = num(r[8]) ?? 0;
    const k = `${party}|${no}`;
    const e = inv.get(k) || { party, date, amount: 0 };
    e.amount = Math.max(e.amount, amt);
    inv.set(k, e);
    paidBy.set(party, (paidBy.get(party) || 0) + paid + Math.abs(adj));
    if (paid && age !== null) wDaysBy.set(party, (wDaysBy.get(party) || 0) + paid * age);
    for (const d of [date, pd]) if (d > maxDate) maxDate = d;
  }
  const asOf = maxDate;
  const buckets: Record<string, number> = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]));
  const parties: AgeingResult['parties'] = [];
  let invoiced = 0, settled = 0, outstanding = 0, wDays = 0, paidAll = 0;
  const byParty = new Map<string, { date: string; amount: number }[]>();
  for (const e of inv.values()) (byParty.get(e.party) || byParty.set(e.party, []).get(e.party)!).push(e);
  for (const [name, list] of byParty) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let pool = paidBy.get(name) || 0;
    const tot = list.reduce((a, b) => a + b.amount, 0);
    let os = 0;
    for (const e of list) {
      const used = Math.min(pool, e.amount); pool -= used;
      const open = e.amount - used;
      if (open > 0.5) { os += open; if (e.date) buckets[bucketOf(Math.max(0, (Date.parse(asOf) - Date.parse(e.date)) / 86400000))] += open; }
    }
    const paid = paidBy.get(name) || 0;
    invoiced += tot; settled += Math.min(tot, paid); outstanding += os; wDays += wDaysBy.get(name) || 0; paidAll += paid;
    parties.push({ name, invoiced: tot, outstanding: os, avgDays: paid ? (wDaysBy.get(name) || 0) / paid : null });
  }
  parties.sort((a, b) => b.invoiced - a.invoiced);
  log.push({ source: wb.fileName, level: 'info', message: `Invoice ageing (${side}): ${inv.size} invoices, ${parties.length} parties, ₹${Math.round(invoiced).toLocaleString('en-IN')} billed, outstanding ₹${Math.round(outstanding).toLocaleString('en-IN')} as on ${asOf} (receipts set off oldest-bill-first).` });
  return { side, asOf, invoices: inv.size, invoiced, settled, outstanding, buckets, avgDays: paidAll ? wDays / paidAll : null, parties };
}

/* ---------------- Loan obligation ---------------- */
export interface LoanRow { lender: string; facility: string; sanction: number | null; outstanding: number | null; emi: number | null; start: string; end: string; roi: number | null; tenure: string; paidFrom: string }
export function parseLoanObligation(wb: Workbook, log: CleaningLog[]): LoanRow[] {
  const mx = rowsOf(wb);
  const hi = mx.findIndex((r) => (r || []).some((c) => /financial institution/i.test(str(c))));
  if (hi < 0) return [];
  const h = (mx[hi] || []).map((c) => str(c).toLowerCase());
  const col = (re: RegExp) => h.findIndex((x) => re.test(x));
  const cL = col(/institution/), cF = col(/facility|type/), cS = col(/sanction/), cO = col(/outstanding/), cE = col(/emi amount/), cSt = col(/start/), cEn = col(/end/), cR = col(/roi/), cT = col(/tenure/), cB = col(/bank name/);
  const crS = /crore|cr\b/.test(h[cS] || ''), crO = /crore|cr\b/.test(h[cO] || '');
  const out: LoanRow[] = [];
  for (const r of mx.slice(hi + 1)) {
    const lender = str(r?.[cL]).trim();
    if (!lender || /^total/i.test(lender)) continue;
    const s = num(r?.[cS]), o = num(r?.[cO]);
    let roi = num(r?.[cR]);
    if (roi !== null && roi > 1) roi /= 100;
    out.push({ lender, facility: str(r?.[cF]).trim(), sanction: s === null ? null : crS ? s * 1e7 : s, outstanding: o === null ? null : crO ? o * 1e7 : o, emi: num(r?.[cE]), start: xlDate(r?.[cSt]) || '', end: xlDate(r?.[cEn]) || '', roi, tenure: str(r?.[cT]), paidFrom: str(r?.[cB]) });
  }
  log.push({ source: wb.fileName, level: 'info', message: `Loan obligation sheet: ${out.length} facilities, total EMI ₹${Math.round(out.reduce((a, b) => a + (b.emi || 0), 0)).toLocaleString('en-IN')}/month.` });
  return out;
}

/* ---------------- Financial input template ---------------- */
const LABEL_TO_KEY = Object.fromEntries(Object.entries(ITEM_LABELS).map(([k, l]) => [l.toLowerCase(), k]));

export function parseFinancialTemplate(wb: Workbook, log: CleaningLog[]): FinancialData | null {
  const mx = rowsOf(wb);
  const hi = mx.findIndex((r) => (r || []).filter((c) => normFY(c)).length >= 1 && /line item/i.test(str(r?.[0])));
  if (hi < 0) return null;
  const fyCols = (mx[hi] || []).map((c, i) => [i, normFY(c)] as const).filter(([, f]) => f) as [number, string][];
  const items: Record<string, FYMap> = {};
  const rawRows: FinancialData['rawRows'] = [];
  for (const r of mx.slice(hi + 1)) {
    const label = str(r?.[0]).trim();
    const key = LABEL_TO_KEY[label.toLowerCase()];
    if (!key) continue;
    const values: FYMap = {};
    for (const [c, fy] of fyCols) { const v = num(r?.[c]); if (v !== null) values[fy] = v; }
    if (Object.keys(values).length) { items[key] = values; rawRows.push({ sheet: wb.sheetOrder[0], label, key, values }); }
  }
  const company = str(mx.slice(0, hi).flat().find((c) => /^company\s*:/i.test(str(c)))).replace(/^company\s*:\s*/i, '') || str(mx[1]?.[1]);
  const fys = sortFYs(fyCols.map(([, f]) => f).filter((f) => Object.values(items).some((m) => m[f] !== undefined)));
  log.push({ source: wb.fileName, level: 'info', message: `INGOVIQ financial input template: ${Object.keys(items).length} line items for ${fys.join(', ') || 'no years'}.` });
  return { company, fys, items, rawRows, profile: {}, directors: [], charges: [], gstFilings: [], flags: [] };
}
