import * as XLSX from 'xlsx';
import type { Analysis } from '../engine/analyse';
import type { Dataset } from '../engine/types';
import { ITEM_LABELS } from '../engine/parseFinancial';
import { fieldCatalog, evaluateMeasure } from '../engine/measures';
import { DISCLAIMER } from './common';
import type { CustomMeasure } from './pages/Custom';

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

/** Excel workbook with every cleaned table and every calculated table. */
const SHEET_PAGES: Record<string, string[]> = {
  Cover: ['*'], 'Executive Summary': ['Overview'], 'Company Profile': ['Overview', 'Loan File'],
  '3Y Performance': ['Financials'], 'Financials (cleaned)': ['Financials'], 'Custom Measures': ['Financials', 'My Visuals'], '21 Ratios': ['Ratios'], 'Working Capital': ['Working Capital'],
  'GST Monthly': ['GST'], 'GST Buyers': ['GST'], 'GST Suppliers': ['GST'], 'GST Concentration': ['GST'], 'GST Filing': ['GST'], 'GST States': ['GST'], 'GST Exports': ['GST'],
  'Bank Monthly': ['Banking'], 'Bank Adjusted Inflow': ['Banking'], 'Bank Parties': ['Banking'], 'Bank Transactions': ['Banking'], 'Loans & Utilisation': ['Banking'],
  Reconciliation: ['Reconciliation'], 'Risk & Score': ['Risk & SWOT'], SWOT: ['SWOT', 'Risk & SWOT'], 'Credit Decision': ['Credit Decision'],
  Documents: ['Loan File'], 'Company Master': ['Loan File'], 'Bank Statements': ['Loan File', 'Banking'], 'GSTR-3B Returns': ['Loan File', 'GST'], 'Existing Loans': ['Loan File', 'Credit Decision'],
  'Bureau & Net Worth': ['Loan File', 'Ageing & Bureau'], 'Debtors Ageing': ['Loan File', 'Ageing & Bureau'], 'Creditors Ageing': ['Loan File', 'Ageing & Bureau'], 'Ageing (entered)': ['Ageing & Bureau'], 'Tally Parties': ['Loan File', 'GST'],
  'Cleaning Log': ['ALL'],
};
const INR_FMT = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';
const INR_FMT2 = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

/** Sheet with readable formatting: column widths, Indian number grouping, filter on the header row. */
function niceSheet(rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const widths: number[] = [];
  rows.forEach((r, ri) => (r || []).forEach((v, ci) => {
    const len = v === null || v === undefined ? 0 : typeof v === 'number' ? 14 : String(v).length;
    widths[ci] = Math.min(60, Math.max(widths[ci] || 8, len + 2));
    if (typeof v === 'number' && Number.isFinite(v)) {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (!cell) return;
      const int = Math.abs(v - Math.round(v)) < 1e-9;
      cell.z = Math.abs(v) >= 1000 ? (int ? INR_FMT : INR_FMT2) : int ? '0' : Math.abs(v) < 10 ? '0.00##' : '0.00';
    }
  }));
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  const head = rows[0] || [];
  if (rows.length > 2 && head.length > 2 && head.every((h) => typeof h === 'string' && h)) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: head.length - 1 } }) };
  return ws;
}

