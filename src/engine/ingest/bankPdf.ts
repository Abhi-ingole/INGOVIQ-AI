/* Bank statement PDF → transactions. Works on column positions (header x) with a
   running-balance check, so it handles HDFC, YES, ICICI, SBI, Axis-style layouts. */
import type { PdfDoc, PdfItem, PdfLine } from './pdf';
import { toLines, docText } from './pdf';
import type { BankTxn, BankAccount } from '../types';
import { num, parseDate } from '../utils';

const DATE_RE = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4})$/;
const AMT_RE = /^-?[\d,]+\.\d{1,2}(\s*\(?(cr|dr)\)?)?$/i;
const BANKS = ['HDFC', 'YES BANK', 'ICICI', 'STATE BANK OF INDIA', 'SBI', 'AXIS', 'KOTAK', 'INDUSIND', 'IDFC', 'BANK OF BARODA', 'CANARA', 'PUNJAB NATIONAL', 'UNION BANK', 'FEDERAL', 'RBL', 'CITY UNION', 'KARUR VYSYA', 'IDBI', 'BANK OF INDIA', 'INDIAN BANK', 'UCO', 'CENTRAL BANK'];

interface Col { kind: 'date' | 'desc' | 'ref' | 'vdate' | 'debit' | 'credit' | 'balance'; center: number; right: number; x: number }
interface Cols { list: Col[]; descLeft: number; debit: number; credit: number; balance: number }

function parseDateAny(s: string): string | null {
  const t = s.trim();
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return parseDate(t.replace(/ /g, '-'));
}

const KIND: [Col['kind'], RegExp][] = [
  ['balance', /balance/i],
  ['debit', /withdraw|^debits?$|^dr\.?$|debit\s*amount/i],
  ['credit', /deposit|^credits?$|^cr\.?$|credit\s*amount/i],
  ['desc', /description|narration|particulars|transaction\s*details|remarks/i],
  ['ref', /ref|chq|cheque|instrument/i],
  ['vdate', /value/i],
  ['date', /date|^transaction$|^txn$/i],
];

function headerCols(line: PdfLine, next?: PdfLine): Cols | null {
  const items = [...line.items, ...(next && Math.abs(next.y - line.y) < 14 ? next.items : [])];
  const list: Col[] = [];
  for (const it of items) {
    const k = KIND.find(([, re]) => re.test(it.str.trim()));
    if (!k) continue;
    // merge multi-word headers of the same kind that sit close together
    const ex = list.find((c) => c.kind === k[0] && Math.abs(c.center - (it.x + it.w / 2)) < 60);
    if (ex) { ex.right = Math.max(ex.right, it.x + it.w); ex.x = Math.min(ex.x, it.x); ex.center = (ex.x + ex.right) / 2; continue; }
    list.push({ kind: k[0], center: it.x + it.w / 2, right: it.x + it.w, x: it.x });
  }
  // extend headers over trailing words ("Debit" + "Amount", "Withdrawal" + "Amt.")
  for (const c of list) {
    for (const it of items) {
      if (it.x > c.right - 1 && it.x - c.right < 14 && /^(amount|amt\.?|\(inr\)|\(₹\)|\(rs\.?\)|rs\.?)$/i.test(it.str.trim())) { c.right = it.x + it.w; c.center = (c.x + c.right) / 2; }
    }
  }
  // a generic word stacked above a specific header ("Transaction" over "Description") is not its own column
  const specific = list.filter((c) => ['desc', 'debit', 'credit', 'balance'].includes(c.kind));
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (['date', 'vdate', 'ref'].includes(c.kind) && specific.some((sp) => Math.abs(sp.x - c.x) < 12 || Math.abs(sp.center - c.center) < 15)) list.splice(i, 1);
  }
  const get = (k: Col['kind']) => list.find((c) => c.kind === k);
  const bal = get('balance'), desc = get('desc'), deb = get('debit'), cre = get('credit');
  if (!bal || !desc || (!deb && !cre)) return null;
  const left = list.filter((c) => c.center < desc.center).sort((a, b) => b.center - a.center)[0];
  return { list, descLeft: left ? (left.center + desc.center) / 2 - 40 : desc.x - 40, debit: deb ? deb.right : -1, credit: cre ? cre.right : -1, balance: bal.right };
}

