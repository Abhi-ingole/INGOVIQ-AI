import * as XLSX from 'xlsx';
import type { Analysis } from '../engine/analyse';
import type { Dataset } from '../engine/types';
import { ITEM_LABELS } from '../engine/parseFinancial';
import { fieldCatalog, evaluateMeasure } from '../engine/measures';
import { DISCLAIMER } from './common';
import type { CustomMeasure } from './pages/Custom';

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

/** Excel workbook with every cleaned table and every calculated table. */
export function exportExcel(a: Analysis, ds: Dataset, measures: CustomMeasure[]) {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  add('Cover', [['INGOVIQ AI — Integrated Financial, GST, Banking & Credit Analysis'], ['Company', a.company], ['Generated', new Date().toLocaleString('en-IN')], ['Overall AI credit score', a.risk.overall.score, a.risk.overall.risk], ['Decision', a.risk.decision.decision], [], ['Disclaimer', DISCLAIMER]]);
  const snap = Object.entries(a.risk.snapshot);
  add('Executive Summary', [['Parameter', 'Assessment'], ...snap, [], ['Analyst note', a.risk.analystNote]]);
  if (a.fin) {
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
  if (a.gst) {
    const g = a.gst;
    add('GST Monthly', [['Month', 'FY', 'Sales', 'Purchases', 'Margin', 'Sales/Purchase'], ...g.monthly.map((m) => [m.month, m.fy, m.revenue, m.purchase, m.margin, r2(m.ratio)])]);
    add('GST Buyers', [['FY', 'Buyer', 'GSTIN', 'State', 'Sales', '% of sales', 'Months', 'Trend'], ...g.fys.flatMap((f) => (g.buyers[f] || []).map((b) => [f, b.name, b.gstin, b.state, b.total, r2(b.share), b.months, b.trend]))]);
    add('GST Suppliers', [['FY', 'Supplier', 'GSTIN', 'State', 'Purchases', '% of purchases', 'Months', 'Trend'], ...g.fys.flatMap((f) => (g.suppliers[f] || []).map((b) => [f, b.name, b.gstin, b.state, b.total, r2(b.share), b.months, b.trend]))]);
    add('GST Concentration', [['FY', 'Type', 'Top 1', 'Top 5', 'Top 10', 'Largest', 'Count', 'Risk'], ...g.concentration.buyers.map((c) => [c.fy, 'Buyers', r2(c.top1), r2(c.top5), r2(c.top10), c.largestName, c.count, c.risk]), ...g.concentration.suppliers.map((c) => [c.fy, 'Suppliers', r2(c.top1), r2(c.top5), r2(c.top10), c.largestName, c.count, c.risk])]);
    add('GST Filing', [['GSTIN', 'State', 'Return', 'FY', 'Period', 'Due', 'Filed', 'Delay days'], ...g.filing.rows.map((f) => [f.gstin, f.state, f.returnType, f.fy, f.period, f.due, f.filed, f.delayDays])]);
    add('GST States', [['FY', 'State', 'Sales', '% revenue', 'Purchases', '% purchase'], ...g.states.flatMap((s) => s.rows.map((r) => [s.fy, r.state, r.sales, r2(r.salesPct), r.purchase, r2(r.purchasePct)]))]);
    add('GST Exports', [['FY', 'Domestic', 'Export', 'Total', 'Export ratio'], ...g.exports.map((e) => [e.fy, e.domestic, e.export, e.total, r2(e.ratio)])]);
  }
  if (a.bank) {
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
  const d = a.risk.decision;
  add('Credit Decision', [['Decision', d.decision], ['Recommended funding', d.recommendedFunding], ['Product', d.product], ['Tenure', d.tenure], ['Repayment capacity', d.repayment], ['Security', d.security], ['Collateral / FLDG', d.collateral], [], ['Funding capacity'], ...a.risk.funding.method.map((m) => [m]), [], ['Question', 'Answer'], ...a.risk.qa.map((q) => [q.q, q.a])]);
  add('Cleaning Log', [['Level', 'File', 'Message'], ...ds.log.map((l) => [l.level, l.source, l.message])]);
  XLSX.writeFile(wb, `INGOVIQ_${a.company.replace(/[^\w]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Capture each element as an A4-landscape PDF page (long sections continue onto further pages). Disclaimer footer on every page. */
export async function exportPdf(sections: HTMLElement[], company: string, onProgress?: (msg: string) => void) {
  const [{ jsPDF }, html2canvas] = await Promise.all([import('jspdf'), import('html2canvas').then((m) => m.default)]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const margin = 8, footerH = 16, headerH = 8;
  const usableW = W - margin * 2, usableH = H - margin - footerH - headerH;
  let first = true;
  const footer = () => {
    pdf.setFontSize(5.6);
    pdf.setTextColor(110);
    const lines = pdf.splitTextToSize(DISCLAIMER, W - margin * 2);
    pdf.text(lines, margin, H - footerH + 3);
    pdf.setFontSize(7);
    pdf.text(`INGOVIQ AI · ${company} · page ${pdf.getNumberOfPages()}`, W - margin, H - 3, { align: 'right' });
  };
  const header = (title: string) => {
    pdf.setFontSize(9);
    pdf.setTextColor(11, 27, 63);
    pdf.text(`INGOVIQ AI — ${title}`, margin, margin + 3);
  };
  for (let i = 0; i < sections.length; i++) {
    const el = sections[i];
    const title = el.getAttribute('data-title') || '';
    onProgress?.(`Rendering ${title} (${i + 1}/${sections.length})…`);
    const canvas = await html2canvas(el, { scale: 1.35, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: el.scrollWidth });
    const pxPerMm = canvas.width / usableW;
    const sliceH = Math.floor(usableH * pxPerMm);
    for (let y = 0; y < canvas.height; y += sliceH) {
      const h = Math.min(sliceH, canvas.height - y);
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = h;
      part.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage();
      first = false;
      header(title);
      pdf.addImage(part.toDataURL('image/jpeg', 0.8), 'JPEG', margin, margin + headerH, usableW, h / pxPerMm);
      footer();
    }
  }
  pdf.save(`INGOVIQ_Credit_Report_${company.replace(/[^\w]+/g, '_').slice(0, 40)}.pdf`);
}

export async function exportPng(el: HTMLElement, name: string) {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff', logging: false });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${name.replace(/[^\w]+/g, '_')}.png`;
  a.click();
}