/** Excel workbook with every cleaned table and every calculated table (or only one report page). */
export function exportExcel(a: Analysis, ds: Dataset, measures: CustomMeasure[], hidden: string[] = [], onlyPage?: string) {
  const wb = XLSX.utils.book_new();
  const wanted = (name: string) => {
    const pages = SHEET_PAGES[name] || ['*'];
    if (pages.includes('*')) return true;
    if (pages.includes('ALL')) return !onlyPage;
    if (onlyPage) return pages.includes(onlyPage);
    return pages.some((p) => !hidden.includes(`page:${p}`));
  };
  const add = (name: string, rows: unknown[][]) => { if (wanted(name) && rows.length) XLSX.utils.book_append_sheet(wb, niceSheet(rows), name.slice(0, 31)); };
  const show = (_p: string) => true; // eslint-disable-line @typescript-eslint/no-unused-vars
  add('Cover', [['INGOVIQ AI — Integrated Financial, GST, Banking & Credit Analysis'], ['Report', onlyPage || 'Complete report'], ['Company', a.company], ['Generated', new Date().toLocaleString('en-IN')], ['Overall AI credit score', a.risk.overall.score, a.risk.overall.risk], ['Decision', a.risk.decision.decision], [], ['Disclaimer', DISCLAIMER]]);
  const snap = Object.entries(a.risk.snapshot);
  add('Executive Summary', [['Parameter', 'Assessment'], ...snap, [], ['Analyst note', a.risk.analystNote]]);
  const prof = { ...(ds.extra?.profile || {}), ...Object.fromEntries(Object.entries(ds.financial?.profile || {}).filter(([, v]) => v)) };
  add('Company Profile', [['Particular', 'Details'], ['Company Name', a.company], ...Object.entries(prof), ['GSTIN', (ds.gst?.gstins || ds.extra?.gstCerts.map((g) => g.gstin) || []).join(', ')],
    ['Directors', (ds.financial?.directors.length ? ds.financial.directors.map((d) => d.name) : (ds.extra?.directors || []).map((d) => `${d.name} (${d.designation}, ${d.appointed})`)).join(', ')]]);
  if (a.fin && (show('Financials') || show('Ratios') || show('Working Capital'))) {
    const fys = a.fin.fys;
    add('3Y Performance', [['Parameter', 'Formula', ...fys, ...fys.slice(1).map((f) => `YoY ${f}`), 'CAGR', 'Trend'], ...a.fin.performance.map((m) => [m.name, m.formula, ...fys.map((f) => r2(m.values[f])), ...fys.slice(1).map((f) => r2(m.yoy[f])), r2(m.cagr), m.trend])]);
    add('21 Ratios', [['Parameter', 'Formula', 'DAX', ...fys, 'Benchmark', 'Trend'], ...a.fin.ratios.map((m) => [m.name, m.formula, m.dax, ...fys.map((f) => r2(m.values[f])), m.benchmark || '', m.trend]), [], ...a.fin.extra.map((m) => [m.name, m.formula, m.dax, ...fys.map((f) => r2(m.values[f])), '', m.trend])]);
    add('Working Capital', [['FY', 'Inventory days', 'Debtor days', 'Creditor days', 'Net cycle', 'WC gap'], ...a.fin.wc.map((w) => [w.fy, r2(w.inventoryDays), r2(w.debtorDays), r2(w.creditorDays), r2(w.cycle), r2(w.gap)]), [], ['Assessment'], ...Object.entries(a.fin.wcAssessment)]);
    if (ds.financial) add('Financials (cleaned)', [['Line item', ...fys], ...Object.keys(ITEM_LABELS).filter((k) => ds.financial!.items[k]).map((k) => [ITEM_LABELS[k], ...fys.map((f) => ds.financial!.items[k][f] ?? null)])]);
    if (measures.length) {
      const cat = fieldCatalog(a.fin);
      add('Custom Measures', [['Measure', 'Formula', ...fys], ...measures.map((m) => { const r = evaluateMeasure(m.formula, cat, fys); return [m.name, m.formula, ...fys.map((f) => r2(r.values[f]))]; })]);
    }
  }
  if (a.gst && show('GST')) {
    const g = a.gst;
    add('GST Monthly', [['Month', 'FY', 'Sales', 'Purchases', 'Margin', 'Sales/Purchase'], ...g.monthly.map((m) => [m.month, m.fy, m.revenue, m.purchase, m.margin, r2(m.ratio)])]);
    add('GST Buyers', [['FY', 'Buyer', 'GSTIN', 'State', 'Sales', '% of sales', 'Months', 'Trend'], ...g.fys.flatMap((f) => (g.buyers[f] || []).map((b) => [f, b.name, b.gstin, b.state, b.total, r2(b.share), b.months, b.trend]))]);
    add('GST Suppliers', [['FY', 'Supplier', 'GSTIN', 'State', 'Purchases', '% of purchases', 'Months', 'Trend'], ...g.fys.flatMap((f) => (g.suppliers[f] || []).map((b) => [f, b.name, b.gstin, b.state, b.total, r2(b.share), b.months, b.trend]))]);
    add('GST Concentration', [['FY', 'Type', 'Top 1', 'Top 5', 'Top 10', 'Largest', 'Count', 'Risk'], ...g.concentration.buyers.map((c) => [c.fy, 'Buyers', r2(c.top1), r2(c.top5), r2(c.top10), c.largestName, c.count, c.risk]), ...g.concentration.suppliers.map((c) => [c.fy, 'Suppliers', r2(c.top1), r2(c.top5), r2(c.top10), c.largestName, c.count, c.risk])]);
    add('GST Filing', [['GSTIN', 'State', 'Return', 'FY', 'Period', 'Due', 'Filed', 'Delay days'], ...g.filing.rows.map((f) => [f.gstin, f.state, f.returnType, f.fy, f.period, f.due, f.filed, f.delayDays])]);
    add('GST States', [['FY', 'State', 'Sales', '% revenue', 'Purchases', '% purchase'], ...g.states.flatMap((s) => s.rows.map((r) => [s.fy, r.state, r.sales, r2(r.salesPct), r.purchase, r2(r.purchasePct)]))]);
    add('GST Exports', [['FY', 'Domestic', 'Export', 'Total', 'Export ratio'], ...g.exports.map((e) => [e.fy, e.domestic, e.export, e.total, r2(e.ratio)])]);
  }
  if (a.bank && show('Banking')) {
    const b = a.bank;
    add('Bank Monthly', [['Month', 'Inflow', 'Outflow', 'Net', 'Adjusted inflow', 'Closing', 'Credits', 'Debits', 'Cash', 'Inward returns', 'EMI', 'Interest', 'Loans'], ...b.monthly.map((m) => [m.month, m.inflow, m.outflow, m.net, m.adjustedInflow, m.closing, m.credits, m.debits, m.cash, m.inwardReturns, m.emi, m.interest, m.loans])]);
    add('Bank Adjusted Inflow', Object.entries(b.adjusted).map(([k, v]) => [k, v]));
    add('Bank Parties', [['Direction', 'Party', 'Amount', 'Share', 'Count', 'Class'], ...b.parties.inflow.map((p) => ['Inflow', p.party, p.amount, r2(p.share), p.count, p.cls]), ...b.parties.outflow.map((p) => ['Outflow', p.party, p.amount, r2(p.share), p.count, p.cls])]);
    add('Bank Transactions', [['Date', 'Account', 'Narration', 'Category', 'Party', 'Debit', 'Credit', 'Balance', 'INGOVIQ class', 'Reason'], ...b.txns.map((t) => [t.date, t.account, t.description, t.category, t.counterparty, t.debit, t.credit, t.balance, t.cls, t.reason])]);
    add('Loans & Utilisation', [['Date', 'Type', 'Narration', 'Amount'], ...b.loans.map((l) => [l.date, l.type, l.description, l.amount]), [], ['Account', 'Limit', 'Avg util', 'Peak util', 'Days >90%', 'Overdrawn days', 'Class'], ...b.utilisation.map((u) => [u.account, u.limit, r2(u.avgUtil), r2(u.peakUtil), u.daysAbove90, u.overdrawnDays, u.classification])]);
  }
  const rc = a.recon;
  add('Reconciliation', [['FY', 'Financial', 'GST', 'GST months', 'Var GST', 'Bank gross', 'Bank adjusted', 'Bank months', 'Status', 'Remarks'], ...rc.fyRows.map((r) => [r.fy, r.financial, r.gst, r.gstMonths, r2(r.varGst), r.bankGross, r.bankAdjusted, r.bankMonths, r.status, r.remarks.join('; ')]),
    [], ['Overlap', rc.overlap?.label || ''], ['GST taxable', rc.overlap?.gstTaxable ?? null], ['GST incl. tax', rc.overlap?.gstGross ?? null], ['Bank gross', rc.overlap?.bankGross ?? null], ['Bank adjusted', rc.overlap?.bankAdjusted ?? null], ['Variance', r2(rc.overlap?.variance)], ['Status', rc.overlap?.status || ''],
    [], ['GST buyer', 'GSTIN', 'GST sales', 'Incl GST', 'Bank party', 'Bank receipts', 'Variance', 'Status'], ...rc.buyers.rows.map((r) => [r.gstParty, r.gstin, r.gstAmount, r.gstGross, r.bankParty, r.bankAmount, r2(r.variance), r.status])]);
  add('Risk & Score', [['Dimension', 'Score', 'Classification', 'Basis'], ...a.risk.scores.map((s) => [s.name, s.score, s.classification, s.basis]), ['OVERALL', a.risk.overall.score, a.risk.overall.risk], [], ['Area', 'Severity', 'Red flag'], ...a.risk.flags.map((f) => [f.area, f.severity, f.text]),
    [], ['SWOT'], ...a.risk.swot.strengths.map((s) => ['Strength', s]), ...a.risk.swot.weaknesses.map((s) => ['Weakness', s]), ...a.risk.swot.opportunities.map((s) => ['Opportunity', s]), ...a.risk.swot.threats.map((s) => ['Threat', s])]);
  add('SWOT', [['Type', 'Observation', 'Detail', 'Metric', 'Value', 'Benchmark', 'Severity', 'Source', 'Section', 'Recommendation'], ...a.swot.items.map((i) => [i.type, i.title, i.detail, i.metric, i.value, i.benchmark, i.severity, i.source, i.section, i.recommendation])]);
  const d = a.risk.decision;
  add('Credit Decision', [['Decision', d.decision], ['Recommended funding', d.recommendedFunding], ['Product', d.product], ['Tenure', d.tenure], ['Repayment capacity', d.repayment], ['Security', d.security], ['Collateral / FLDG', d.collateral], [], ['Funding capacity'], ...a.risk.funding.method.map((m) => [m]), [], ['Question', 'Answer'], ...a.risk.qa.map((q) => [q.q, q.a])]);
  const x = ds.extra;
  if (x && ds.docs?.length && show('Loan File')) {
    add('Documents', [['Folder', 'File', 'Type', 'Status', 'What INGOVIQ found', 'Size KB'], ...ds.docs.map((d) => [d.path.split('/').slice(0, -1).join('/'), d.path.split('/').pop(), d.type, d.status, d.note, Math.round(d.size / 1024)])]);
    if (Object.keys(x.profile).length) add('Company Master', [['Field', 'Value'], ...Object.entries(x.profile), [], ['Director', 'Designation', 'Appointed'], ...x.directors.map((d) => [d.name, d.designation, d.appointed]), [], ['GSTIN', 'State', 'Legal name', 'Liability from'], ...x.gstCerts.map((g) => [g.gstin, g.state, g.legalName, g.regDate])]);
    if (x.statements.length) add('Bank Statements', [['File', 'Bank', 'Account', 'From', 'To', 'Transactions', 'Balance breaks'], ...x.statements.map((t) => [t.file.split('/').pop(), t.bank, t.account, t.from, t.to, t.txns, t.mismatches])]);
    if (x.gstr3b.length) add('GSTR-3B Returns', [['GSTIN', 'Period', 'FY', 'Taxable 3.1a', 'Zero-rated 3.1b', 'Nil/exempt 3.1c', 'RCM 3.1d', 'Non-GST 3.1e', 'Output tax', 'ITC available', 'Filed on', 'ARN'], ...[...x.gstr3b].sort((p, q) => p.gstin.localeCompare(q.gstin) || p.period.localeCompare(q.period)).map((r) => [r.gstin, r.period, r.fy, r.taxable, r.zeroRated, r.nilExempt, r.reverseCharge, r.nonGst, r.outputTax, r.itc, r.filedOn, r.arn])]);
    if (x.loans.length) add('Existing Loans', [['Lender', 'Facility', 'Sanctioned', 'Outstanding', 'EMI', 'ROI', 'Start', 'End', 'Tenure', 'Paid from'], ...x.loans.map((l) => [l.lender, l.facility, l.sanction, l.outstanding, l.emi, l.roi, l.start, l.end, l.tenure, l.paidFrom])]);
    if (x.cibil.length || x.networth.length) add('Bureau & Net Worth', [['Name', 'Report', 'Score / CMR', 'Accounts / facilities', 'Sanctioned', 'Current / outstanding', 'Overdue', 'Delinquency remark', 'Report date'], ...x.cibil.map((c) => c.kind === 'commercial' ? [c.name, 'Commercial', `CMR-${c.cmr ?? ''}`, c.facilities, null, c.outstanding, c.overdue, '', c.reportDate] : [c.name, 'Consumer', c.score, c.accounts, c.sanctioned, c.current, c.overdue, c.delinquencyFlag ? 'Delinquency in history' : '', c.reportDate]), [], ['Promoter', 'PAN', 'Net worth', 'Certificate date'], ...x.networth.map((n) => [n.name, n.pan, n.total, n.date])]);
    for (const ag of x.ageing) add(ag.side === 'receivable' ? 'Debtors Ageing' : 'Creditors Ageing', [['As on', ag.asOf], ['Bucket', 'Outstanding'], ...Object.entries(ag.buckets), [], ['Party', 'Billed', 'Outstanding', 'Avg days'], ...ag.parties.map((p) => [p.name, p.invoiced, p.outstanding, r2(p.avgDays)])]);
    if (x.ledgerParties.length) add('Tally Parties', [['Party ledger', 'Sales', 'Purchases', 'Receipts', 'Payments', 'Closing (Dr +, Cr −)'], ...x.ledgerParties.map((p) => [p.name, Object.values(p.sales).reduce((u, v) => u + v, 0), Object.values(p.purchases).reduce((u, v) => u + v, 0), p.receipts, p.payments, p.closing])]);
  }
  add('Cleaning Log', [['Level', 'File', 'Message'], ...ds.log.map((l) => [l.level, l.source, l.message])]);
  XLSX.writeFile(wb, `INGOVIQ_${onlyPage ? onlyPage.replace(/[^\w]+/g, '_') + '_' : ''}${a.company.replace(/[^\w]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Capture each element as an A4-landscape PDF page (long sections continue onto further pages). Disclaimer footer on every page. */
export async function exportPdf(sections: HTMLElement[], company: string, onProgress?: (msg: string) => void, only?: string, withDisclaimer = false) {
  const [{ jsPDF }, html2canvas] = await Promise.all([import('jspdf'), import('html2canvas').then((m) => m.default)]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const margin = 8, footerH = withDisclaimer ? 16 : 8, headerH = 8;
  const usableW = W - margin * 2, usableH = H - margin - footerH - headerH;
  let first = true;
  const footer = () => {
    pdf.setFontSize(5.6);
    pdf.setTextColor(110);
    if (withDisclaimer) pdf.text(pdf.splitTextToSize(DISCLAIMER, W - margin * 2), margin, H - footerH + 3);
    pdf.setFontSize(7);
    pdf.text(`INGOVIQ AI · ${company} · page ${pdf.getNumberOfPages()}`, W - margin, H - 3, { align: 'right' });
  };
  const header = (title: string) => {
    pdf.setFontSize(9);
    pdf.setTextColor(11, 27, 63);
    pdf.text(`INGOVIQ AI — ${title}`, margin, margin + 3);
  };
  const SCALE = 1.35;
  for (let i = 0; i < sections.length; i++) {
    const el = sections[i];
    const title = el.getAttribute('data-title') || '';
    onProgress?.(`Rendering ${title} (${i + 1}/${sections.length})…`);
    // page breaks fall between rows / cards / sections, never through a line of text
    const top0 = el.getBoundingClientRect().top;
    const total = el.scrollHeight;
    const cssPerMm = el.scrollWidth / usableW;
    const pageCss = Math.floor(usableH * cssPerMm);
    const marks = new Set<number>();
    el.querySelectorAll<HTMLElement>('tr, .section-title, .card, .kpi, .note, .grid > *, li, .page-head, .disclaimer, h1, h2, h3, .card-title, .tbl-wrap, details').forEach((n) => {
      if (n.offsetParent === null) return;
      marks.add(Math.round(n.getBoundingClientRect().top - top0));
    });
    const sorted = [...marks].filter((m) => m > 0 && m < total).sort((x, y) => x - y);
    const cuts: number[] = [0];
    while (cuts[cuts.length - 1] + pageCss < total) {
      const start = cuts[cuts.length - 1], limit = start + pageCss;
      let best = -1;
      for (const m of sorted) { if (m > limit) break; if (m > start + pageCss * 0.45) best = m; }
      cuts.push(best > 0 ? best : limit);
    }
    cuts.push(total);
    // render in chunks (canvas size limits), each chunk = several PDF pages
    for (let c = 0; c < cuts.length - 1;) {
      let e = c + 1;
      while (e < cuts.length - 1 && cuts[e + 1] - cuts[c] < 14000) e++;
      const y0 = cuts[c], y1 = cuts[e];
      const canvas = await html2canvas(el, { scale: SCALE, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: el.scrollWidth, x: 0, y: y0, width: el.scrollWidth, height: y1 - y0 });
      const k = canvas.height / (y1 - y0);
      for (let p = c; p < e; p++) {
        const sy = Math.round((cuts[p] - y0) * k), sh = Math.max(1, Math.round((cuts[p + 1] - cuts[p]) * k));
        const part = document.createElement('canvas');
        part.width = canvas.width;
        part.height = sh;
        const g = part.getContext('2d')!;
        g.fillStyle = '#fff'; g.fillRect(0, 0, part.width, sh);
        g.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        if (!first) pdf.addPage();
        first = false;
        header(title);
        const mmW = usableW, mmH = (sh / canvas.width) * usableW;
        pdf.addImage(part.toDataURL('image/jpeg', 0.82), 'JPEG', margin, margin + headerH, mmW, Math.min(mmH, usableH));
        footer();
      }
      c = e;
    }
  }
  pdf.save(`INGOVIQ_${only ? only.replace(/[^\w]+/g, '_') : 'Credit_Report'}_${company.replace(/[^\w]+/g, '_').slice(0, 40)}.pdf`);
}

export async function exportPng(el: HTMLElement, name: string) {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff', logging: false });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${name.replace(/[^\w]+/g, '_')}.png`;
  a.click();
}

/** Blank Excel to type audited figures into (for scanned statements). Upload it back with Get data. */
export function exportFinancialTemplate(company: string, fys: string[]) {
  const rows: unknown[][] = [['INGOVIQ Financial Input'], [`Company: ${company}`], ['Type amounts in ₹ (not lakhs / crores). Leave a cell empty if not applicable. Upload this file back with Get data.'], [], ['Line item', ...fys]];
  for (const label of Object.values(ITEM_LABELS)) rows.push([label, ...fys.map(() => null)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 42 }, ...fys.map(() => ({ wch: 18 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Financial Input');
  XLSX.writeFile(wb, `INGOVIQ_Financial_Input_${company.replace(/[^\w]+/g, '_').slice(0, 30)}.xlsx`);
}