function nearestKind(cols: Cols, it: PdfItem): Col['kind'] {
  const c = it.x + it.w / 2;
  let best = cols.list[0], bd = Infinity;
  for (const col of cols.list) {
    // long narration items start under the column; compare both start and centre
    const d = Math.min(Math.abs(col.center - c), Math.abs(col.x - it.x));
    if (d < bd) { bd = d; best = col; }
  }
  return best.kind;
}

export interface ParsedStatement { account: BankAccount; txns: Omit<BankTxn, 'id'>[]; method: string; balanceMismatches: number }

export function looksLikeBankStatement(text: string): boolean {
  const t = text.toLowerCase();
  return /(statement of account|account statement|bank statement|transaction details)/.test(t) && /(balance)/.test(t) && /(withdraw|debit)/.test(t) && /(deposit|credit)/.test(t);
}

export function parseBankStatement(doc: PdfDoc, fileName: string): ParsedStatement {
  const head = docText(doc, 1);
  const accNo = (head.match(/(?:account\s*(?:no\.?|number)\s*[:.]?\s*|statement of account\s*:\s*|a\/c\s*no\.?\s*[:.]?\s*)(\d{9,18})/i) || head.match(/\b(\d{11,18})\b/))?.[1] || fileName.match(/\((\d{4})\)/)?.[1] || 'Account';
  const up = head.toUpperCase();
  const IFSC: Record<string, string> = { YESB: 'YES BANK', HDFC: 'HDFC BANK', ICIC: 'ICICI BANK', SBIN: 'STATE BANK OF INDIA', UTIB: 'AXIS BANK', KKBK: 'KOTAK MAHINDRA BANK', INDB: 'INDUSIND BANK', IDFB: 'IDFC FIRST BANK', BARB: 'BANK OF BARODA', CNRB: 'CANARA BANK', PUNB: 'PUNJAB NATIONAL BANK', UBIN: 'UNION BANK OF INDIA', FDRL: 'FEDERAL BANK', RATN: 'RBL BANK', CIUB: 'CITY UNION BANK', KVBL: 'KARUR VYSYA BANK', IBKL: 'IDBI BANK', BKID: 'BANK OF INDIA', IDIB: 'INDIAN BANK', UCBA: 'UCO BANK', CBIN: 'CENTRAL BANK OF INDIA' };
  const ifsc = head.match(/IFSC(?:\s*code)?\s*[:.]?\s*([A-Z]{4})0/i)?.[1]?.toUpperCase();
  const bank = (ifsc && IFSC[ifsc]) || BANKS.find((b) => fileName.toUpperCase().includes(b)) || BANKS.find((b) => up.includes(b)) || '';
  const odLimit = num(head.match(/(?:od|cc|drawing power|sanction(?:ed)?)\s*limit\s*[:.]?\s*([\d,]+(?:\.\d+)?)/i)?.[1]);
  const type = /overdraft|cash credit|\bod\b account|\bcc\b account/i.test(head) || (odLimit ?? 0) > 0 ? 'Overdraft / Cash Credit' : 'Current Account';
  const period = head.match(/(?:from\s*:?\s*)(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}).{0,20}?to\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)?.slice(1).join(' to ') || head.match(/statement (?:type|period)\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';

  const raw: { date: string; desc: string; debit: number; credit: number; balance: number | null; amounts: { v: number; x: number; c: number }[] }[] = [];
  let cols: Cols | null = null;
  for (const pageItems of doc.pages) {
    const lines = toLines(pageItems);
    let cur: (typeof raw)[number] | null = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const hc = headerCols(ln, lines[i + 1]);
      if (hc && /balance/i.test(ln.text)) { cols = hc; cur = null; continue; }
      if (!cols) continue;
      const first = ln.items[0];
      const firstTok = first?.str.trim().split(/\s+/).slice(0, first.str.includes('-') && /[A-Za-z]{3}/.test(first.str) ? 3 : 1).join(' ') || '';
      const isDate = !!first && first.x < cols.descLeft + 60 && (DATE_RE.test(first.str.trim()) || DATE_RE.test(firstTok));
      const amounts = ln.items.filter((it) => AMT_RE.test(it.str.trim()) && ['debit', 'credit', 'balance'].includes(nearestKind(cols!, it))).map((it) => ({ v: num(it.str.replace(/\(?(cr|dr)\)?/i, '')) as number, x: it.x + it.w, c: it.x + it.w / 2, dr: /dr\)?$/i.test(it.str.trim()) }));
      const descText = ln.items.filter((it) => !AMT_RE.test(it.str.trim()) && !DATE_RE.test(it.str.trim()) && nearestKind(cols!, it) === 'desc')
        .map((it) => (DATE_RE.test(it.str.trim().split(/\s+/)[0]) ? it.str.trim().split(/\s+/).slice(1).join(' ') : it.str)).join(' ').trim();
      const assign = (rec: (typeof raw)[number], list: typeof amounts) => {
        const colOf = (k: Col['kind']) => cols!.list.find((c) => c.kind === k);
        const dist = (a: { x: number; c: number }, k: Col['kind']) => { const c = colOf(k); return c ? Math.min(Math.abs(a.x - c.right), Math.abs(a.c - c.center)) : Infinity; };
        for (const a of list) {
          const d = { debit: dist(a, 'debit'), credit: dist(a, 'credit'), balance: dist(a, 'balance') };
          const k = (Object.keys(d) as (keyof typeof d)[]).sort((p, q) => d[p] - d[q])[0];
          if (k === 'balance') { if (rec.balance === null) rec.balance = a.dr ? -Math.abs(a.v) : a.v; }
          else if (k === 'debit') { if (!rec.debit) rec.debit = Math.abs(a.v); }
          else if (!rec.credit) rec.credit = Math.abs(a.v);
          rec.amounts.push(a);
        }
      };
      const isFooter = /statement of account|page no|^page \d|opening balance|closing balance|generated on|this is a computer|^date\b|statement summary|^\*/i.test(ln.text);
      if (isDate) {
        const date = parseDateAny(DATE_RE.test(first.str.trim()) ? first.str : firstTok);
        if (!date) continue;
        cur = { date, desc: descText, debit: 0, credit: 0, balance: null, amounts: [] };
        assign(cur, amounts);
        raw.push(cur);
      } else if (isFooter) {
        cur = null;
      } else if (cur) {
        // amounts can sit on a wrapped line (vertically centred rows); narration continues without a space
        if (amounts.length && !cur.amounts.length) assign(cur, amounts);
        if (descText) cur.desc += descText;
      }
    }
  }
  for (let i = raw.length - 1; i >= 0; i--) if (!raw[i].amounts.length || raw[i].balance === null && !raw[i].debit && !raw[i].credit) raw.splice(i, 1);

  // order: make chronological, then fix intra-day order using the running balance
  const chrono = raw.length < 2 || raw[0].date <= raw[raw.length - 1].date;
  const ordered = (chrono ? raw : [...raw].reverse()).map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i).map((x) => x.r);
  const seq = chainByBalance(ordered);
  let mismatches = 0;
  for (let i = 1; i < seq.length; i++) {
    const p = seq[i - 1].balance, c = seq[i].balance;
    if (p === null || c === null) continue;
    if (Math.abs(p + seq[i].credit - seq[i].debit - c) > 1) {
      // column assignment can fail on oddly aligned rows: the balance movement decides
      const delta = c - p;
      const amt = seq[i].debit || seq[i].credit;
      if (Math.abs(Math.abs(delta) - amt) <= 1) {
        if (delta > 0) { seq[i].credit = amt; seq[i].debit = 0; } else { seq[i].debit = amt; seq[i].credit = 0; }
      } else mismatches++;
    }
  }
  const txns = seq.map((r) => ({
    date: r.date, month: r.date.slice(0, 7), description: r.desc.replace(/\s+/g, ' ').trim(), debit: r.debit, credit: r.credit, balance: r.balance,
    category: categoryOf(r.desc, r.debit, r.credit), party: '', account: accNo, bank,
  }));
  return { account: { account: accNo, bank, type, period, sanction: odLimit && odLimit > 0 ? odLimit : null }, txns, method: chrono ? 'chronological' : 'reverse-chronological', balanceMismatches: mismatches };
}

