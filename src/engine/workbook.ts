import * as XLSX from 'xlsx';
import type { Workbook, Matrix } from './types';
import { str } from './utils';

export function readWorkbook(data: ArrayBuffer, fileName: string): Workbook {
  // dense mode is several times faster for sheet_to_json on large report sheets
  const wb = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false, dense: true } as XLSX.ParsingOptions);
  const sheets: Record<string, Matrix> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const mx = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as Matrix;
    // report templates often format 15,000 empty rows — drop the blank tail so every parser scans less
    let end = mx.length;
    while (end > 0 && (mx[end - 1] || []).every((c) => c === null || c === undefined || c === '')) end--;
    sheets[name] = end < mx.length ? mx.slice(0, end) : mx;
  }
  return { fileName, sheets, sheetOrder: wb.SheetNames };
}

export type FileKind = 'financial' | 'gst' | 'banking' | 'unknown';

/** Decide what kind of report a workbook is, from sheet names first, then content. */
export function detectKind(wb: Workbook): FileKind {
  const names = wb.sheetOrder.map((s) => s.toLowerCase());
  const has = (re: RegExp) => names.some((n) => re.test(n));
  let bank = 0, gst = 0, fin = 0;
  if (has(/raw data|transactions|statement/)) bank += 2;
  if (has(/exec summary|cam analysis|mom summary|bounce|emi tracker|daily balances/)) bank += 3;
  if (has(/gstr|customer wise|supplier wise|state wise|summary analysis|intra group/)) gst += 4;
  if (has(/balance sheet|profit|p&l|financials?/)) fin += 3;
  // content scan of first rows
  const sample = wb.sheetOrder.slice(0, 40).map((s) => wb.sheets[s].slice(0, 15).map((r) => (r || []).map(str).join(' ')).join(' ')).join(' ').toLowerCase();
  if (/balance sheet/.test(sample)) fin += 2;
  if (/profit and loss|profit & loss/.test(sample)) fin += 2;
  if (/(cin|corpository|directors|charges)/.test(sample)) fin += 1;
  if (/gstin|gstr|adjusted revenue/.test(sample)) gst += 2;
  if (/(narration|cheque|account number|ifsc|net credits)/.test(sample)) bank += 2;
  const best = Math.max(bank, gst, fin);
  if (best < 2) return 'unknown';
  return best === gst ? 'gst' : best === bank ? 'banking' : 'financial';
}
