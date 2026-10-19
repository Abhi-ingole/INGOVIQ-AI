/* GSTR-3B return PDF (as downloaded from the GST portal) → monthly outward supplies, ITC, filing date. */
import type { PdfDoc } from './pdf';
import { toLines } from './pdf';
import { num, parseDate } from '../utils';

export interface Gstr3b {
  gstin: string;
  legalName: string;
  period: string; // yyyy-mm
  fy: string;
  arn: string;
  filedOn: string; // yyyy-mm-dd
  taxable: number; // 3.1(a)
  zeroRated: number; // 3.1(b) exports / SEZ
  nilExempt: number; // 3.1(c)
  reverseCharge: number; // 3.1(d) inward RCM
  nonGst: number; // 3.1(e)
  outputTax: number; // IGST+CGST+SGST+cess on 3.1(a)+(b)
  itc: number; // 4(A) total available
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function looksLikeGstr3b(text: string) {
  return /form gstr-?3b/i.test(text) && /outward/i.test(text);
}

export function parseGstr3b(doc: PdfDoc): Gstr3b | null {
  const lines = doc.pages.flatMap((p) => toLines(p, 3));
  const text = lines.map((l) => l.text).join('\n');
  const gstin = text.match(/GSTIN of the supplier\s*([0-9]{2}[A-Z0-9]{13})/i)?.[1] || text.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/)?.[1] || '';
  const year = text.match(/Year\s*(20\d{2})-(\d{2})/i);
  const periodName = text.match(/Period\s*([A-Za-z]+)/i)?.[1]?.toLowerCase() || '';
  if (!year || !gstin) return null;
  const mi = MONTHS.findIndex((m) => periodName.startsWith(m.slice(0, 3)));
  if (mi < 0) return null;
  const y = mi + 1 >= 4 ? +year[1] : +year[1] + 1;
  const period = `${y}-${String(mi + 1).padStart(2, '0')}`;
  const filedOn = parseDate(text.match(/Date of ARN\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '') || '';

  // 3.1 rows: numeric rows after the "3.1" heading, in order (a)..(e); first number = taxable value
  const pageLines = toLines(doc.pages[0] || [], 3);
  const i31 = pageLines.findIndex((l) => /^3\.1\s+Details of Outward/i.test(l.text));
  const i311 = pageLines.findIndex((l, i) => i > i31 && /^3\.1\.1/.test(l.text));
  const rows: number[][] = [];
  if (i31 >= 0) {
    for (const l of pageLines.slice(i31 + 1, i311 > 0 ? i311 : i31 + 30)) {
      const nums = l.items.map((it) => it.str.trim()).filter((s) => /^-?[\d,]+\.\d{2}$/.test(s) || s === '-').map((s) => (s === '-' ? 0 : num(s) ?? 0));
      if (nums.length >= 4) rows.push(nums);
    }
  }
  const at = (r: number, c: number) => rows[r]?.[c] ?? 0;
  const outputTax = [0, 1].reduce((s, r) => s + (rows[r] ? rows[r].slice(1).reduce((a, b) => a + b, 0) : 0), 0);

  // 4(A) ITC available: rows (1)..(5) under "A. ITC Available"
  let itc = 0;
  const ia = lines.findIndex((l) => /ITC Available/i.test(l.text));
  if (ia >= 0) {
    for (const l of lines.slice(ia + 1, ia + 12)) {
      if (/ITC Reversed|^B\./i.test(l.text)) break;
      const nums = l.items.map((it) => it.str.trim()).filter((s) => /^-?[\d,]+\.\d{2}$/.test(s)).map((s) => num(s) ?? 0);
      if (nums.length >= 3) itc += nums.reduce((a, b) => a + b, 0);
    }
  }
  return {
    gstin, legalName: text.match(/Legal name of the registered person\s*(.+)/i)?.[1]?.trim() || '',
    period, fy: `FY ${year[1]}-${year[2]}`, arn: text.match(/\bARN\s*([A-Z]{2}\d{10,})/)?.[1] || '', filedOn,
    taxable: at(0, 0), zeroRated: at(1, 0), nilExempt: at(2, 0), reverseCharge: at(3, 0), nonGst: at(4, 0), outputTax, itc,
  };
}

/** GSTR-3B due date: 20th of the following month (monthly filers). */
export function gstr3bDue(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-20`;
}