/** Category from narration (bank-analysis tools supply this; for raw statements we infer it). */
export function categoryOf(desc: string, debit: number, credit: number): string {
  const d = desc.toUpperCase();
  if (credit > 0 && /CASH DEP|BY CASH|CASH DEPOSIT|CDM/.test(d)) return 'Cash Deposit';
  if (debit > 0 && /ATM|CASH WDL|CASH WITHDRAWAL|SELF CHQ|CASH PAID/.test(d)) return 'Cash Withdrawal';
  if (/PENAL/.test(d)) return 'Penal Charges';
  if (debit > 0 && /(RETURN|RTN|BOUNCE|DISHONOU?R).*(CHG|CHARGE)|(CHG|CHARGE).*(RETURN|RTN|BOUNCE)/.test(d)) return 'Cheque Return Charges';
  if (credit > 0 && /(RETURN|RTN|REVERSAL|REV\b|REJ|INSUFFICIENT|UNPAID|BOUNCE)/.test(d)) return 'Inward Payment Bounce';
  if (debit > 0 && /(I\/W|INWARD).*(RETURN|RTN)|O\/W RTN/.test(d)) return 'Outward Cheque Return';
  if (credit > 0 && /DISB|LOAN A\/C|LOAN DISBURS/.test(d)) return 'Loan Disbursal';
  if (debit > 0 && /\bEMI\b|NACH|ACH D|ECS|LOAN REPAY|AUTOPAY/.test(d)) return 'EMI';
  if (debit > 0 && /INT\.? ?(PAID|COLL|DEBIT|RECOVERY)|INTEREST|INT ON OD|INT\.CAP/.test(d)) return 'Interest Paid';
  if (debit > 0 && /CHRG|CHARGES|COMMISSION|GST ON|SMS ALERT|MAB|AMC/.test(d)) return 'Bank Charges';
  if (debit > 0 && /GST|TDS|INCOME TAX|CBDT|GSTN|CHALLAN/.test(d)) return 'Statutory Payment-Tax';
  if (credit > 0 && /INT\.? ?(CR|CREDIT)|INTEREST CREDIT|REFUND/.test(d)) return 'Interest / Refund';
  return 'Fund Transfer';
}

