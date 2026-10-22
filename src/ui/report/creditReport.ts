/* INGOVIZ Credit Analysis Report — a text-based (searchable) PDF that follows the
   "Integrated Financial, GST, Banking & Credit Analysis Report" format, sections 1–40.
   Every table carries its evidence: the uploaded file (and page / sheet / row) or the formula used.
   Target length 50–70 pages: the core report first, then annexures sized to fill the budget. */
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type UserOptions } from 'jspdf-autotable';
import type { Analysis } from '../../engine/analyse';
import type { Dataset, ManualInputs, DocEntry } from '../../engine/types';
import type { Metric } from '../../engine/calcFinancial';
import { fmtINR, fmtCr, fmtPct, fmtX, fmtDays, fmtDate, fmtUnit } from '../../engine/format';
import { monthLabel, fyOfMonth } from '../../engine/utils';
import { ITEM_LABELS } from '../../engine/parseFinancial';
import { companySnapshot } from '../snapshot';
import { DISCLAIMER } from '../common';
import type { ChartSpec, ChartType } from '../Chart';

export interface ReportOptions {
  includeDisclaimer: boolean;
  minPages: number;
  maxPages: number;
  chartImage?: (spec: ChartSpec, type: ChartType, w: number, h: number) => Promise<string | null>;
  logo?: string;
  onProgress?: (msg: string) => void;
}

/* ---------- text helpers: standard PDF fonts have no ₹ / arrows — write them in plain text ---------- */
const T = (v: unknown): string => String(v ?? '—')
  .replace(/-?₹/g, (m) => (m.startsWith('-') ? '-Rs ' : 'Rs '))
  .replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[▲]/g, '+').replace(/[▼]/g, '-')
  .replace(/[●◆■○◔◎▮▬▤▦⤓⇄⤢]/g, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/ /g, ' ');
const inr = (v: number | null | undefined) => T(fmtINR(v));
const cr = (v: number | null | undefined) => T(fmtCr(v));
const pct = (v: number | null | undefined, d = 1) => T(fmtPct(v, d));
const xx = (v: number | null | undefined) => T(fmtX(v));
const unit = (v: number | null | undefined, u: string) => T(fmtUnit(v, u));
const shortName = (p: string) => p.split('/').pop() || p;

const NAVY: [number, number, number] = [11, 27, 63];
const BRAND: [number, number, number] = [31, 79, 209];
const GREY: [number, number, number] = [105, 112, 125];

