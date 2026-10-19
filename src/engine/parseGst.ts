import type { Workbook, GstData, GstParty, FYMap, CleaningLog, GstFiling, Matrix } from './types';
import { str, num, n0, normFY, normMonth, monthColumns, fyColumns, findRow, findCell, sortFYs, fyOfMonth, parseDate, daysBetween } from './utils';

const sheetBy = (wb: Workbook, re: RegExp) => {
  const name = wb.sheetOrder.find((s) => re.test(s.toLowerCase()));
  return name ? wb.sheets[name] : null;
};

/** Read a "label | month1 | month2 ..." style row given its header row */
function rowByMonth(mx: Matrix, headerRow: number, r: number): Record<string, number> {
  const out: Record<string, number> = {};
  monthColumns(mx[headerRow]).forEach((m, c) => {
    const v = num(mx[r]?.[c]);
    if (v !== null) out[m] = (out[m] || 0) + v;
  });
  return out;
}

/** Collect all monthly values for rows whose label matches `re`, across monthly blocks in a sheet */
function monthlySeries(mx: Matrix, re: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  let header = -1;
  for (let r = 0; r < mx.length; r++) {
    if (monthColumns(mx[r]).size >= 1 && /particulars/i.test(str(mx[r]?.[0]))) header = r;
    if (header >= 0 && re.test(str(mx[r]?.[0]))) {
      const vals = rowByMonth(mx, header, r);
      for (const [m, v] of Object.entries(vals)) if (out[m] === undefined) out[m] = v;
    }
  }
  return out;
}

/** Values of the first row matching `re` under the nearest FY header */
function fyRow(mx: Matrix, re: RegExp, from = 0): FYMap | null {
  let header: Map<number, string> | null = null;
  for (let r = from; r < mx.length; r++) {
    const fc = fyColumns(mx[r]);
    if (fc.size >= 1) header = fc;
    if (header && re.test(str(mx[r]?.[0]))) {
      const out: FYMap = {};
      header.forEach((fy, c) => (out[fy] = num(mx[r]?.[c])));
      return out;
    }
  }
  return null;
}

function parseParties(mx: Matrix | null, nameRe: RegExp): GstParty[] {
  if (!mx) return [];
  const hr = findRow(mx, nameRe);
  if (hr < 0) return [];
  const header = mx[hr] || [];
  const mcols = monthColumns(header);
  const fcols = fyColumns(header);
  const out: GstParty[] = [];
  for (let r = hr + 1; r < mx.length; r++) {
    const name = str(mx[r]?.[0]);
    if (!name) { if (out.length) break; else continue; }
    if (/^(total|grand total|sub-? ?total|others?)\b|adjusted (revenue|purchase)|\btotal\b/i.test(name)) break;
    const monthly: Record<string, number> = {};
    mcols.forEach((m, c) => { const v = num(mx[r]?.[c]); if (v) monthly[m] = v; });
    const byFY: FYMap = {};
    fcols.forEach((fy, c) => (byFY[fy] = num(mx[r]?.[c]) ?? 0));
    // derive FY totals from months if the sheet has none
    if (!fcols.size) for (const [m, v] of Object.entries(monthly)) { const fy = fyOfMonth(m); byFY[fy] = (byFY[fy] || 0) + v; }
    out.push({ name, gstin: str(mx[r]?.[1]), monthly, byFY });
  }
  return out;
}

/** Two-row header blocks: row h has FY/period label (merged), row h+1 has AMOUNT / % */
function stateBlock(mx: Matrix | null, titleRe: RegExp) {
  const res: { state: string; code: string; byFY: FYMap }[] = [];
  let exportsFY: FYMap = {};
  if (!mx) return { rows: res, exportsFY };
  const t = findRow(mx, titleRe);
  if (t < 0) return { rows: res, exportsFY };
  const h = findRow(mx, /^particulars$/i, { from: t });
  const fy = fyColumns(mx[h]);
  for (let r = h + 2; r < mx.length; r++) {
    const label = str(mx[r]?.[0]);
    if (!label) continue;
    if (/^sub-? ?total|^total|^adjusted revenue|^others/i.test(label)) break;
    const byFY: FYMap = {};
    fy.forEach((f, c) => (byFY[f] = num(mx[r]?.[c]) ?? 0));
    if (/^exports?$/i.test(label)) { exportsFY = byFY; continue; }
    if (/^(exempted|nil rated|non gst)$/i.test(label)) continue;
    res.push({ state: label, code: str(mx[r]?.[1]), byFY });
  }
  return { rows: res, exportsFY };
}