/** Within each day, order rows so that every balance = previous balance + credit − debit (statements often list a day's rows out of order). */
export function chainByBalance<T extends { date: string; debit: number; credit: number; balance: number | null }>(rows: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  let prevBal: number | null = null;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].date === rows[i].date) j++;
    const day = rows.slice(i, j);
    // depth-first chain with backtracking (identical balances inside a day make greedy choice unsafe)
    const build = (startBal: number | null, first?: number): T[] | null => {
      const used = new Array(day.length).fill(false);
      const chain: T[] = [];
      let steps = 0;
      const dfs = (cur: number): boolean => {
        if (chain.length === day.length) return true;
        if (++steps > 50000) return false;
        for (let k = 0; k < day.length; k++) {
          if (used[k]) continue;
          const r = day[k];
          if (Math.abs(cur + r.credit - r.debit - (r.balance as number)) > 1) continue;
          used[k] = true; chain.push(r);
          if (dfs(r.balance as number)) return true;
          used[k] = false; chain.pop();
        }
        return false;
      };
      if (first !== undefined) { used[first] = true; chain.push(day[first]); return dfs(day[first].balance as number) ? chain : null; }
      return startBal !== null && dfs(startBal) ? chain : null;
    };
    let best: T[] | null = null;
    if (day.length > 1 && !day.some((r) => r.balance === null)) {
      best = prevBal !== null ? build(prevBal) : null;
      // gap before this day (missing statement period): find a row from which the whole day chains
      for (let s = 0; !best && s < day.length && day.length <= 300; s++) best = build(null, s);
    }
    out.push(...(best || day));
    const last = out[out.length - 1];
    prevBal = last?.balance ?? prevBal;
    i = j;
  }
  return out;
}