export async function buildCreditReport(a: Analysis, ds: Dataset, inp: ManualInputs, opt: ReportOptions): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 14, bottom = H - (opt.includeDisclaimer ? 26 : 14);
  let y = M;
  const toc: { label: string; page: number; level: number }[] = [];
  const say = (m: string) => opt.onProgress?.(m);

  /* ---------- evidence register ---------- */
  const evid: { id: string; file: string; type: string; used: string }[] = [];
  const evidOf = (re: RegExp) => evid.filter((e) => re.test(e.type)).map((e) => e.id);
  const docs: DocEntry[] = ds.docs?.length ? ds.docs : ds.files.map((f) => ({ path: f.name, size: f.size, type: f.kind === 'financial' ? 'Financial analysis report' : f.kind === 'gst' ? 'GST analysis report' : f.kind === 'banking' ? 'Banking analysis report' : 'Other document', status: f.kind === 'unknown' ? 'not used' : 'used', note: '' }));
  docs.filter((d) => d.status === 'used').forEach((d, i) => evid.push({ id: `E${i + 1}`, file: d.path, type: d.type, used: d.note }));
  const E = (re: RegExp, fallback = 'calculated') => { const ids = evidOf(re); if (!ids.length) return fallback; const n = ids.map((x) => +x.slice(1)); const parts: string[] = []; for (let i = 0; i < n.length;) { let j = i; while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++; parts.push(j - i >= 2 ? `E${n[i]}–E${n[j]}` : n.slice(i, j + 1).map((k) => `E${k}`).join(', ')); i = j + 1; } return parts.join(', '); };
  const evFin = E(/financial|template/i, 'Data view (typed)');
  const evGst = E(/gst|gstr|tally/i);
  const evBank = E(/bank/i);
  const evBureau = E(/cibil|net-worth/i, 'Settings / manual input');
  const evAgeing = E(/ageing/i, 'Ageing & Bureau page (typed)');

  /* ---------- layout primitives ---------- */
  const footer = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5); doc.setTextColor(...GREY);
      if (i > 1) {
        doc.text(T(`INGOVIZ AI · ${a.company} · Integrated Financial, GST, Banking & Credit Analysis Report`), M, 8);
        doc.setDrawColor(220); doc.line(M, 9.5, W - M, 9.5);
      }
      if (opt.includeDisclaimer) {
        doc.setFontSize(5.8);
        doc.text(doc.splitTextToSize(DISCLAIMER, W - 2 * M), M, H - 22);
      }
      doc.setFontSize(7.5);
      doc.text(`Page ${i} of ${n}`, W - M, H - 7, { align: 'right' });
      doc.text(T(`Generated ${new Date().toLocaleString('en-IN')} · INGOVIZ AI`), M, H - 7);
    }
  };
  const newPage = () => { doc.addPage(); y = 16; };
  const need = (h: number) => { if (y + h > bottom) newPage(); };
  const part = (title: string) => {
    // a part starts on a new page unless the current one is still mostly empty
    if (y > H * 0.33) newPage(); else y += 4;
    doc.setFillColor(...NAVY); doc.rect(M, y, W - 2 * M, 11, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
    doc.text(T(title), M + 3, y + 7.5);
    toc.push({ label: title, page: doc.getNumberOfPages(), level: 0 });
    y += 16;
  };
  const section = (num: string, title: string, evidence?: string) => {
    need(22);
    doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
    doc.text(T(`${num ? num + '. ' : ''}${title}`), M, y + 4);
    toc.push({ label: `${num ? num + '. ' : ''}${title}`, page: doc.getNumberOfPages(), level: 1 });
    y += 6;
    doc.setDrawColor(...BRAND); doc.setLineWidth(0.4); doc.line(M, y, W - M, y); doc.setLineWidth(0.2);
    y += 3;
    if (evidence) { doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...GREY); const l = doc.splitTextToSize(T(`Evidence: ${evidence}`), W - 2 * M); doc.text(l, M, y + 2.5); y += l.length * 3.4 + 1.5; }
  };
  const sub = (title: string) => { need(14); doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(T(title), M, y + 4); y += 7; };
  const para = (text: string, size = 8.8, color: [number, number, number] = [30, 33, 40]) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(T(text), W - 2 * M)) { need(size * 0.45); doc.text(line, M, y + 3.2); y += size * 0.43; }
    y += 1.5;
  };
  const bullets = (items: string[], size = 8.6) => { for (const it of items) para(`•  ${it}`, size); };
  const table = (head: string[], body: (string | number | null | undefined)[][], o: Partial<UserOptions> & { numCols?: number[]; widths?: Record<number, number> } = {}) => {
    if (!body.length) { para('No records available in the uploaded data.', 8, GREY); return; }
    const colStyles: Record<number, Record<string, unknown>> = {};
    for (const c of o.numCols || []) colStyles[c] = { halign: 'right' };
    for (const [c, w] of Object.entries(o.widths || {})) colStyles[+c] = { ...(colStyles[+c] || {}), cellWidth: w };
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, top: 14, bottom: H - bottom + 2 },
      head: [head.map(T)], body: body.map((r) => r.map((c) => (typeof c === 'number' ? T(c.toLocaleString('en-IN')) : T(c)))) as RowInput[],
      styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 1.4, overflow: 'linebreak', lineColor: [225, 228, 235], lineWidth: 0.1, textColor: [30, 33, 40] },
      headStyles: { fillColor: [236, 241, 252], textColor: NAVY, fontStyle: 'bold', fontSize: 7.6 },
      alternateRowStyles: { fillColor: [250, 251, 253] },
      columnStyles: colStyles, theme: 'grid', rowPageBreak: 'avoid',
      ...o,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  };
  const kv = (rows: [string, string][], evidenceCol?: string[]) => table(evidenceCol ? ['Particular', 'Details', 'Evidence'] : ['Particular', 'Details'], rows.map((r, i) => (evidenceCol ? [r[0], r[1], evidenceCol[i] || ''] : r)), { widths: evidenceCol ? { 0: 52, 2: 30 } : { 0: 58 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 52 } } });
  const chart = async (spec: ChartSpec, type: ChartType, title: string, hmm = 68) => {
    if (!opt.chartImage || !spec.categories.length) return;
    const img = await opt.chartImage(spec, type, 1000, Math.round(1000 * hmm / (W - 2 * M))).catch(() => null);
    if (!img) return;
    need(hmm + 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...NAVY); doc.text(T(title), M, y + 3); y += 5;
    doc.addImage(img, 'PNG', M, y, W - 2 * M, hmm); y += hmm + 4;
  };
  const metricRows = (ms: Metric[], fys: string[], withFormula = false) => ms.map((m) => [
    m.name, ...(withFormula ? [m.formula] : []), ...fys.map((f) => unit(m.values[f], m.unit)),
    fys.length > 1 ? pct(m.yoy[fys[fys.length - 1]]) : '—', m.trend,
  ]);

  const fin = a.fin, gst = a.gst, bank = a.bank, rec = a.recon, risk = a.risk;
  const fx = ds.extra;
  const snap = companySnapshot(a, ds, inp);

  /* ================= COVER ================= */
  say('Writing cover and contents…');
  if (opt.logo) { try { doc.addImage(opt.logo, 'PNG', M, 22, 90, 32); } catch { /* logo optional */ } }
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(doc.splitTextToSize('INTEGRATED FINANCIAL, GST, BANKING & CREDIT ANALYSIS REPORT', W - 2 * M), M, 74);
  doc.setFontSize(15); doc.setTextColor(...BRAND); doc.text(T(a.company), M, 96);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40);
  const cov = [
    `Financial years: ${fin ? fin.fys.join(', ') : 'audited statements not available in text form'}`,
    `GST: ${gst ? `${monthLabel(gst.months[0])} to ${monthLabel(gst.months[gst.months.length - 1])} (${gst.months.length} months, ${ds.gst?.gstins.length || 0} GSTIN)` : 'not provided'}`,
    `Banking: ${bank ? `${monthLabel(bank.months[0])} to ${monthLabel(bank.months[bank.months.length - 1])} (${bank.months.length} months, ${new Set(bank.txns.map((t) => t.account)).size} account(s), ${bank.txns.length.toLocaleString('en-IN')} transactions)` : 'not provided'}`,
    `Invoice ageing: ${fx?.ageing.length ? fx.ageing.map((g) => `${g.side} as on ${fmtDate(g.asOf)}`).join(', ') : inp.ageing.some((b) => b.receivable) ? 'entered manually' : 'not provided'} · CIBIL / CMR: ${inp.cibilScore ?? '—'} / ${inp.cmrRank ? 'CMR-' + inp.cmrRank : '—'}`,
    `Documents analysed: ${docs.length} (${docs.filter((d) => d.status === 'used').length} used as evidence)`,
  ];
  let cy = 106; for (const c of cov) { for (const l of doc.splitTextToSize(T(c), W - 2 * M)) { doc.text(l, M, cy); cy += 5; } }
  doc.setFillColor(244, 246, 251); doc.roundedRect(M, cy + 6, W - 2 * M, 34, 2, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
  doc.text('Overall AI Credit Score', M + 5, cy + 15); doc.text('Recommendation', M + 70, cy + 15); doc.text('Indicative funding', M + 130, cy + 15);
  doc.setFontSize(17); doc.setTextColor(...BRAND);
  doc.text(`${risk.overall.score ?? '—'}/100`, M + 5, cy + 26); doc.text(T(risk.decision.decision), M + 70, cy + 26);
  doc.setFontSize(12); doc.text(T(risk.decision.recommendedFunding !== null && risk.decision.recommendedFunding <= 0 ? 'Nil additional' : fmtCr(risk.decision.recommendedFunding)), M + 130, cy + 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
  doc.text(T(`${risk.overall.risk} risk · based on ${risk.overall.covered} of ${risk.scores.length} scorecard dimensions`), M + 5, cy + 34);
  doc.setFontSize(8.5); doc.setTextColor(60);
  doc.text(T(`Prepared with INGOVIZ AI — Turn Data Into Intelligence · ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`), M, H - 30);
  doc.text('Every figure is traceable: see the Evidence column and the Evidence Register (Annexure A).', M, H - 25);

  // contents page (filled at the end)
  newPage(); const tocPage = doc.getNumberOfPages(); y = H; // contents page stays reserved

  /* ================= 1–2 ================= */
  part('COMPANY SNAPSHOT & EXECUTIVE SUMMARY');
  section('1', 'Company & Credit Snapshot', `${E(/mca|udyam|lei|gst registration/i, 'financial report profile')}; financial ${evFin}; GST ${evGst}; banking ${evBank}; bureau ${evBureau}`);
  kv(snap.rows);
  if (snap.openCharges.length) { sub('Open charges (existing secured borrowings)'); table(['Charge holder', 'Amount', 'Created', 'Assets under charge', 'Rate'], snap.openCharges.map((c) => [c.holder, inr(c.amount), c.created, c.assets, c.rate]), { numCols: [1] }); }

  section('2', 'Executive AI Credit Summary', 'Scorecard (section 35) built from every available source; classifications per the rules shown in each row.');
  table(['Assessment', 'Result'], Object.entries(risk.snapshot).map(([k, v]) => [k, v]), { widths: { 0: 70 } });
  kv([
    ['Overall AI Credit Score', `${risk.overall.score ?? '—'}/100 (${risk.overall.risk} risk, ${risk.overall.covered}/${risk.scores.length} dimensions scored)`],
    ['Final Recommendation', risk.decision.decision],
    ['Indicative Funding Eligibility', risk.decision.recommendedFunding !== null && risk.decision.recommendedFunding <= 0 ? 'Nil additional — no headroom at current leverage' : cr(risk.decision.recommendedFunding)],
    ['Recommended Product', risk.decision.product],
    ['Repayment Capacity', risk.decision.repayment],
  ]);
  await chart({ categories: risk.scores.filter((s) => s.score !== null).map((s) => s.name), unit: 'num', series: [{ name: 'Score /100', data: risk.scores.filter((s) => s.score !== null).map((s) => s.score) }] }, 'hbar', 'Score by dimension (/100)', 62);
  sub('Key red flags');
  bullets(risk.flags.slice(0, 10).map((f) => `[${f.severity}] ${f.area}: ${f.text}`));
  if (!risk.flags.length) para('No red flags identified from the available data.');

  /* ================= PART A ================= */
  say('Writing Part A — financial analysis…');
  part('PART A — LAST 3 YEARS FINANCIAL ANALYSIS');
  if (!fin) {
    section('3–5', 'Financial analysis', evFin);
    para(snap.finMissing + '. Sections 3 (three-year performance), 4 (21 core ratios) and 5 (working-capital cycle) need the audited Profit & Loss and Balance Sheet in text form, the INGOVIZ financial input template, or figures typed in Data view → Financial line items. No financial figure has been estimated.');
    const scanned = (ds.docs || []).filter((d) => d.status === 'scanned' && /financial|itr/i.test(d.type));
    if (scanned.length) table(['Financial document received', 'Status'], scanned.map((d) => [shortName(d.path), 'Scanned image — no text layer']), { widths: { 1: 50 } });
  } else {
    const fys = fin.fys;
    section('3', 'Three-Year Financial Performance', `${evFin} — source row of every line item shown below; formulas in Annexure G`);
    table(['Financial Parameter', ...fys, `YoY ${fys[fys.length - 1] || ''}`, '3-Year Trend'], metricRows(fin.performance, fys), { numCols: fys.map((_, i) => i + 1).concat(fys.length + 1) });
    await chart({ categories: fys, unit: 'inr', series: ['revenue', 'ebitda', 'pat'].map((k, i) => { const m = fin.performance.find((p) => p.key === k)!; return { name: m.name, data: fys.map((f) => m.values[f] ?? null), slot: i }; }) }, 'bar', 'Revenue, EBITDA & PAT');
    sub('Each financial year presented separately');
    const items = ds.financial?.items || {};
    for (const fy of fys) {
      const keys = Object.keys(ITEM_LABELS).filter((k) => items[k]?.[fy] !== undefined && items[k]?.[fy] !== null);
      if (!keys.length) continue;
      sub(`Financial statements — ${fy}`);
      const prevFy = fys[fys.indexOf(fy) - 1];
      table(['Line item', fy, prevFy ? `vs ${prevFy}` : 'Change', 'Source row'], keys.map((k) => {
        const v = items[k][fy] ?? null, p = prevFy ? items[k][prevFy] ?? null : null;
        const raw = ds.financial?.rawRows.find((r) => r.key === k);
        return [ITEM_LABELS[k], inr(v), p !== null && v !== null && p !== 0 ? pct((v - p) / Math.abs(p)) : '—', raw ? `${raw.sheet} › "${raw.label}"` : inp.financialOverrides[k]?.[fy] !== undefined ? 'Data view (typed)' : 'derived'];
      }), { numCols: [1, 2], widths: { 0: 62, 3: 58 } });
    }
    sub('AI Financial Trend'); bullets(risk.trendComments);
    section('4', 'Core Financial Calculations & Ratios (21 parameters)', `${evFin}; formulas exactly as specified`);
    table(['No.', 'Parameter', 'Formula', ...fys, 'Trend'], fin.ratios.map((m, i) => [String(i + 1), m.name, m.formula, ...fys.map((f) => unit(m.values[f], m.unit)), m.trend]), { numCols: fys.map((_, i) => i + 3), widths: { 0: 8, 1: 32, 2: 48 } });
    if (fin.extra.length) { sub('Supplementary measures'); table(['Parameter', 'Formula', ...fys, 'Trend'], fin.extra.map((m) => [m.name, m.formula, ...fys.map((f) => unit(m.values[f], m.unit)), m.trend]), { numCols: fys.map((_, i) => i + 2) }); }
    for (const n of fin.notes) para(n, 8, GREY);
    section('5', 'Working Capital Cycle', `${evFin}; Inventory Days + Debtor Days – Creditor Days`);
    table(['FY', 'Inventory days', 'Debtor days', 'Creditor days', 'Net cycle', 'Working-capital gap'], fin.wc.map((w) => [w.fy, fmtDays(w.inventoryDays), fmtDays(w.debtorDays), fmtDays(w.creditorDays), fmtDays(w.cycle), inr(w.gap)]), { numCols: [1, 2, 3, 4, 5] });
    const wa = fin.wcAssessment;
    kv([['Working Capital Cycle', wa.cycle], ['Receivables', wa.receivables], ['Inventory', wa.inventory], ['Supplier Dependency', wa.supplierDependency], ['Additional WC Requirement', cr(wa.additionalWC)], ['MPBF (Tandon II)', cr(wa.mpbf)], ['Turnover method (Nayak, 20% of sales)', cr(wa.turnoverMethod)]]);
  }

  /* ================= PART B ================= */
  say('Writing Part B — GST…');
  part('PART B — GST ANALYSIS');
  if (!gst) { section('6–13', 'GST analysis', 'not provided'); para('No GST analysis report or GSTR-3B returns were uploaded.'); } else {
    const evR = E(/gstr-3b|gst analysis/i, evGst), evP = E(/tally|mom|gst analysis/i, evGst);
    section('6', 'GST Sales & Purchase Analysis', `${evR} (sales); ${evP} (purchases)${ds.extra?.ledgerParties.length ? ' — purchases from Tally purchase vouchers net of GST at the effective GSTR-3B rate' : ''}`);
    table(['Financial year', 'Months', 'Sales', 'Purchases', 'Margin', 'Sales ÷ Purchases', 'Sales YoY'], gst.salesPurchaseFY.map((r) => { const mo = gst.monthly.filter((m) => m.fy === r.fy && m.revenue).length; return [r.fy, String(mo), inr(r.sales), inr(r.purchase), inr(r.sales - r.purchase), xx(r.ratio), mo >= 12 ? pct(gst.revenueYoY[r.fy]) : 'partial year']; }), { numCols: [1, 2, 3, 4, 5, 6] });
    await chart({ categories: gst.monthly.map((m) => monthLabel(m.month)), unit: 'inr', series: [{ name: 'Sales', data: gst.monthly.map((m) => m.revenue) }, { name: 'Purchases', data: gst.monthly.map((m) => m.purchase), slot: 1 }] }, 'bar', 'Monthly GST sales vs purchases');
    for (const fy of gst.fys) {
      const c = gst.concentration.buyers.find((b) => b.fy === fy), rows = gst.buyers[fy] || [];
      section(fy === gst.fys[0] ? '6.1' : '', `Buyer Analysis — ${fy}`, evP);
      kv([['Top 5 Buyer Concentration', pct(c?.top5)], ['Top 10 Buyer Concentration', pct(c?.top10)], ['Largest Buyer Contribution', `${pct(c?.top1)} — ${c?.largestName || '—'}`], ['Customer diversification', `${c?.count ?? 0} buyers · HHI ${c?.hhi != null ? Math.round(c.hhi * 10000) : '—'}`], ['Buyer Concentration Risk', c?.risk || '—']]);
      table(['#', 'Buyer', 'Total Sales', '% of Sales', 'State', 'Months', 'Trend'], rows.map((r, i) => [String(i + 1), r.name, inr(r.total), pct(r.share), r.state, String(r.months), r.trend]), { numCols: [2, 3, 5], widths: { 0: 8 } });
    }
    for (const fy of gst.fys) {
      const c = gst.concentration.suppliers.find((b) => b.fy === fy), rows = gst.suppliers[fy] || [];
      section(fy === gst.fys[0] ? '7' : '', `Supplier Analysis — ${fy}`, evP);
      kv([['Top 5 Supplier Concentration', pct(c?.top5)], ['Top 10 Supplier Concentration', pct(c?.top10)], ['Largest Supplier Contribution', `${pct(c?.top1)} — ${c?.largestName || '—'}`], ['Supplier dependency', `${c?.count ?? 0} suppliers`], ['Supplier Concentration Risk', c?.risk || '—']]);
      table(['#', 'Supplier', 'Total Purchase', '% of Purchase', 'State', 'Trend'], rows.map((r, i) => [String(i + 1), r.name, inr(r.total), pct(r.share), r.state, r.trend]), { numCols: [2, 3], widths: { 0: 8 } });
    }
    section('8', 'Sales-to-Purchase Ratio', `${evR}; ${evP}`);
    table(['Month', 'FY', 'Sales', 'Purchases', 'Margin', 'Sales ÷ Purchases'], gst.monthly.map((m) => [monthLabel(m.month), m.fy, inr(m.revenue), inr(m.purchase), inr(m.margin), xx(m.ratio)]), { numCols: [2, 3, 4, 5] });
    if (gst.unusualMonths.length) { sub('Unusual movement between sales and purchases'); bullets(gst.unusualMonths.map((u) => `${monthLabel(u.month)} — ${u.note}`)); }
    section('9', 'Export Analysis', `${evR} (3.1(b) zero-rated supplies)`);
    table(['FY', 'Domestic sales', 'Export sales', 'Total turnover', 'Export ratio', 'Export growth'], gst.exports.map((e) => [e.fy, inr(e.domestic), inr(e.export), inr(e.total), pct(e.ratio), pct(e.growth)]), { numCols: [1, 2, 3, 4, 5] });
    para(`Export Dependency: ${gst.exportDependency}. Export Ratio = Export Turnover ÷ Annual Turnover × 100.`);
    section('10', 'GST Filing Analysis', `${E(/gstr-3b/i, evGst)} — filing date (Date of ARN) vs due date (20th of next month)`);
    const fsum = gst.filing.summary;
    kv([['Returns analysed', `${fsum.totalReturns} across ${fsum.establishments} GSTIN(s)`], ['Late filings', `${fsum.lateReturns} (${pct(fsum.latePct)})`], ['Average / maximum delay', `${fsum.avgDelay.toFixed(1)} / ${fsum.maxDelay} days`], ['Estimated late fee', `${inr(fsum.estLateFee)} (Rs 50/day per return, capped at Rs 10,000 — estimate)`], ['Missing filing periods', String(fsum.missingPeriods)], ['GST Compliance', gst.filing.compliance]]);
    table(['GSTIN', 'State', 'Return', 'Filed', 'Late', 'Avg delay', 'Max delay', 'Missing periods'], gst.filing.byGstin.map((g) => [g.gstin, g.state, g.returnType, String(g.total), String(g.late), `${g.avgDelay.toFixed(1)}d`, `${g.maxDelay}d`, g.missing.map(monthLabel).join(', ') || 'None']), { numCols: [3, 4, 5, 6] });
    sub('Every return — due date vs filing date');
    table(['GSTIN', 'Return', 'Period', 'Due date', 'Filed on', 'Delay'], gst.filing.rows.map((r) => [r.gstin, r.returnType, monthLabel(r.period), fmtDate(r.due), fmtDate(r.filed), r.delayDays > 0 ? `${r.delayDays} days` : 'On time']), { numCols: [5] });
    section('11', 'State-wise / Location-wise Revenue', evR);
    for (const st of gst.states) { sub(st.fy); table(['State', 'Sales', '% Revenue', 'Purchases', '% Purchase'], st.rows.map((r) => [r.state, inr(r.sales), pct(r.salesPct), inr(r.purchase), pct(r.purchasePct)]), { numCols: [1, 2, 3, 4] }); }
    para(`Geographical concentration: ${gst.geoConcentration.map((g) => `${g.fy} — ${g.topState} ${pct(g.share)}`).join('; ')}.`);
    section('12', 'Intra-Group Transactions', evGst);
    table(['FY', 'Intra-group sales', '% of business'], gst.intraGroup.map((g) => [g.fy, inr(g.amount), pct(g.pct)]), { numCols: [1, 2] });
    para(`Related-Party Dependency: ${gst.relatedPartyDependency}.`);
    section('13', 'HSN / Product-wise Analysis', evGst);
    if (gst.hsn.length) table(['HSN', 'Product', ...gst.fys], gst.hsn.map((h) => [h.code, h.product, ...gst.fys.map((f) => inr(h.byFY[f]))]), { numCols: gst.fys.map((_, i) => i + 2) });
    else para('HSN-wise data (GSTR-1 Table 12) is not part of the uploaded files, so product concentration and product-wise growth cannot be computed.');
    if (gst.gstr1vs3b.length) { sub('GSTR-1 vs GSTR-3B'); table(['Month', 'GSTR-1', 'GSTR-3B', 'Difference'], gst.gstr1vs3b.map((g) => [monthLabel(g.month), inr(g.gstr1), inr(g.gstr3b), inr(g.diff)]), { numCols: [1, 2, 3] }); }
  }

  /* ================= PART C ================= */
  say('Writing Part C — banking…');
  part('PART C — BANKING ANALYSIS');
  if (!bank) { section('14–25', 'Banking analysis', 'not provided'); para('No bank statements or banking analysis report were uploaded.'); } else {
    section('14', 'Banking Trend (monthly, all operative accounts)', `${evBank} — every transaction keeps its file and page reference (Annexure H)`);
    table(['Month', 'Total Inflow', 'Total Outflow', 'Adjusted Inflow', 'Closing Balance', 'Credits', 'Debits'], bank.monthly.map((m) => [monthLabel(m.month), inr(m.inflow), inr(m.outflow), inr(m.adjustedInflow), inr(m.closing), String(m.credits), String(m.debits)]), { numCols: [1, 2, 3, 4, 5, 6] });
    para(`Banking trend: ${bank.totals.trend} (volatility of monthly inflow ${pct(bank.totals.volatility)}).`);
    await chart({ categories: bank.monthly.map((m) => monthLabel(m.month)), unit: 'inr', series: [{ name: 'Inflow', data: bank.monthly.map((m) => m.inflow) }, { name: 'Outflow', data: bank.monthly.map((m) => m.outflow), slot: 1 }, { name: 'Adjusted inflow', data: bank.monthly.map((m) => m.adjustedInflow), slot: 2 }] }, 'bar', 'Inflow, outflow and adjusted business inflow');
    const accts = [...new Set(bank.txns.map((t) => t.account))];
    if (accts.length > 1) for (const ac of accts) {
      sub(`Account ${ac}`);
      const ms = bank.months;
      table(['Month', 'Credits', 'Debits', 'Closing balance', 'Entries'], ms.map((m) => { const tt = bank.txns.filter((t) => t.account === ac && t.month === m); const lastBal = [...tt].reverse().find((t) => t.balance !== null)?.balance ?? null; return [monthLabel(m), inr(tt.reduce((s, t) => s + t.credit, 0)), inr(tt.reduce((s, t) => s + t.debit, 0)), inr(lastBal), String(tt.length)]; }).filter((r) => r[4] !== '0'), { numCols: [1, 2, 3, 4] });
    }
    section('15', 'Internal Transactions', `${evBank}; classification rule shown per row`);
    const intl = bank.internalTxns;
    para(`${intl.length} internal / related transactions — credits ${inr(intl.reduce((s, t) => s + t.credit, 0))}, debits ${inr(intl.reduce((s, t) => s + t.debit, 0))}.`);
    table(['Date', 'Party', 'Class', 'Debit', 'Credit', 'Evidence'], [...intl].sort((p, q) => q.credit + q.debit - (p.credit + p.debit)).slice(0, 60).map((t) => [fmtDate(t.date), t.counterparty, t.cls, t.debit ? inr(t.debit) : '', t.credit ? inr(t.credit) : '', t.source || t.account]), { numCols: [3, 4], widths: { 0: 16, 5: 44 } });
    if (intl.length > 60) para(`Largest 60 shown; all ${intl.length} are in the Excel export.`, 7.5, GREY);
    section('16', 'Adjusted Business Inflow', evBank);
    const ad = bank.adjusted;
    table(['Calculation', 'Amount'], [['Total Bank Inflow (gross credits)', inr(ad.gross)], ['Less: cheque / payment returns & reversals', inr(-ad.returns)], ['Less: internal transfers (own accounts / FD)', inr(-ad.internal)], ['Less: loan disbursements', inr(-ad.loans)], ['Less: promoter / director credits', inr(-ad.promoter)], ['Less: group / related-party credits', inr(-ad.group)], ['Less: identifiable non-business credits', inr(-ad.nonBusiness)], ['= Adjusted Business Inflow', inr(ad.adjusted)]], { numCols: [1] });
    section('17', 'Inflow / Outflow Analysis', evBank);
    const tt = bank.totals;
    kv([['Total inflow', inr(tt.inflow)], ['Total outflow', inr(tt.outflow)], ['Average monthly inflow', inr(tt.avgInflow)], ['Average monthly outflow', inr(tt.avgOutflow)], ['Peak month', monthLabel(tt.peakMonth)], ['Lowest month', monthLabel(tt.lowMonth)], ['Volatility (coefficient of variation)', pct(tt.volatility)], ['Net cash movement', inr(tt.net)]]);
    section('18', 'Cheque Return Analysis', evBank);
    const rt = bank.returns;
    kv([['Inward returns (own cheques / payments returned)', `${rt.inward.count} · ${inr(rt.inward.amount)} · ${rt.inward.months} month(s)`], ['Outward returns (customer cheques returned)', `${rt.outward.count} · ${inr(rt.outward.amount)} · ${rt.outward.months} month(s)`], ['Return / bounce charges', `${rt.charges.count} · ${inr(rt.charges.amount)}`], ['Frequency', `${((rt.inward.count + rt.outward.count) / (bank.months.length || 1)).toFixed(2)} per month`], ['Risk', rt.risk]]);
    const retItems = [...rt.inward.items, ...rt.outward.items];
    if (retItems.length) table(['Date', 'Narration', 'Debit', 'Credit', 'Evidence'], retItems.map((t) => [fmtDate(t.date), t.description, t.debit ? inr(t.debit) : '', t.credit ? inr(t.credit) : '', t.source || '']), { numCols: [2, 3], widths: { 0: 16, 4: 40 } });
    section('19', 'ECS / NACH / EMI Return & Penal Charges', evBank);
    kv([['ECS / NACH / EMI returns', `${rt.ecsNachEmi.count} · ${inr(rt.ecsNachEmi.amount)}`], ['Penal charges', `${rt.penal.count} · ${inr(rt.penal.amount)}`], ['EMIs paid', `${bank.emi.length} · ${inr(bank.emi.reduce((s, e) => s + e.amount, 0))}`]]);
    if (rt.ecsNachEmi.items.length + rt.penal.items.length) table(['Date', 'Narration', 'Amount', 'Evidence'], [...rt.ecsNachEmi.items, ...rt.penal.items].map((t) => [fmtDate(t.date), t.description, inr(t.debit || t.credit), t.source || '']), { numCols: [2], widths: { 0: 16, 3: 40 } });
    if (bank.emi.length) { sub('EMI debits'); table(['Date', 'Narration', 'Amount'], bank.emi.map((e) => [fmtDate(e.date), e.description, inr(e.amount)]), { numCols: [2], widths: { 0: 16 } }); }
    section('20', 'Number of Credit Entries', evBank);
    kv([['Total credit entries', String(bank.creditEntries.total)], ['Monthly average', bank.creditEntries.monthlyAvg.toFixed(1)], ['Average credit amount', inr(bank.creditEntries.avgAmount)], ['Transaction frequency', `${(bank.txns.length / (bank.months.length || 1)).toFixed(1)} entries per month`]]);
    sub('Largest credits'); table(['Date', 'Party', 'Amount', 'Class', 'Evidence'], bank.creditEntries.largest.map((t) => [fmtDate(t.date), t.counterparty, inr(t.credit), t.cls, t.source || '']), { numCols: [2], widths: { 0: 16, 4: 44 } });
    section('21', 'Banking Turnover — BTO', `${evBank}; ${evGst}; ${evFin}`);
    const bt = rec.bto;
    kv([[`Banking turnover (adjusted inflow, ${bt.months} months)`, inr(bt.bankTurnover)], ['Annualised banking turnover', inr(bt.annualised)], [`GST turnover incl. tax — same months (${rec.overlap?.label || 'no overlap'})`, inr(bt.gstSamePeriod)], ['Banking Turnover ÷ GST Turnover', pct(bt.btoToGst)], ['Financial turnover (latest audited year)', inr(bt.financialLatest)], ['Annualised BTO (ex-GST) ÷ Financial Turnover', pct(bt.btoToFinancial)]]);
    section('22', 'Party-wise Inflow / Outflow', evBank);
    sub('Top inflow parties'); table(['#', 'Party', 'Amount', '% of inflow', 'Entries', 'Class'], bank.parties.inflow.slice(0, 40).map((p, i) => [String(i + 1), p.party, inr(p.amount), pct(p.share), String(p.count), p.cls]), { numCols: [2, 3, 4], widths: { 0: 8 } });
    sub('Top outflow parties'); table(['#', 'Party', 'Amount', '% of outflow', 'Entries', 'Class'], bank.parties.outflow.slice(0, 40).map((p, i) => [String(i + 1), p.party, inr(p.amount), pct(p.share), String(p.count), p.cls]), { numCols: [2, 3, 4], widths: { 0: 8 } });
    para(`Party concentration: top 5 inflow parties ${pct(bank.parties.inflow.slice(0, 5).reduce((s, p) => s + p.share, 0))} of inflow; top 5 outflow parties ${pct(bank.parties.outflow.slice(0, 5).reduce((s, p) => s + p.share, 0))} of outflow.`);
    section('23', 'Loan Disbursement Analysis', evBank);
    table(['Date', 'Type', 'Narration', 'Amount', 'Account'], bank.loans.map((l) => [fmtDate(l.date), l.type, l.description, inr(l.amount), l.account]), { numCols: [3], widths: { 0: 16 } });
    para('Loan disbursements are excluded from operating receipts (section 16).', 8, GREY);
    section('24', 'Cash Deposit Analysis', evBank);
    kv([['Total cash deposits', inr(bank.cash.total)], ['Number of cash deposits', String(bank.cash.count)], ['Cash as % of total credits', pct(bank.cash.pctOfCredits)]]);
    const cm = Object.entries(bank.cash.monthly).filter(([, v]) => v);
    if (cm.length) table(['Month', 'Cash deposits'], cm.map(([m, v]) => [monthLabel(m), inr(v)]), { numCols: [1] });
    if (bank.cash.large.length) { sub('Unusually large cash credits'); table(['Date', 'Narration', 'Amount', 'Evidence'], bank.cash.large.map((t) => [fmtDate(t.date), t.description, inr(t.credit), t.source || '']), { numCols: [2] }); }
    section('25', 'CC / OD Utilisation', `${evBank}; limit source per account`);
    table(['Account', 'Sanctioned limit', 'Limit source', 'Avg util.', 'Peak', 'Min', 'Days >90%', 'Overdrawn days', 'Classification'], bank.utilisation.map((u) => [u.account, inr(u.limit), u.limitSource, pct(u.avgUtil), pct(u.peakUtil), pct(u.minUtil), String(u.daysAbove90), String(u.overdrawnDays), u.classification]), { numCols: [1, 3, 4, 5, 6, 7] });
    if (!bank.utilisation.length) para('No CC / OD account identified in the statements (all accounts are current accounts) — utilisation is not applicable.');
    if (bank.interest.some((i) => i.amount)) { sub('Interest servicing'); table(['Month', 'Interest debited'], bank.interest.filter((i) => i.amount).map((i) => [monthLabel(i.month), inr(i.amount)]), { numCols: [1] }); }
  }

  /* ================= PART D ================= */
  say('Writing Part D — reconciliation…');
  part('PART D — INTEGRATED RECONCILIATION');
  section('26', 'Financial vs GST vs Banking', `${evFin}; ${evGst}; ${evBank}`);
  table(['FY', 'Financial turnover', 'GST turnover', 'GST months', 'Var. GST', 'Gross bank inflow', 'Adjusted inflow', 'Bank months', 'Status'], rec.fyRows.map((r) => [r.fy, inr(r.financial), inr(r.gst), String(r.gstMonths), pct(r.varGst), inr(r.bankGross), inr(r.bankAdjusted), String(r.bankMonths), r.status]), { numCols: [1, 2, 3, 4, 5, 6, 7] });
  for (const r of rec.fyRows) if (r.remarks.length) para(`${r.fy}: ${r.remarks.join('; ')}`, 8);
  if (rec.overlap) {
    const o = rec.overlap;
    sub(`Same-period reconciliation — ${o.label}`);
    table(['Source', 'Reported amount', 'Remarks'], [['GST turnover (taxable)', inr(o.gstTaxable), ''], [`GST turnover incl. GST @ ${inp.gstGrossUpPct}%`, inr(o.gstGross), 'comparable with bank receipts'], ['Gross banking inflow', inr(o.bankGross), ''], ['Internal transfers', inr(o.internal), 'excluded'], ['Loan / non-business credits', inr(o.loans), 'excluded'], ['Returns / reversals', inr(o.returns), 'excluded'], ['Promoter / group credits', inr(o.promoter + o.group), 'excluded'], ['Adjusted business inflow', inr(o.bankAdjusted), `variance vs GST ${pct(o.variance)}`]], { numCols: [1] });
    para(`AI Reconciliation Status: ${o.status}. ${o.lagNote}`);
    table(['Month', 'GST taxable', 'GST incl. tax', 'Adjusted bank inflow', 'Gross bank inflow'], o.monthly.map((m) => [monthLabel(m.month), inr(m.gst), inr(m.gstGross), inr(m.bankAdjusted), inr(m.bankGross)]), { numCols: [1, 2, 3, 4] });
  }
  para(`Overall reconciliation status: ${rec.overallStatus}.${rec.coverageNote ? ' ' + rec.coverageNote : ''}`);
  section('27', 'Buyer vs Banking Reconciliation', `${evP_()}; ${evBank}`);
  table(['GST buyer', 'GST sales', 'Incl. GST', 'Bank party matched', 'Bank receipts', 'Variance', 'Status'], rec.buyers.rows.map((r) => [r.gstParty, inr(r.gstAmount), inr(r.gstGross), r.bankParty, inr(r.bankAmount), pct(r.variance), r.status]), { numCols: [1, 2, 4, 5] });
  para(`Share of GST sales matched to banking receipts: ${pct(rec.buyers.matchedShare)}.`);
  if (rec.buyers.unmatchedBankCredits.length) { sub('Large banking credits from parties not found among GST buyers'); table(['Bank party', 'Credits'], rec.buyers.unmatchedBankCredits.slice(0, 30).map((u) => [u.party, inr(u.amount)]), { numCols: [1] }); }
  section('28', 'Supplier vs Banking Reconciliation', `${evP_()}; ${evBank}`);
  table(['GST supplier', 'GST purchases', 'Incl. GST', 'Bank party matched', 'Bank payments', 'Variance', 'Status'], rec.suppliers.rows.map((r) => [r.gstParty, inr(r.gstAmount), inr(r.gstGross), r.bankParty, inr(r.bankAmount), pct(r.variance), r.status]), { numCols: [1, 2, 4, 5] });
  para(`Share of GST purchases matched to banking payments: ${pct(rec.suppliers.matchedShare)}.`);
  if (rec.suppliers.unmatchedBankDebits.length) { sub('Large payments to parties not found among GST suppliers'); table(['Bank party', 'Payments'], rec.suppliers.unmatchedBankDebits.slice(0, 30).map((u) => [u.party, inr(u.amount)]), { numCols: [1] }); }
  function evP_() { return E(/tally|mom|gst analysis/i, evGst); }

  /* ================= PART E ================= */
  say('Writing Part E — ageing & bureau…');
  part('PART E — INVOICE & BUREAU ANALYSIS');
  section('29', 'Invoice Ageing', evAgeing);
  const tot = (k: 'receivable' | 'payable') => inp.ageing.reduce((s, b) => s + (b[k] || 0), 0);
  table(['Age', 'Receivables', '%', 'Payables', '%'], [...inp.ageing.map((b) => [b.bucket, inr(b.receivable), pct(tot('receivable') ? b.receivable / tot('receivable') : null), inr(b.payable), pct(tot('payable') ? b.payable / tot('payable') : null)]), ['Total', inr(tot('receivable')), '', inr(tot('payable')), '']], { numCols: [1, 2, 3, 4] });
  if (tot('receivable')) {
    const old = inp.ageing.slice(3).reduce((s, b) => s + b.receivable, 0), oldP = inp.ageing.slice(3).reduce((s, b) => s + b.payable, 0);
    bullets([`Old debtors (> 90 days): ${inr(old)} — ${pct(old / tot('receivable'))} of receivables.`, `Debtors above 180 days: ${pct(inp.ageing[4].receivable / tot('receivable'))}.`, ...(tot('payable') ? [`Old creditors (> 90 days): ${pct(oldP / tot('payable'))} of payables${oldP / tot('payable') > 0.25 ? ' — supplier-payment pressure' : ''}.`] : [])]);
  }
  for (const ag of fx?.ageing || []) {
    sub(`${ag.side === 'receivable' ? 'Debtors' : 'Creditors'} — party-wise (as on ${fmtDate(ag.asOf)}, ${ag.invoices} invoices, average ${ag.avgDays != null ? Math.round(ag.avgDays) : '—'} days)`);
    table(['Party', 'Billed', 'Outstanding', 'Avg days'], ag.parties.map((p) => [p.name, inr(p.invoiced), inr(p.outstanding), p.avgDays == null ? '—' : String(Math.round(p.avgDays))]), { numCols: [1, 2, 3] });
  }
  section('30', 'CIBIL / CMR Analysis', evBureau);
  kv([['CIBIL score (lowest promoter)', inp.cibilScore != null ? String(inp.cibilScore) : 'Not provided'], ['CMR rank', inp.cmrRank != null ? `CMR-${inp.cmrRank}` : 'Not provided'], ['DPD / SMA / overdue observed', inp.dpdObserved ? 'Yes — see bureau remarks' : 'No'], ['Bureau Risk', risk.snapshot['CIBIL/CMR Conduct'] || '—']]);
  if (fx?.cibil.length) table(['Name', 'Report', 'Score / rank', 'Accounts / facilities', 'Sanctioned', 'Current / outstanding', 'Overdue', 'Remark', 'Date'], fx.cibil.map((c) => c.kind === 'commercial' ? [c.name, 'Commercial', `CMR-${c.cmr ?? '?'}`, String(c.facilities ?? '—'), '—', inr(c.outstanding), inr(c.overdue), c.overdue ? 'Overdue' : 'No overdue', fmtDate(c.reportDate)] : [c.name, 'Consumer', String(c.score ?? '—'), String(c.accounts ?? '—'), inr(c.sanctioned), inr(c.current), inr(c.overdue), c.delinquencyFlag ? 'Delinquency in history' : 'No adverse remark', fmtDate(c.reportDate)]), { numCols: [4, 5, 6] });
  if (inp.bureauNotes) para(inp.bureauNotes, 8);
  if (fx?.loans.length) { sub('Existing loans & EMI obligations'); table(['Lender', 'Facility', 'Sanctioned', 'Outstanding', 'EMI', 'ROI', 'Start', 'Tenure'], fx.loans.map((l) => [l.lender, l.facility, inr(l.sanction), inr(l.outstanding), inr(l.emi), pct(l.roi, 2), fmtDate(l.start), l.tenure]), { numCols: [2, 3, 4, 5] }); }
  if (fx?.networth.length) { sub('Promoter net worth (CA certificates)'); table(['Promoter', 'PAN', 'Net worth', 'Certificate date'], fx.networth.map((n) => [n.name, n.pan, inr(n.total), fmtDate(n.date)]), { numCols: [2] }); }

  /* ================= PART F–G ================= */
  say('Writing Parts F–G — risk & score…');
  part('PART F — AI RISK ENGINE');
  const flagsOf = (area: string) => risk.flags.filter((f) => f.area === area).map((f) => `[${f.severity}] ${f.text}`);
  section('31', 'Financial Red Flags', evFin); const f1 = flagsOf('Financial'); f1.length ? bullets(f1) : para(fin ? 'No financial red flags identified.' : 'Not assessed — financial statements not available.');
  section('32', 'GST Red Flags', evGst); const f2 = flagsOf('GST'); f2.length ? bullets(f2) : para('No GST red flags identified.');
  section('33', 'Banking Red Flags', evBank); const f3 = [...flagsOf('Banking'), ...flagsOf('Reconciliation'), ...flagsOf('Bureau')]; f3.length ? bullets(f3) : para('No banking red flags identified.');
  section('34', 'AI SWOT Analysis', 'automatic, evidence-based — metric, value, benchmark and source for every point');
  for (const t of ['Strength', 'Weakness', 'Opportunity', 'Threat'] as const) {
    const rows = a.swot.items.filter((i) => i.type === t);
    sub(`${t.toUpperCase()}S (${rows.length})`);
    const risky = t === 'Weakness' || t === 'Threat';
    table(['Observation', 'Evidence', ...(risky ? ['Severity', 'AI recommendation'] : ['Source'])], rows.map((r) => [`${r.title} — ${r.detail}`, `${r.metric}: ${r.value} (benchmark ${r.benchmark}) · ${r.source} · sec. ${r.section}`, ...(risky ? [r.severity, r.recommendation] : [r.recommendation || '—'])]), { widths: risky ? { 0: 58, 1: 50, 2: 16 } : { 0: 80, 1: 62 } });
  }
  part('PART G — INTEGRATED AI CREDIT SCORE');
  section('35', 'Credit Scorecard', 'scoring bands shown in the Basis column');
  table(['Assessment', 'Score', 'Weight', 'Risk Classification', 'Basis'], risk.scores.map((s) => [s.name, s.score === null ? 'n/a' : `${s.score}/100`, `${s.weight}%`, s.classification, s.basis]), { numCols: [1, 2], widths: { 0: 40, 4: 70 } });
  para(`OVERALL AI CREDIT SCORE: ${risk.overall.score ?? '—'}/100 · Overall Risk: ${risk.overall.risk} · ${risk.overall.covered} of ${risk.scores.length} dimensions scored (unscored dimensions are excluded from the weighted average, not counted as zero).`, 9.5);

  /* ================= PART H ================= */
  say('Writing Part H — funding & recommendation…');
  part('PART H — FUNDING ASSESSMENT');
  section('36', 'Funding Capacity', 'sections 3–30');
  kv([['Debt / EBITDA', xx(risk.funding.debtEbitda)], ['TOL / TNW', xx(risk.funding.tolTnw)], ['DSCR', xx(risk.funding.dscr)], ['Indicative Additional Debt Capacity', risk.funding.additionalDebt !== null && risk.funding.additionalDebt <= 0 ? 'Nil — no headroom at current leverage' : cr(risk.funding.additionalDebt)], ['Indicative Working Capital Gap', cr(risk.funding.wcGap)]]);
  sub('Method'); bullets(risk.funding.method);
  section('37', 'Product Mapping', 'sections 5–30');
  table(['Product', 'Why it fits'], risk.products.map((p) => [p.name, p.why]), { widths: { 0: 55 } });
  section('38', 'Final AI Credit Recommendation');
  const d = risk.decision;
  kv([['Credit Decision', d.decision], ['Recommended Funding', d.recommendedFunding !== null && d.recommendedFunding <= 0 ? 'Nil additional' : cr(d.recommendedFunding)], ['Recommended Product', d.product], ['Indicative Tenure', d.tenure], ['Repayment Capacity', d.repayment], ['Security Requirement', d.security], ['Additional Collateral / FLDG', d.collateral]]);
  const numbered = (t: string, l: string[]) => { sub(t); bullets(l.length ? l.map((x, i) => `${i + 1}. ${x}`) : ['—']); };
  numbered('Key Strengths', d.strengths); numbered('Key Risks', d.risks); numbered('Risk Mitigants', d.mitigants); numbered('Conditions Before Funding', d.conditions); numbered('Additional Documents / Clarifications', d.documents);
  section('39', 'Final Credit Analyst Remarks');
  para(risk.analystNote, 9);
  table(['#', 'Question', 'Answer'], risk.qa.map((q, i) => [String(i + 1), q.q, q.a]), { widths: { 0: 8, 1: 62 } });
  if (opt.includeDisclaimer) { section('40', 'Report Disclaimer / Declaration'); para(DISCLAIMER, 8.5); }

  /* ================= ANNEXURES (sized to the page budget) ================= */
  say('Writing annexures…');
  part('ANNEXURES — EVIDENCE & DATA');
  section('A', 'Evidence Register — documents used', 'every E-number cited in this report');
  table(['ID', 'File', 'Document type', 'What INGOVIZ read'], evid.map((e) => [e.id, e.file, e.type, e.used]), { widths: { 0: 10, 2: 36 } });
  const notUsed = docs.filter((d) => d.status !== 'used');
  if (notUsed.length) { sub('Documents received but not used for figures'); table(['File', 'Type', 'Status', 'Reason'], notUsed.map((d) => [shortName(d.path), d.type, d.status, d.note]), { widths: { 2: 22 } }); }
  if (fx?.gstr3b.length) {
    section('B', 'GSTR-3B returns — return-wise figures', 'each row = one return file');
    table(['GSTIN', 'Period', 'Taxable 3.1(a)', 'Zero-rated 3.1(b)', 'Nil/exempt 3.1(c)', 'Output tax', 'ITC 4(A)', 'Filed on', 'File'], [...fx.gstr3b].sort((p, q) => p.gstin.localeCompare(q.gstin) || p.period.localeCompare(q.period)).map((r) => [r.gstin, monthLabel(r.period), inr(r.taxable), inr(r.zeroRated), inr(r.nilExempt), inr(r.outputTax), inr(r.itc), fmtDate(r.filedOn), r.file || '']), { numCols: [2, 3, 4, 5, 6], styles: { fontSize: 6.6, cellPadding: 1 } as UserOptions['styles'] });
  }
  if (fx?.statements.length) {
    section('C', 'Bank statements — coverage and balance check');
    table(['Statement file', 'Bank', 'Account', 'From', 'To', 'Entries', 'Running-balance check'], fx.statements.map((s) => [shortName(s.file), s.bank, s.account, fmtDate(s.from), fmtDate(s.to), String(s.txns), s.mismatches ? `${s.mismatches} breaks` : 'OK']), { numCols: [5] });
    para('Overlapping statements of the same account were merged; duplicate entries (same date, amount and running balance) removed.', 8, GREY);
  }
  if (fx?.ledgerParties.length) {
    section('D', 'Tally ledgers — party-wise vouchers', E(/tally/i));
    table(['Party ledger', 'Sales', 'Purchases', 'Receipts', 'Payments', 'Closing'], [...fx.ledgerParties].sort((p, q) => Object.values(q.sales).reduce((s, v) => s + v, 0) - Object.values(p.sales).reduce((s, v) => s + v, 0)).map((p) => [p.name, inr(Object.values(p.sales).reduce((s, v) => s + v, 0)), inr(Object.values(p.purchases).reduce((s, v) => s + v, 0)), inr(p.receipts), inr(p.payments), p.closing === null ? '—' : `${inr(Math.abs(p.closing))} ${p.closing >= 0 ? 'Dr' : 'Cr'}`]), { numCols: [1, 2, 3, 4, 5] });
  }
  section('G', 'Calculation formulas used', 'fixed formulas — same files give the same numbers every time');
  table(['Measure', 'Formula'], [
    ...(fin ? [...fin.performance, ...fin.ratios, ...fin.extra].map((m) => [m.name, m.formula]) : []),
    ['GST sales (from GSTR-3B)', 'Taxable 3.1(a) + Zero-rated 3.1(b) + Nil/exempt 3.1(c) + Non-GST 3.1(e)'],
    ['Effective GST rate', 'Output tax on 3.1(a)+(b) ÷ taxable value of 3.1(a)+(b)'],
    ['GST filing delay', 'Date of ARN – due date (20th of the following month)'],
    ['Buyer / supplier concentration', 'Party amount ÷ total for the FY; HHI = Σ share²'],
    ['Adjusted business inflow', 'Gross credits – returns – internal – loans – promoter – group – non-business'],
    ['BTO ratio', 'Adjusted bank inflow (same months) ÷ GST turnover incl. tax'],
    ['Invoice ageing', 'Receipts set off oldest bill first; open bills aged from bill date to the latest date in the file'],
    ['Overall AI credit score', 'Weighted average of scored dimensions (weights in section 35)'],
  ], { widths: { 0: 60 } });

  // transaction register fills the page budget: material transactions, chronological, with evidence
  if (bank) {
    const pagesNow = doc.getNumberOfPages();
    const target = Math.min(opt.maxPages, Math.max(opt.minPages, pagesNow + 4)) - pagesNow;
    if (target > 0) {
      const perPage = 46;
      const cap = Math.max(40, target * perPage - 30);
      const byAmt = [...bank.txns].sort((p, q) => q.credit + q.debit - (p.credit + p.debit));
      const pick = byAmt.slice(0, cap);
      const thr = pick.length < bank.txns.length ? pick[pick.length - 1].credit + pick[pick.length - 1].debit : 0;
      pick.sort((p, q) => p.date.localeCompare(q.date));
      section('H', 'Bank transaction register — material entries', `${evBank}; file and page of each entry in the Evidence column`);
      para(pick.length < bank.txns.length ? `${pick.length.toLocaleString('en-IN')} largest of ${bank.txns.length.toLocaleString('en-IN')} transactions (every entry of ${inr(thr)} or more), in date order. The complete register is in the Excel export (Bank Transactions sheet).` : `All ${bank.txns.length.toLocaleString('en-IN')} transactions in date order.`, 8, GREY);
      table(['Date', 'Account', 'Party / narration', 'Debit', 'Credit', 'Balance', 'Class', 'Evidence'], pick.map((t) => [fmtDate(t.date), t.account.slice(-4), t.counterparty || t.description, t.debit ? inr(t.debit) : '', t.credit ? inr(t.credit) : '', inr(t.balance), t.cls, t.source || '']), { numCols: [3, 4, 5], styles: { fontSize: 6.4, cellPadding: 0.8, overflow: 'linebreak' } as UserOptions['styles'], widths: { 0: 14, 1: 10, 3: 19, 4: 19, 5: 21, 6: 20 } });
    }
  }

  /* ---------- contents ---------- */
  doc.setPage(tocPage);
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('Contents', M, 22);
  // one column when it fits, otherwise two
  const lh = (e: { level: number }) => (e.level ? 4.1 : 5.4);
  const need2 = toc.reduce((h, e) => h + lh(e), 0) > H - 48;
  const colW = need2 ? (W - 2 * M - 8) / 2 : W - 2 * M;
  let ty = 30, cx = M;
  for (const e of toc) {
    if (ty + lh(e) > H - 18) { if (need2 && cx === M) { cx = M + colW + 8; ty = 30; } else break; }
    doc.setFont('helvetica', e.level ? 'normal' : 'bold'); doc.setFontSize(e.level ? 7.8 : 8.6); doc.setTextColor(e.level ? 40 : NAVY[0], e.level ? 40 : NAVY[1], e.level ? 40 : NAVY[2]);
    const label = doc.splitTextToSize(T(e.label), colW - 14 - (e.level ? 4 : 0))[0];
    doc.text(label, cx + (e.level ? 4 : 0), ty);
    doc.text(String(e.page), cx + colW, ty, { align: 'right' });
    ty += lh(e);
  }
  footer();
  return doc;
}

/** Quick sanity metrics for tests: does the report carry what the dashboard shows? */
export function reportFacts(a: Analysis) {
  return {
    gstSales: a.gst ? Object.fromEntries(a.gst.fys.map((f) => [f, a.gst!.revenueFY[f]])) : {},
    bankGross: a.bank?.adjusted.gross ?? null,
    bankAdjusted: a.bank?.adjusted.adjusted ?? null,
    score: a.risk.overall.score,
    decision: a.risk.decision.decision,
    months: a.bank?.months.map(fyOfMonth),
  };
}