function parseFilingBlocks(mx: Matrix | null): GstFiling[] {
  if (!mx) return [];
  const out: GstFiling[] = [];
  // state for each GSTIN from profile blocks
  const stateOf: Record<string, string> = {};
  for (let r = 0; r < Math.min(mx.length, 60); r++) {
    const row = mx[r] || [];
    row.forEach((v, c) => {
      const m = str(v).match(/profile details\s*-\s*(\w{15})/i);
      if (m) {
        const sr = findRow(mx, /^state$/i, { from: r });
        if (sr >= 0) stateOf[m[1]] = str(mx[sr]?.[c]);
      }
    });
  }
  for (let r = 0; r < mx.length; r++) {
    const row = mx[r] || [];
    for (let c = 0; c < row.length; c++) {
      const m = str(row[c]).match(/filing details\s*(gstr\s*-?\s*\w+)\s*-\s*(\w{15})/i);
      if (!m) continue;
      const type = m[1].toUpperCase().replace(/[\s-]/g, '');
      const gstin = m[2].toUpperCase();
      const hdr = (mx[r + 1] || []).slice(c, c + 5).map(str);
      if (!/financial year/i.test(hdr[0])) continue;
      for (let k = r + 2; k < mx.length; k++) {
        const fyv = normFY(mx[k]?.[c]);
        const period = normMonth(mx[k]?.[c + 1]);
        if (!fyv || !period) break;
        const due = parseDate(mx[k]?.[c + 2]) || '';
        const filed = parseDate(mx[k]?.[c + 3]) || '';
        const d = num(mx[k]?.[c + 4]);
        out.push({ gstin, state: stateOf[gstin] || '', returnType: type, fy: fyOfMonth(period), period, due, filed, delayDays: d ?? (due && filed ? Math.max(0, daysBetween(due, filed)) : 0) });
      }
    }
  }
  return out;
}

export function parseGst(wb: Workbook, log: CleaningLog[]): GstData {
  const src = wb.fileName;
  const summary = sheetBy(wb, /^summary$/) || sheetBy(wb, /summary/);
  const revenueMonthly = summary ? monthlySeries(summary, /^adjusted revenue \(total\)|^total revenue|^gross revenue/i) : {};
  const purchaseMonthly = summary ? monthlySeries(summary, /^adjusted purchases? and expenses \(total\)|^total purchases?/i) : {};

  let revenueFY: FYMap = (summary && fyRow(summary, /^adjusted revenue \(total\)/i)) || {};
  let purchaseFY: FYMap = (summary && fyRow(summary, /^adjusted purchases? and expenses \(total\)/i)) || {};
  const fromMonths = (m: Record<string, number>) => {
    const o: FYMap = {};
    for (const [k, v] of Object.entries(m)) { const f = fyOfMonth(k); o[f] = (o[f] || 0) + v; }
    return o;
  };
  if (!Object.keys(revenueFY).length) revenueFY = fromMonths(revenueMonthly);
  if (!Object.keys(purchaseFY).length) purchaseFY = fromMonths(purchaseMonthly);
  // cross-check FY totals with monthly sums
  const mfy = fromMonths(revenueMonthly);
  for (const [fy, v] of Object.entries(revenueFY)) {
    if (v != null && mfy[fy] != null && Math.abs((mfy[fy] as number) - v) > 1) log.push({ source: src, level: 'warn', message: `GST ${fy}: yearly revenue ${v.toFixed(0)} differs from sum of months ${(mfy[fy] as number).toFixed(0)}.` });
  }

  const customers = parseParties(sheetBy(wb, /customer wise|customerwise|buyer/), /customer'?s? name|buyer'?s? name|^party name/i);
  const suppliers = parseParties(sheetBy(wb, /supplier wise|supplierwise|vendor/), /supplier'?s? name|vendor'?s? name|^party name/i);

  const stateSheet = sheetBy(wb, /state wise|statewise/);
  const sr = stateBlock(stateSheet, /state wise bifurcation of revenue|state-wise revenue/i);
  const sp = stateBlock(stateSheet, /state wise bifurcation of purchase|state-wise purchase/i);

  const exportFY = sr.exportsFY;
  const domesticFY: FYMap = {};
  for (const [fy, v] of Object.entries(revenueFY)) domesticFY[fy] = v == null ? null : v - (exportFY[fy] ?? 0);

  // intra-group revenue
  const intraGroupFY: FYMap = {};
  const ig = sheetBy(wb, /intra ?group/);
  if (ig) {
    const h = findRow(ig, /^particulars$/i);
    if (h >= 0) {
      const fy = fyColumns(ig[h]);
      const sub = (ig[h + 1] || []).map(str);
      fy.forEach((f, c) => {
        let col = -1;
        for (let k = c; k < c + 5; k++) if (/intra group (revenue|sales)/i.test(sub[k] || '')) { col = k; break; }
        if (col < 0) return;
        let s = 0;
        for (let r = h + 2; r < ig.length; r++) {
          const a = str(ig[r]?.[0]);
          if (a && !/^revenue$/i.test(a)) break;
          s += n0(ig[r]?.[col]);
        }
        intraGroupFY[f] = s;
      });
    }
  }

  // GSTR1 vs GSTR3B
  const g3 = sheetBy(wb, /gstr ?3b/);
  const gstr1vs3b: GstData['gstr1vs3b'] = [];
  if (g3) {
    const h = findRow(g3, /^particulars$/i);
    const r1 = findRow(g3, /as per gstr ?1/i, { from: h });
    const r3 = findRow(g3, /as per gstr ?3b/i, { from: h });
    if (h >= 0 && r1 > 0 && r3 > 0) {
      monthColumns(g3[h]).forEach((m, c) => gstr1vs3b.push({ month: m, gstr1: n0(g3[r1]?.[c]), gstr3b: n0(g3[r3]?.[c]) }));
    }
  }

  // tax rate estimate from yearly return summary
  let taxRateEstimate: number | null = null;
  const yr = sheetBy(wb, /yearly return/);
  if (yr) {
    const r = findRow(yr, /^adjusted revenue \(total\)/i);
    const h = findRow(yr, /^particulars$/i);
    if (r > 0 && h >= 0) {
      let amt = 0, tax = 0;
      const sub = (yr[h + 1] || []).map(str);
      sub.forEach((s, c) => {
        if (/^amount$/i.test(s)) amt += n0(yr[r]?.[c]);
        if (/total gst/i.test(s)) tax += n0(yr[r]?.[c]);
      });
      if (amt > 0 && tax > 0) taxRateEstimate = tax / amt;
    }
  }

  // HSN (if a sheet exists)
  const hsn: GstData['hsn'] = [];
  const hs = sheetBy(wb, /hsn/);
  if (hs) {
    const hc = findCell(hs, /^hsn/i);
    if (hc) {
      const fy = fyColumns(hs[hc[0]]);
      for (let r = hc[0] + 1; r < hs.length; r++) {
        const code = str(hs[r]?.[hc[1]]);
        if (!code) continue;
        const byFY: FYMap = {};
        fy.forEach((f, c) => (byFY[f] = num(hs[r]?.[c]) ?? 0));
        hsn.push({ code, product: str(hs[r]?.[hc[1] + 1]), byFY });
      }
    }
  }

  const filings = parseFilingBlocks(sheetBy(wb, /profile|filing/));
  const gstins = [...new Set([...filings.map((f) => f.gstin), ...(str(summary?.[1]?.[0]).match(/\d{2}[A-Z]{5}\d{4}[A-Z]\w{3}/g) || [])])];

  const months = [...new Set([...Object.keys(revenueMonthly), ...Object.keys(purchaseMonthly)])].sort();
  const fys = sortFYs([...Object.keys(revenueFY), ...months.map(fyOfMonth)]);
  log.push({ source: src, level: 'info', message: `GST: ${months.length} months (${months[0] || '-'} to ${months[months.length - 1] || '-'}), ${customers.length} customers, ${suppliers.length} suppliers, ${filings.length} return filings, ${gstins.length} GSTINs.` });
  if (!hsn.length) log.push({ source: src, level: 'warn', message: 'No HSN-wise sheet in GST file — HSN/product analysis will show "data not provided".' });

  return {
    company: str(summary?.[0]?.[0]) || wb.fileName,
    gstins, fys, months, revenueMonthly, purchaseMonthly, revenueFY, purchaseFY,
    customers, suppliers, statesRevenue: sr.rows, statesPurchase: sp.rows, exportFY, domesticFY, intraGroupFY,
    gstr1vs3b, filings, taxRateEstimate, hsn,
  };
}
