/* "Open in Power BI": a Power BI Project (.pbip) — semantic model + report — that follows the
   "Integrated Financial, GST, Banking & Credit Analysis Report" format exactly: 17 report pages carrying
   sections 1–40 in the same order and with the same headings, the Section 40 disclaimer at the bottom of
   every page, and charts on every page. All analysed data is embedded in the model (no file paths, no
   gateway): unzip and double-click the .pbip. */
import { zipSync, strToU8 } from 'fflate';
import type { Analysis } from '../../engine/analyse';
import type { Dataset, ManualInputs } from '../../engine/types';
import { DEFAULT_INPUTS } from '../../engine/types';
import { fyOfMonth, monthLabel } from '../../engine/utils';
import { fmtCr, fmtINR, fmtPct, fmtUnit, fmtX, fmtDays } from '../../engine/format';
import { companySnapshotRows } from '../../engine/snapshotRows';
import { buildEvidence } from '../../engine/evidence';
import baseTheme from './CY24SU10.json';

type ColType = 'text' | 'number' | 'date';
type Cell = string | number | null;
interface Tbl { name: string; cols: [string, ColType, string?][]; rows: Cell[][]; measures?: [string, string, string?][] }

const mStr = (v: string) => `"${v.replace(/"/g, '""').replace(/[\r\n\t]+/g, ' ')}"`;
const mVal = (v: Cell, t: ColType) => {
  if (v === null || v === undefined || v === '') return 'null';
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : 'null';
  if (t === 'date') { const m = String(v).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); return m ? `#date(${+m[1]}, ${+m[2]}, ${+(m[3] || 1)})` : 'null'; }
  return mStr(String(v));
};
const mType = (t: ColType) => (t === 'number' ? 'number' : t === 'date' ? 'date' : 'text');
const idName = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `#${mStr(n)}`);
const daxStr = (s: string) => `"${s.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;

function mExpression(t: Tbl): string[] {
  const type = `type table [${t.cols.map(([c, ty]) => `${idName(c)} = ${mType(ty)}`).join(', ')}]`;
  const rows = t.rows.map((r) => `        {${r.map((v, i) => mVal(v, t.cols[i][1])).join(', ')}}`);
  return ['let', `    Source = #table(${type}, {`, ...rows.map((r, i) => (i < rows.length - 1 ? r + ',' : r)), '    })', 'in', '    Source'];
}

function modelBim(tables: Tbl[]) {
  return {
    compatibilityLevel: 1550,
    model: {
      culture: 'en-US',
      dataAccessOptions: { legacyRedirects: true, returnErrorValuesAsNull: true },
      defaultPowerBIDataSourceVersion: 'powerBI_V3',
      sourceQueryCulture: 'en-IN',
      tables: tables.map((t) => ({
        name: t.name,
        columns: t.cols.map(([c, ty, fmt]) => ({
          name: c, dataType: ty === 'number' ? 'double' : ty === 'date' ? 'dateTime' : 'string', sourceColumn: c,
          summarizeBy: ty === 'number' ? 'sum' : 'none',
          ...(ty === 'number' ? { formatString: fmt || '#,0' } : ty === 'date' ? { formatString: fmt || 'dd-mmm-yy' } : {}),
        })),
        partitions: [{ name: t.name, mode: 'import', source: { type: 'm', expression: mExpression(t) } }],
        ...(t.measures?.length ? { measures: t.measures.map(([name, expression, fmt]) => ({ name, expression, ...(fmt ? { formatString: fmt } : {}) })) } : {}),
      })),
      annotations: [
        { name: 'PBI_QueryOrder', value: JSON.stringify(tables.map((t) => t.name)) },
        { name: '__PBI_TimeIntelligenceEnabled', value: '0' },
      ],
    },
  };
}

/* ---------------- report visuals ---------------- */
interface Field { t: string; c: string; agg?: boolean; measure?: boolean; dn?: string }
const C = (t: string, c: string, dn?: string): Field => ({ t, c, dn });
const S = (t: string, c: string, dn?: string): Field => ({ t, c, agg: true, dn });
const M = (c: string, dn?: string): Field => ({ t: 'KPI', c, measure: true, dn });
const qref = (f: Field) => (f.agg ? `Sum(${f.t}.${f.c})` : `${f.t}.${f.c}`);
const lit = (v: string) => ({ expr: { Literal: { Value: v } } });

interface Spec { name: string; type: string; x: number; y: number; z: number; w: number; h: number; proj: Record<string, Field[]>; title: string; text?: { value: string; size: string; bold: boolean }[]; wide?: boolean }
let vid = 0;
function V(type: string, x: number, y: number, w: number, h: number, proj: Record<string, Field[]>, title: string, wide = false): Spec {
  vid++;
  return { name: `v${String(vid).padStart(4, '0')}${type.slice(0, 6)}`, type, x, y, z: vid, w, h, proj, title, wide };
}
function TB(x: number, y: number, w: number, h: number, paras: { value: string; size?: string; bold?: boolean }[]): Spec {
  vid++;
  return { name: `v${String(vid).padStart(4, '0')}textbx`, type: 'textbox', x, y, z: vid, w, h, proj: {}, title: '', text: paras.map((p) => ({ value: p.value, size: p.size || '10pt', bold: !!p.bold })) };
}

const CHARTS = new Set(['clusteredColumnChart', 'clusteredBarChart', 'columnChart', 'barChart', 'lineChart', 'lineClusteredColumnComboChart', 'waterfallChart', 'areaChart']);
function objectsFor(v: Spec, pbir: boolean) {
  const o: Record<string, unknown> = {};
  const L = (x: string) => (pbir ? lit(x) : lit(x));
  if (v.type === 'textbox') {
    o.general = [{ properties: { paragraphs: v.text!.map((p) => ({ textRuns: [{ value: p.value, textStyle: { fontSize: p.size, ...(p.bold ? { fontWeight: 'bold' } : {}) } }] })) } }];
  }
  if (v.type === 'slicer') o.data = [{ properties: { mode: L("'Dropdown'") } }];
  if (v.type === 'tableEx' || v.type === 'pivotTable') o.values = [{ properties: { wordWrap: L('true') } }];
  if (CHARTS.has(v.type)) o.labels = [{ properties: { show: L('true') } }];
  return o;
}

/* classic (report.json) container */
function legacyContainer(v: Spec) {
  const tables = [...new Set(Object.values(v.proj).flat().map((f) => f.t))];
  const alias = Object.fromEntries(tables.map((t, i) => [t, `t${i}`]));
  const sel = Object.values(v.proj).flat().filter((f, i, arr) => arr.findIndex((g) => qref(g) === qref(f)) === i).map((f) => {
    const col = { Expression: { SourceRef: { Source: alias[f.t] } }, Property: f.c };
    if (f.measure) return { Measure: col, Name: qref(f) };
    if (f.agg) return { Aggregation: { Expression: { Column: col }, Function: 0 }, Name: qref(f) };
    return { Column: col, Name: qref(f) };
  });
  const single: Record<string, unknown> = { visualType: v.type, drillFilterOtherVisuals: true, objects: objectsFor(v, false) };
  if (v.type !== 'textbox') {
    single.projections = Object.fromEntries(Object.entries(v.proj).map(([role, fs]) => [role, fs.map((f, i) => ({ queryRef: qref(f), ...(i === 0 && role === 'Category' ? { active: true } : {}) }))]));
    single.prototypeQuery = { Version: 2, From: tables.map((t) => ({ Name: alias[t], Entity: t, Type: 0 })), Select: sel };
    const names = Object.values(v.proj).flat().filter((f) => f.dn);
    if (names.length) single.columnProperties = Object.fromEntries(names.map((f) => [qref(f), { displayName: f.dn }]));
    single.vcObjects = { title: [{ properties: { show: lit(v.title ? 'true' : 'false'), text: lit(`'${v.title.replace(/'/g, "''")}'`) } }] };
  }
  const config = { name: v.name, layouts: [{ id: 0, position: { x: v.x, y: v.y, z: v.z, width: v.w, height: v.h } }], singleVisual: single };
  return { x: v.x, y: v.y, z: v.z, width: v.w, height: v.h, config: JSON.stringify(config), filters: '[]' };
}

/* PBIR (definition folder) visual */
const SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition';
function pbirField(f: Field) {
  const col = { Expression: { SourceRef: { Entity: f.t } }, Property: f.c };
  return f.measure ? { Measure: col } : f.agg ? { Aggregation: { Expression: { Column: col }, Function: 0 } } : { Column: col };
}
function pbirVisual(v: Spec, i: number) {
  const visual: Record<string, unknown> = { visualType: v.type };
  if (v.type !== 'textbox') {
    visual.query = { queryState: Object.fromEntries(Object.entries(v.proj).map(([role, fs]) => [role, { projections: fs.map((f, k) => ({ field: pbirField(f), queryRef: qref(f), nativeQueryRef: f.agg ? f.c : f.c, ...(f.dn ? { displayName: f.dn } : {}), ...(k === 0 && role === 'Category' ? { active: true } : {}) })) }])) };
  }
  const o = objectsFor(v, true);
  if (Object.keys(o).length) visual.objects = o;
  if (v.type !== 'textbox' && v.title) visual.visualContainerObjects = { title: [{ properties: { show: lit('true'), text: lit(`'${v.title.replace(/'/g, "''")}'`) } }] };
  visual.drillFilterOtherVisuals = true;
  return {
    $schema: `${SCHEMA}/visualContainer/1.5.0/schema.json`,
    name: v.name,
    position: { x: v.x, y: v.y, z: v.z * 1000, height: v.h, width: v.w, tabOrder: i * 1000 },
    visual,
  };
}

const DISCLAIMER = '40. REPORT DISCLAIMER / DECLARATION — This report is generated based on the Financial Statements, GST Data, Banking Data, CIBIL/CMR Information, Invoice/Ageing Data and other information made available for analysis. All calculations, ratios, trends, reconciliations, risk indicators, scoring outputs, projections and AI-generated observations are dependent upon the accuracy, authenticity, completeness and availability of the underlying data. The report is intended solely for financial analysis, credit assessment and decision-support purposes and should not be construed as a sanction, commitment, assurance or guarantee of funding from any Bank, NBFC, Financial Institution, Investor or other funding institution. Any indicative eligibility, funding capacity, product recommendation, risk classification or AI Credit Score remains subject to independent due diligence, applicable regulations and the respective lender/investor\'s internal credit policy and final approval.';
const PRODUCTS = ['CC / OD', 'WCDL', 'WCDTL', 'Term Loan', 'Purchase Finance', 'Sales Invoice Discounting', 'Factoring', 'Reverse Factoring', 'TReDS', 'Dealer Finance', 'Distributor Finance', 'Import Finance', 'Export Finance', 'LC', 'BG', 'Structured Debt'];
const QUESTIONS = ["Is the company's turnover growing or declining?", 'Is the growth supported by profitability?', 'Is operating cash flow adequate?', 'Is existing leverage sustainable?', 'Can the company comfortably service existing and proposed debt?', 'Is the working-capital requirement justified?', 'Do GST sales support the reported financial turnover?', 'Does adjusted banking turnover support GST/financial turnover?', 'Are buyer and supplier concentrations acceptable?', 'Is banking conduct satisfactory?', 'Are there cheque/ECS/EMI return concerns?', 'Is CC/OD utilisation comfortable or stressed?', 'Is CIBIL/CMR conduct satisfactory?', 'Are there material discrepancies or red flags?', "What is the company's indicative additional funding capacity?", 'Which financial product is most appropriate?', 'What conditions/mitigants should be imposed?', 'Should the proposal be classified as GO, CONDITIONAL GO or NO-GO?'];
const core = (s: string) => s.toLowerCase().replace(/m\/s\.?/g, ' ').replace(/[^a-z0-9]+/g, '').replace(/(privatelimited|privatelimite|pvtltd|private|limited|pvt|ltd|llp)+$/g, '');

export function buildPowerBiProject(a: Analysis, ds: Dataset, inp: ManualInputs = DEFAULT_INPUTS): { blob: Blob; fileName: string; tables: number; rows: number } {
  vid = 0;
  const ev = buildEvidence(ds);
  const fin = a.fin, gst = a.gst, bank = a.bank, rec = a.recon, risk = a.risk;
  const fys = fin?.fys || [];
  const last = fys[fys.length - 1];
  const prev = fys[fys.length - 2];
  const tables: Tbl[] = [];
  const add = (t: Tbl) => { tables.push(t); return t; };
  const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
  const metric = (k: string) => [...(fin?.performance || []), ...(fin?.ratios || []), ...(fin?.extra || [])].find((m) => m.key === k);
  const mv = (k: string, fy?: string) => (fy ? n(metric(k)?.values[fy]) : null);

  /* ---------- KPI measures (cards) ---------- */
  const kpi: [string, string, string?][] = [];
  const num = (name: string, v: number | null | undefined, fmt = '#,0') => kpi.push([name, v === null || v === undefined || !Number.isFinite(v) ? 'BLANK()' : String(Math.round(v * 10000) / 10000), fmt]);
  const txt = (name: string, v: string) => kpi.push([name, daxStr(v || '—')]);
  num('Latest Turnover', mv('revenue', last)); num('EBITDA', mv('ebitda', last)); num('PAT', mv('pat', last)); num('Tangible Net Worth', mv('tnw', last)); num('Total Debt', mv('total_debt', last));
  txt('Latest FY', last || 'Not provided');
  txt('Decision', risk.decision.decision); num('Overall Score', risk.overall.score, '0'); num('Score Max', 100, '0'); txt('Overall Risk', risk.overall.risk);
  txt('Funding Eligibility', risk.decision.recommendedFunding === null ? 'Not assessable' : fmtCr(risk.decision.recommendedFunding));
  txt('Recommended Product', risk.decision.product); txt('Reconciliation Status', rec.overallStatus);
  num('Red Flags', risk.flags.length, '0'); num('High Flags', risk.flags.filter((f) => f.severity === 'High').length, '0');
  txt('Disclaimer', DISCLAIMER);
  if (gst) {
    const cb = gst.concentration.buyers[gst.concentration.buyers.length - 1], cs = gst.concentration.suppliers[gst.concentration.suppliers.length - 1];
    txt('Buyer Concentration Risk', `${cb?.risk ?? '—'} (${cb?.fy ?? ''})`); txt('Supplier Concentration Risk', `${cs?.risk ?? '—'} (${cs?.fy ?? ''})`);
    num('Top 5 Buyers %', cb?.top5, '0.0%'); num('Top 10 Buyers %', cb?.top10, '0.0%'); num('Largest Buyer %', cb?.top1, '0.0%'); txt('Largest Buyer', cb?.largestName || '—');
    num('Top 5 Suppliers %', cs?.top5, '0.0%'); num('Top 10 Suppliers %', cs?.top10, '0.0%'); num('Largest Supplier %', cs?.top1, '0.0%'); txt('Largest Supplier', cs?.largestName || '—');
    txt('Export Dependency', gst.exportDependency); txt('GST Compliance', gst.filing.compliance); txt('Related-Party Dependency', gst.relatedPartyDependency);
    num('Late Returns', gst.filing.summary.lateReturns, '0'); num('Returns Filed', gst.filing.summary.totalReturns, '0'); num('Late Filing %', gst.filing.summary.latePct, '0.0%');
    num('Est Late Fee', gst.filing.summary.estLateFee); num('Missing Periods', gst.filing.summary.missingPeriods, '0'); num('Max Delay Days', gst.filing.summary.maxDelay, '0');
    txt('Unusual Movement', gst.unusualMonths.length ? `${gst.unusualMonths.length} unusual month(s): ${gst.unusualMonths.slice(0, 4).map((u) => `${monthLabel(u.month)} — ${u.note}`).join('; ')}` : 'No unusual sales / purchase movement');
    const geo = gst.geoConcentration[gst.geoConcentration.length - 1];
    txt('Geographical Concentration', geo ? `${geo.topState}: ${fmtPct(geo.share)} of sales (${geo.fy})` : '—');
    txt('Customer Diversification', cb ? `${cb.count} buyers · HHI ${cb.hhi === null ? '—' : cb.hhi.toFixed(2)}` : '—');
  }
  if (bank) {
    const t = bank.totals, ad = bank.adjusted;
    num('Total Inflow', t.inflow); num('Total Outflow', t.outflow); num('Avg Monthly Inflow', t.avgInflow); num('Avg Monthly Outflow', t.avgOutflow); num('Net Cash Movement', t.net);
    txt('Peak Month', t.peakMonth ? monthLabel(t.peakMonth) : '—'); txt('Lowest Month', t.lowMonth ? monthLabel(t.lowMonth) : '—'); num('Volatility', t.volatility, '0.00'); txt('Banking Trend', t.trend);
    num('Adjusted Business Inflow', ad.adjusted); num('Internal + Group + Promoter', ad.internal + ad.group + ad.promoter);
    const r = bank.returns;
    num('Inward Returns', r.inward.count, '0'); num('Inward Return Amount', r.inward.amount); num('Outward Returns', r.outward.count, '0'); num('Outward Return Amount', r.outward.amount);
    num('ECS NACH EMI Returns', r.ecsNachEmi.count, '0'); num('Penal Charges', r.penal.amount, '#,0.00'); num('Penal Entries', r.penal.count, '0'); txt('Cheque Return Risk', r.risk);
    txt('Repeated Instances', r.ecsNachEmi.count + r.penal.count + r.outward.count >= 2 ? `Stress indicator — ${r.outward.count} outward returns, ${r.ecsNachEmi.count} ECS/NACH/EMI returns, ${r.penal.count} penal charges` : 'No repeated return / penal pattern');
    const ce = bank.creditEntries;
    num('Credit Entries', ce.total, '0'); num('Monthly Avg Credits', ce.monthlyAvg, '0.0'); num('Avg Credit Amount', ce.avgAmount); num('Largest Credit', ce.largest[0]?.credit ?? null);
    num('Cash Deposits', bank.cash.total); num('Cash Deposit Count', bank.cash.count, '0'); num('Cash % of Credits', bank.cash.pctOfCredits, '0.0%');
    num('BTO', rec.bto.bankTurnover); num('BTO to GST', rec.bto.btoToGst, '0.00'); num('BTO to Financial', rec.bto.btoToFinancial, '0.00');
    const u = bank.utilisation[0];
    txt('CC Classification', bank.utilisation.length ? bank.utilisation.map((x) => `${x.account}: ${x.classification}`).join(' · ') : 'No CC / OD account');
    num('Sanctioned Limit', u?.limit ?? null); num('Avg Utilisation', u?.avgUtil ?? null, '0.0%'); num('Peak Utilisation', u?.peakUtil ?? null, '0.0%'); num('Min Utilisation', u?.minUtil ?? null, '0.0%');
    num('Days Above 90', u?.daysAbove90 ?? null, '0'); num('Overdrawn Days', u?.overdrawnDays ?? null, '0');
    txt('Interest Servicing', `Interest debited in ${bank.interest.filter((i) => i.amount > 0).length} of ${bank.months.length} months, ${fmtINR(bank.interest.reduce((s, i) => s + i.amount, 0))}; EMI debits ${bank.emi.length}`);
    txt('Banking Conduct', bank.conduct);
  }
  if (rec.overlap) { txt('Overlap Status', `${rec.overlap.status} (${rec.overlap.label}, variance ${fmtPct(rec.overlap.variance)})`); txt('Overlap Note', rec.overlap.lagNote || ''); }
  num('Additional Debt Capacity', risk.funding.additionalDebt); num('WC Gap', risk.funding.wcGap);
  if (fin) { num('MPBF', fin.wcAssessment.mpbf); num('Additional WC', fin.wcAssessment.additionalWC); }
  txt('Bureau Risk', risk.snapshot['CIBIL/CMR Conduct'] || 'Not provided');
  num('Items Scored', risk.overall.covered, '0');
  add({ name: 'KPI', cols: [['Item', 'text']], rows: [['INGOVIZ AI']], measures: kpi.map(([nm, e, f]) => [nm, e, f]) });

  /* ---------- tables per section ---------- */
  add({ name: 'S01 Snapshot', cols: [['No', 'number', '0'], ['Particular', 'text'], ['Details', 'text']], rows: companySnapshotRows(a, ds, inp).map(([k, v], i) => [i + 1, k, v]) });
  add({ name: 'S01 Directors', cols: [['Director', 'text'], ['Designation', 'text'], ['Ceased', 'text']], rows: (ds.financial?.directors || []).map((d) => [d.name, d.designation, d.ceased || '—']) });
  add({ name: 'S01 Charges', cols: [['Charge Holder', 'text'], ['Amount', 'number'], ['Created', 'text'], ['Status', 'text'], ['Rate', 'text']], rows: (ds.financial?.charges || []).map((c) => [c.holder, c.amount, c.created, !c.satisfied || c.satisfied === '-' ? 'Open' : `Satisfied ${c.satisfied}`, c.rate]) });
  const SCALE: Record<string, string> = { 'Business Performance': 'Strong / Satisfactory / Weak', 'Financial Performance': 'Strong / Satisfactory / Weak', Liquidity: 'Comfortable / Moderate / Stressed', Leverage: 'Low / Moderate / High', 'Debt Servicing': 'Comfortable / Moderate / Weak', 'Working Capital': 'Comfortable / Stretched / Stressed', 'GST Conduct': 'Regular / Moderate Concern / Irregular', 'Banking Conduct': 'Good / Satisfactory / Watchlist / Stressed', 'CIBIL/CMR Conduct': 'Clean / Satisfactory / Concern / High Risk', 'Overall Credit Risk': 'Low / Moderate / High / Very High' };
  add({ name: 'S02 Executive', cols: [['No', 'number', '0'], ['Area', 'text'], ['Assessment', 'text'], ['Scale', 'text']], rows: Object.keys(SCALE).map((k, i) => [i + 1, k, risk.snapshot[k] || '—', SCALE[k]]) });

  if (fin) {
    type WcRow = typeof fin.wc[number];
    add({ name: 'Fin Trend', cols: [['FY', 'text'], ['Revenue', 'number'], ['EBITDA', 'number'], ['PAT', 'number'], ['Net Worth', 'number'], ['Total Debt', 'number'], ['EBITDA Margin', 'number', '0.0%'], ['PAT Margin', 'number', '0.0%'],
      ['Current Ratio', 'number', '0.00'], ['Quick Ratio', 'number', '0.00'], ['Debt Equity', 'number', '0.00'], ['TOL TNW', 'number', '0.00'], ['DSCR', 'number', '0.00'], ['ICR', 'number', '0.00'], ['Debt EBITDA', 'number', '0.00'],
      ['Debtor Days', 'number', '0'], ['Creditor Days', 'number', '0'], ['Inventory Days', 'number', '0'], ['WC Cycle', 'number', '0']],
      rows: fys.map((f) => { const w = fin.wc.find((x) => x.fy === f); return [f, mv('revenue', f), mv('ebitda', f), mv('pat', f), mv('networth', f), mv('total_debt', f), mv('ebitda_margin', f), mv('pat_margin', f), mv('r_cr', f), mv('r_qr', f), mv('r_de', f), mv('r_toltnw', f), mv('r_dscr', f), mv('r_icr', f), mv('r_debitda', f), n(w?.debtorDays), n(w?.creditorDays), n(w?.inventoryDays), n(w?.cycle)]; }) });
    const yoyTxt = (m: NonNullable<ReturnType<typeof metric>>) => { const y = last ? m.yoy[last] : null; if (m.unit === 'pct' && last && prev) { const c = m.values[last], p = m.values[prev]; return c === null || p === null || c === undefined || p === undefined ? '—' : `${((c - p) * 100).toFixed(2)} pp`; } return y === null || y === undefined ? '—' : fmtPct(y); };
    add({ name: 'S03 Performance', cols: [['No', 'number', '0'], ['Financial Parameter', 'text'], ...fys.map((f) => [f, 'text'] as [string, ColType]), ['YoY %', 'text'], ['CAGR', 'text'], ['3-Year Trend', 'text']],
      rows: fin.performance.map((m, i) => [i + 1, m.name, ...fys.map((f) => (m.unit === 'inr' ? fmtCr(m.values[f]) : fmtUnit(m.values[f], m.unit))), yoyTxt(m), m.unit === 'inr' && m.cagr !== null ? fmtPct(m.cagr) : '—', m.trend]) });
    add({ name: 'S03 AI Trend', cols: [['No', 'number', '0'], ['AI Financial Trend', 'text']], rows: risk.trendComments.map((c, i) => [i + 1, c]) });
    add({ name: 'S04 Ratios', cols: [['No', 'number', '0'], ['Parameter', 'text'], ['Formula / Calculation', 'text'], ...fys.map((f) => [f, 'text'] as [string, ColType]), ['Trend', 'text']],
      rows: fin.ratios.map((m, i) => [i + 1, m.name.replace(/^\d+\.\s*/, ''), m.formula, ...fys.map((f) => (m.key === 'r_pnw' && (m.values[f] === null || m.values[f] === undefined) ? 'Not provided' : m.unit === 'inr' ? fmtCr(m.values[f]) : fmtUnit(m.values[f], m.unit))), m.trend]) });
    const w = fin.wcAssessment;
    add({ name: 'S05 Working Capital', cols: [['No', 'number', '0'], ['Item', 'text'], ...fys.map((f) => [f, 'text'] as [string, ColType])],
      rows: [['Inventory Days', (r: WcRow) => fmtDays(r.inventoryDays)], ['Debtor Days', (r: WcRow) => fmtDays(r.debtorDays)], ['Creditor Days', (r: WcRow) => fmtDays(r.creditorDays)],
        ['Net Working Capital Cycle', (r: WcRow) => fmtDays(r.cycle)], ['Working Capital Gap', (r: WcRow) => fmtCr(r.gap)]].map(([lab, f], i) => [i + 1, lab as string, ...fys.map((fy) => { const r = fin.wc.find((x) => x.fy === fy); return r ? (f as (r: WcRow) => string)(r) : '—'; })]) });
    add({ name: 'S05 AI Assessment', cols: [['No', 'number', '0'], ['Assessment', 'text'], ['Result', 'text'], ['Scale', 'text']], rows: [
      [1, 'Working Capital Cycle', w.cycle, 'Improving / Stable / Deteriorating'], [2, 'Receivables', w.receivables, 'Normal / Stretched / Critical'], [3, 'Inventory', w.inventory, 'Normal / High / Very High'],
      [4, 'Supplier Dependency', w.supplierDependency, 'Low / Moderate / High'], [5, 'Additional WC Requirement', fmtCr(w.additionalWC), `₹ Cr (MPBF ${fmtCr(w.mpbf)}; turnover method ${fmtCr(w.turnoverMethod)})`]] });
  }

  if (gst) {
    const prow = (role: 'B' | 'S') => gst.fys.flatMap((f) => ((role === 'B' ? gst.buyers[f] : gst.suppliers[f]) || []).map((p) => [f, p.name, p.state, p.total, p.share, p.trend] as Cell[]));
    add({ name: 'S06 Buyers', cols: [['FY', 'text'], ['Buyer', 'text'], ['State', 'text'], ['Total Sales', 'number'], ['% of Total Sales', 'number', '0.0%'], ['Transaction Trend', 'text']], rows: prow('B') });
    add({ name: 'S07 Suppliers', cols: [['FY', 'text'], ['Supplier', 'text'], ['State', 'text'], ['Total Purchase', 'number'], ['% of Total Purchase', 'number', '0.0%'], ['Transaction Trend', 'text']], rows: prow('S') });
    const conc = (rows: typeof gst.concentration.buyers) => rows.map((c) => [c.fy, c.total, c.top1, c.top5, c.top10, c.largestName, c.count, c.hhi, c.risk] as Cell[]);
    const ccols: [string, ColType, string?][] = [['FY', 'text'], ['Total', 'number'], ['Largest %', 'number', '0.0%'], ['Top 5 %', 'number', '0.0%'], ['Top 10 %', 'number', '0.0%'], ['Largest Party', 'text'], ['Parties', 'number', '0'], ['HHI', 'number', '0.00'], ['Risk', 'text']];
    add({ name: 'S06 Buyer Concentration', cols: ccols, rows: conc(gst.concentration.buyers) });
    add({ name: 'S07 Supplier Concentration', cols: ccols, rows: conc(gst.concentration.suppliers) });
    add({ name: 'S08 GST Monthly', cols: [['Month', 'date', 'mmm-yy'], ['FY', 'text'], ['Sales', 'number'], ['Purchases', 'number'], ['Sales to Purchase', 'number', '0.00']], rows: gst.monthly.map((m) => [`${m.month}-01`, m.fy, m.revenue, m.purchase, m.ratio]) });
    add({ name: 'S08 Annual', cols: [['FY', 'text'], ['Total Sales', 'number'], ['Total Purchases', 'number'], ['Sales to Purchase Ratio', 'number', '0.00']], rows: gst.salesPurchaseFY.map((r) => [r.fy, r.sales, r.purchase, r.ratio]) });
    add({ name: 'S09 Exports', cols: [['FY', 'text'], ['Domestic Sales', 'number'], ['Export Sales', 'number'], ['Total Turnover', 'number'], ['Export Ratio', 'number', '0.0%'], ['Export Growth', 'text']], rows: gst.exports.map((e) => [e.fy, e.domestic, e.export, e.total, e.ratio, e.growth === null ? (e.export ? 'New / n.m.' : '—') : fmtPct(e.growth)]) });
    add({ name: 'S10 Filing by GSTIN', cols: [['GSTIN', 'text'], ['State', 'text'], ['Return', 'text'], ['Returns', 'number', '0'], ['Late', 'number', '0'], ['Avg Delay', 'number', '0.0'], ['Max Delay', 'number', '0'], ['Late Fee', 'number'], ['Missing Periods', 'text']], rows: gst.filing.byGstin.map((g) => [g.gstin, g.state, g.returnType, g.total, g.late, g.avgDelay, g.maxDelay, g.lateFee, g.missing.join(', ') || 'None']) });
    add({ name: 'S10 Filings', cols: [['GSTIN', 'text'], ['State', 'text'], ['Return', 'text'], ['FY', 'text'], ['Period', 'date', 'mmm-yy'], ['Due Date', 'date'], ['Filing Date', 'date'], ['Delay Days', 'number', '0']], rows: gst.filing.rows.map((r) => [r.gstin, r.state, r.returnType, r.fy, r.period, r.due, r.filed || null, r.delayDays]) });
    add({ name: 'S11 States', cols: [['FY', 'text'], ['State', 'text'], ['Sales', 'number'], ['% Revenue', 'number', '0.0%'], ['Purchases', 'number'], ['% Purchase', 'number', '0.0%']], rows: gst.states.flatMap((s) => s.rows.map((r) => [s.fy, r.state, r.sales, r.salesPct, r.purchase, r.purchasePct])) });
    add({ name: 'S13 HSN', cols: [['HSN Code', 'text'], ['Product', 'text'], ...gst.fys.map((f) => [`Sales ${f}`, 'number'] as [string, ColType])], rows: gst.hsn.length ? gst.hsn.map((h) => [h.code, h.product, ...gst.fys.map((f) => n(h.byFY[f]))]) : [['Not provided', 'HSN-wise data is not in the GST report', ...gst.fys.map(() => null)]] });
  }
  // 12 — group entities across GST and banking
  {
    const names = new Map<string, string>();
    for (const x of ds.financial?.associates || []) names.set(core(x.name), x.name);
    for (const t of bank?.txns || []) if (t.cls === 'Group / Related') { const k = core(t.counterparty); if (![...names.keys()].some((x) => x.includes(k) || k.includes(x))) names.set(k, t.counterparty); }
    const match = (party: string, k: string) => { const c = core(party); return c.length >= 8 && k.length >= 8 && (c.includes(k) || k.includes(c)); };
    const gs = (role: 'B' | 'S', k: string) => (gst ? gst.fys.reduce((s, f) => s + ((role === 'B' ? gst.buyers[f] : gst.suppliers[f]) || []).filter((p) => match(p.name, k)).reduce((x, p) => x + p.total, 0), 0) : 0);
    const totalBiz = gst ? gst.fys.reduce((s, f) => s + (gst.revenueFY[f] || 0) + (gst.purchaseFY[f] || 0), 0) : 0;
    const rows = [...names.entries()].map(([k, nm]) => {
      const bi = (bank?.txns || []).filter((t) => t.cls === 'Group / Related' && match(t.counterparty + ' ' + t.description, k)).reduce((s, t) => s + t.credit, 0);
      const bo = (bank?.txns || []).filter((t) => t.cls === 'Group / Related' && match(t.counterparty + ' ' + t.description, k)).reduce((s, t) => s + t.debit, 0);
      const s = gs('B', k), p = gs('S', k);
      return [nm, s, p, s + p, totalBiz ? (s + p) / totalBiz : null, bi, bo] as Cell[];
    }).filter((r) => (r[1] as number) + (r[2] as number) + (r[5] as number) + (r[6] as number) > 0 || (ds.financial?.associates || []).some((x) => x.name === r[0]));
    add({ name: 'S12 Group Entities', cols: [['Group Entity', 'text'], ['Sales', 'number'], ['Purchases', 'number'], ['Total Transactions', 'number'], ['% of Business', 'number', '0.0%'], ['Bank Inflow', 'number'], ['Bank Outflow', 'number']], rows: rows.length ? rows : [['No group entity identified', 0, 0, 0, null, 0, 0]] });
  }

  if (bank) {
    add({ name: 'S14 Bank Monthly', cols: [['Month', 'date', 'mmm-yy'], ['FY', 'text'], ['Total Inflow', 'number'], ['Total Outflow', 'number'], ['Adjusted Inflow', 'number'], ['Closing Balance', 'number'], ['Credit Entries', 'number', '0'], ['Cash Deposits', 'number'], ['Inward Returns', 'number', '0'], ['Outward Returns', 'number', '0'], ['Interest', 'number']],
      rows: bank.monthly.map((m) => [`${m.month}-01`, fyOfMonth(m.month), m.inflow, m.outflow, m.adjustedInflow, m.closing, m.credits, m.cash, m.inwardReturns, m.outwardReturns, m.interest]) });
    const agg = new Map<string, { cls: string; party: string; inflow: number; outflow: number; count: number }>();
    for (const t of bank.internalTxns) { const k = `${t.cls}|${t.counterparty.toLowerCase()}`; const g = agg.get(k) || { cls: t.cls, party: t.counterparty, inflow: 0, outflow: 0, count: 0 }; g.inflow += t.credit; g.outflow += t.debit; g.count++; agg.set(k, g); }
    add({ name: 'S15 Internal', cols: [['Type', 'text'], ['Counterparty', 'text'], ['Inflow', 'number'], ['Outflow', 'number'], ['Entries', 'number', '0']], rows: [...agg.values()].sort((x, y) => y.inflow + y.outflow - x.inflow - x.outflow).map((g) => [g.cls, g.party, g.inflow, g.outflow, g.count]) });
    const ad = bank.adjusted;
    add({ name: 'S16 Adjusted Inflow', cols: [['No', 'number', '0'], ['Step', 'text'], ['Amount', 'number'], ['What is removed', 'text']], rows: [
      [1, 'Total Bank Inflow', ad.gross, 'All credits in the statements'],
      [2, 'Less: Internal Transfers', -(ad.internal + ad.group + ad.promoter), `Own accounts ${fmtCr(ad.internal)} · group / related ${fmtCr(ad.group)} · promoter / director ${fmtCr(ad.promoter)}`],
      [3, 'Less: Loan Disbursements', -ad.loans, 'Term / unsecured / NBFC loan credits'],
      [4, 'Less: Identifiable Non-Business Credits', -(ad.returns + ad.nonBusiness), `Returns & reversals ${fmtCr(ad.returns)} · other non-business ${fmtCr(ad.nonBusiness)}`],
      [5, '= Adjusted Business Inflow', ad.adjusted, 'Used for turnover reconciliation']] });
    add({ name: 'S16 Waterfall', cols: [['Step', 'text'], ['Amount', 'number']], rows: [['1 Total bank inflow', ad.gross], ['2 Internal transfers', -(ad.internal + ad.group + ad.promoter)], ['3 Loan disbursements', -ad.loans], ['4 Non-business credits', -(ad.returns + ad.nonBusiness)]] });
    const r = bank.returns;
    const ret = (type: string, items: typeof r.inward.items) => items.map((t) => [type, t.date, t.account, t.description, t.credit || t.debit] as Cell[]);
    add({ name: 'S18 Returns', cols: [['Type', 'text'], ['Date', 'date'], ['Account', 'text'], ['Narration', 'text'], ['Amount', 'number']], rows: [...ret('Inward cheque return', r.inward.items), ...ret('Outward return', r.outward.items), ...ret('ECS / NACH / EMI return', r.ecsNachEmi.items), ...ret('Penal charge', r.penal.items)] });
    add({ name: 'S20 Largest Credits', cols: [['Date', 'date'], ['Party', 'text'], ['Class', 'text'], ['Amount', 'number']], rows: bank.creditEntries.largest.map((t) => [t.date, t.counterparty, t.cls, t.credit]) });
    add({ name: 'S21 BTO', cols: [['No', 'number', '0'], ['Item', 'text'], ['Value', 'text']], rows: [
      [1, 'Banking turnover (business credits)', fmtCr(rec.bto.bankTurnover)], [2, 'Months of banking', String(rec.bto.months)], [3, 'Annualised BTO', fmtCr(rec.bto.annualised)],
      [4, 'GST turnover, same period (incl. tax)', fmtCr(rec.bto.gstSamePeriod)], [5, 'Latest financial turnover', fmtCr(rec.bto.financialLatest)],
      [6, 'Banking Turnover / GST Sales', rec.bto.btoToGst === null ? '—' : fmtX(rec.bto.btoToGst)], [7, 'Banking Turnover / Financial Sales (annualised)', rec.bto.btoToFinancial === null ? '—' : fmtX(rec.bto.btoToFinancial)]] });
    add({ name: 'S22 Inflow Parties', cols: [['Party', 'text'], ['Class', 'text'], ['Amount', 'number'], ['% of Total Inflow', 'number', '0.0%'], ['Entries', 'number', '0']], rows: bank.parties.inflow.slice(0, 50).map((p) => [p.party, p.cls, p.amount, p.share, p.count]) });
    add({ name: 'S22 Outflow Parties', cols: [['Party', 'text'], ['Class', 'text'], ['Amount', 'number'], ['% of Total Outflow', 'number', '0.0%'], ['Entries', 'number', '0']], rows: bank.parties.outflow.slice(0, 50).map((p) => [p.party, p.cls, p.amount, p.share, p.count]) });
    add({ name: 'S23 Loans', cols: [['Date', 'date'], ['Type', 'text'], ['Description', 'text'], ['Amount', 'number'], ['Account', 'text']], rows: bank.loans.map((l) => [l.date, l.type, l.description, l.amount, l.account]) });
    add({ name: 'S24 Cash', cols: [['Month', 'date', 'mmm-yy'], ['Cash Deposits', 'number']], rows: Object.entries(bank.cash.monthly).sort().map(([m, v]) => [`${m}-01`, v]) });
    add({ name: 'S24 Large Cash', cols: [['Date', 'date'], ['Narration', 'text'], ['Amount', 'number']], rows: bank.cash.large.map((t) => [t.date, t.description, t.credit]) });
    add({ name: 'S25 Utilisation', cols: [['Account', 'text'], ['Sanctioned Limit', 'number'], ['Limit Source', 'text'], ['Average', 'number', '0.0%'], ['Peak', 'number', '0.0%'], ['Minimum', 'number', '0.0%'], ['Days above 90%', 'number', '0'], ['Overdrawn Days', 'number', '0'], ['Classification', 'text']],
      rows: bank.utilisation.map((u) => [u.account, u.limit, u.limitSource, u.avgUtil, u.peakUtil, u.minUtil, u.daysAbove90, u.overdrawnDays, u.classification]) });
    add({ name: 'S25 CC Daily', cols: [['Account', 'text'], ['Date', 'date'], ['Drawn', 'number'], ['Limit', 'number']], rows: bank.utilisation.flatMap((u) => u.daily.map((d) => [u.account, d.date, Math.max(0, -d.balance), u.limit])) });
  }

  // 26–28
  add({ name: 'S26 Year-wise', cols: [['FY', 'text'], ['Financial Turnover', 'number'], ['GST Turnover', 'number'], ['GST Months', 'number', '0'], ['Gross Banking Inflow', 'number'], ['Adjusted Business Inflow', 'number'], ['Bank Months', 'number', '0'], ['GST vs Financial', 'number', '0.0%'], ['Status', 'text'], ['AI Remarks', 'text']],
    rows: rec.fyRows.map((r) => [r.fy, r.financial, r.gst, r.gstMonths, r.bankGross, r.bankAdjusted, r.bankMonths, r.varGst, r.status, r.remarks.join('; ')]) });
  {
    const lr = rec.fyRows.filter((r) => r.financial !== null).slice(-1)[0];
    const ad = bank?.adjusted;
    const o = rec.overlap;
    add({ name: 'S26 Sources', cols: [['No', 'number', '0'], ['Source', 'text'], ['Reported Amount', 'number'], ['Variance', 'text'], ['AI Remarks', 'text']], rows: [
      [1, 'Financial Turnover', lr?.financial ?? null, '', lr ? `Audited, ${lr.fy}` : 'Not provided'],
      [2, 'GST Turnover', lr?.gst ?? null, lr?.varGst === null || lr?.varGst === undefined ? '—' : fmtPct(lr.varGst), lr ? `${lr.fy}: ${lr.status}${lr.remarks.length ? ' — ' + lr.remarks.join('; ') : ''}` : '—'],
      [3, 'Gross Banking Inflow', ad?.gross ?? null, '', bank ? `${bank.months.length} months of statements` : 'Not provided'],
      [4, 'Internal Transfers', ad ? ad.internal + ad.group + ad.promoter : null, '', 'Own accounts, group companies and promoter / director accounts'],
      [5, 'Loan / Non-Business Credits', ad ? ad.loans + ad.returns + ad.nonBusiness : null, '', 'Loan disbursements, returns / reversals and other non-business credits'],
      [6, 'Adjusted Business Inflow', ad?.adjusted ?? null, o?.variance === null || o?.variance === undefined ? '—' : fmtPct(o.variance), o ? `vs GST sales incl. tax on the same months (${o.label}): ${o.status}. ${o.lagNote}` : 'No overlapping GST and banking months']] });
    if (o) add({ name: 'S26 Overlap', cols: [['Month', 'date', 'mmm-yy'], ['GST Sales incl GST', 'number'], ['Adjusted Business Inflow', 'number'], ['Gross Bank Inflow', 'number']], rows: o.monthly.map((m) => [`${m.month}-01`, m.gstGross, m.bankAdjusted, m.bankGross]) });
  }
  const pm = (rows: typeof rec.buyers.rows) => rows.map((r) => [r.gstParty, r.gstin, r.gstAmount, r.gstGross, r.bankParty, r.bankAmount, r.variance, r.status] as Cell[]);
  const pmCols = (who: string): [string, ColType, string?][] => [[who, 'text'], ['GSTIN', 'text'], ['GST Amount', 'number'], ['GST incl Tax', 'number'], ['Bank Party', 'text'], ['Bank Amount', 'number'], ['Variance', 'number', '0.0%'], ['Status', 'text']];
  add({ name: 'S27 Buyer vs Bank', cols: pmCols('GST Buyer'), rows: pm(rec.buyers.rows) });
  add({ name: 'S27 Credits not in GST', cols: [['Party', 'text'], ['Amount', 'number']], rows: rec.buyers.unmatchedBankCredits.map((u) => [u.party, u.amount]) });
  add({ name: 'S28 Supplier vs Bank', cols: pmCols('GST Supplier'), rows: pm(rec.suppliers.rows) });
  add({ name: 'S28 Payments not in GST', cols: [['Party', 'text'], ['Amount', 'number']], rows: rec.suppliers.unmatchedBankDebits.map((u) => [u.party, u.amount]) });

  // 29–30
  {
    const ext = ds.extra?.ageing || [];
    const rTot = inp.ageing.reduce((s, b) => s + b.receivable, 0), pTot = inp.ageing.reduce((s, b) => s + b.payable, 0);
    const has = rTot + pTot > 0;
    add({ name: 'S29 Ageing', cols: [['No', 'number', '0'], ['Age', 'text'], ['Receivable', 'number'], ['Receivable %', 'number', '0.0%'], ['Payable', 'number'], ['Payable %', 'number', '0.0%'], ['Status', 'text']],
      rows: inp.ageing.map((b, i) => [i + 1, b.bucket, has ? b.receivable : null, has && rTot ? b.receivable / rTot : null, has ? b.payable : null, has && pTot ? b.payable / pTot : null, has ? 'Provided' : ext.length ? 'See ageing file in Loan File page' : 'Not provided']) });
    const x = ds.extra;
    const cons = x?.cibil.filter((c) => c.kind === 'consumer') || [], com = x?.cibil.find((c) => c.kind === 'commercial');
    const loans = x?.loans || [];
    const charges = (ds.financial?.charges || []).filter((c) => !c.satisfied || c.satisfied === '-');
    const B: [string, string][] = [
      ['CIBIL Score', cons.length ? cons.map((c) => `${c.name}: ${c.kind === 'consumer' ? c.score ?? '?' : ''}`).join(' · ') : inp.cibilScore ? String(inp.cibilScore) : 'Not provided'],
      ['CMR Rank', com && com.kind === 'commercial' && com.cmr ? `CMR-${com.cmr}` : inp.cmrRank ? `CMR-${inp.cmrRank}` : 'Not provided'],
      ['Existing Loans', loans.length ? `${loans.length} facilities` : charges.length ? `Open charges: ${charges.map((c) => `${c.holder} ${fmtCr(c.amount)}`).join('; ')}` : 'Not provided'],
      ['Sanctioned Limits', loans.length ? fmtCr(loans.reduce((s, l) => s + (l.sanction || 0), 0)) : 'Not provided'],
      ['Outstanding', loans.length ? fmtCr(loans.reduce((s, l) => s + (l.outstanding || 0), 0)) : com && com.kind === 'commercial' && com.outstanding ? fmtCr(com.outstanding) : last ? `Audited total debt ${fmtCr(mv('total_debt', last))} (${last})` : 'Not provided'],
      ['EMI obligations', loans.length ? `${fmtINR(loans.reduce((s, l) => s + (l.emi || 0), 0))} / month` : bank?.emi.length ? `${bank.emi.length} EMI debits in bank, ${fmtINR(bank.emi.reduce((s, e) => s + e.amount, 0))}` : 'Not provided'],
      ['DPD', cons.length ? cons.map((c) => (c.kind === 'consumer' ? `${c.name}: max ${c.dpdMax}` : '')).join(' · ') : inp.dpdObserved ? 'DPD observed (manual input)' : 'Not provided'],
      ['SMA', 'Not provided'], ['NPA', 'Not provided'],
      ['Overdues', com && com.kind === 'commercial' && com.overdue !== null ? fmtINR(com.overdue) : 'Not provided'],
      ['Settled accounts', 'Not provided'], ['Write-offs', 'Not provided'], ['Recent enquiries', 'Not provided'],
      ['Utilisation', bank?.utilisation.length ? bank.utilisation.map((u) => `${u.account}: avg ${fmtPct(u.avgUtil)}`).join(' · ') : 'Not provided'],
      ['Repayment track record', bank ? `${bank.returns.ecsNachEmi.count} ECS/NACH/EMI return(s), ${bank.returns.outward.count} outward return(s) in bank` : 'Not provided'],
    ];
    add({ name: 'S30 Bureau', cols: [['No', 'number', '0'], ['Bureau Item', 'text'], ['Available Information', 'text']], rows: B.map(([k, v], i) => [i + 1, k, v]) });
  }

  // 31–40
  const flags = (areas: string[]) => risk.flags.filter((f) => areas.includes(f.area)).map((f, i) => [i + 1, f.severity, f.text] as Cell[]);
  const fcols: [string, ColType, string?][] = [['No', 'number', '0'], ['Severity', 'text'], ['Red Flag', 'text']];
  const none = (t: Cell[][]) => (t.length ? t : [[1, '—', 'No red flag identified from the available data']]);
  add({ name: 'S31 Financial Flags', cols: fcols, rows: none(flags(['Financial'])) });
  add({ name: 'S32 GST Flags', cols: fcols, rows: none(flags(['GST'])) });
  add({ name: 'S33 Banking Flags', cols: fcols, rows: none(flags(['Banking', 'Reconciliation', 'Bureau'])) });
  add({ name: 'Flag Count', cols: [['Area', 'text'], ['Severity', 'text'], ['Flags', 'number', '0']], rows: [...new Set(risk.flags.map((f) => `${f.area}|${f.severity}`))].map((k) => { const [ar, sv] = k.split('|'); return [ar, sv, risk.flags.filter((f) => f.area === ar && f.severity === sv).length]; }) });
  const swot = (type: string) => a.swot.items.filter((i) => i.type === type).map((i, k) => [k + 1, i.title, i.detail, i.severity, i.recommendation || ''] as Cell[]);
  const scols: [string, ColType, string?][] = [['No', 'number', '0'], ['Point', 'text'], ['Evidence', 'text'], ['Severity', 'text'], ['Recommendation', 'text']];
  add({ name: 'S34 Strengths', cols: scols, rows: swot('Strength') });
  add({ name: 'S34 Weaknesses', cols: scols, rows: swot('Weakness') });
  add({ name: 'S34 Opportunities', cols: scols, rows: swot('Opportunity') });
  add({ name: 'S34 Threats', cols: scols, rows: swot('Threat') });
  add({ name: 'S35 Scorecard', cols: [['No', 'number', '0'], ['Assessment', 'text'], ['Score', 'number', '0'], ['Score Text', 'text'], ['Weight', 'number', '0%'], ['Risk Classification', 'text'], ['Basis', 'text']],
    rows: risk.scores.map((s, i) => [i + 1, s.name, s.score, s.score === null ? 'Not scored – data not provided' : `${s.score} / 100`, s.weight, s.classification, s.basis]) });
  {
    const pick = (k: string) => (last ? mv(k, last) : null);
    const FB: [string, string][] = [['Turnover', fmtCr(pick('revenue'))], ['EBITDA', fmtCr(pick('ebitda'))], ['PAT', fmtCr(pick('pat'))], ['Net Worth', fmtCr(pick('networth'))], ['Existing Debt', fmtCr(pick('total_debt'))],
      ['DSCR', fmtX(pick('r_dscr'))], ['Debt/EBITDA', fmtX(pick('r_debitda'))], ['TOL/TNW', fmtX(pick('r_toltnw'))], ['Working Capital Cycle', fmtDays(fin?.wc.find((w) => w.fy === last)?.cycle)],
      ['GST Sales', gst ? fmtCr(gst.revenueFY[gst.fys[gst.fys.length - 1]]) + ` (${gst.fys[gst.fys.length - 1]})` : 'Not provided'], ['Adjusted Banking Inflow', bank ? fmtCr(bank.adjusted.adjusted) : 'Not provided'],
      ['Existing Obligations', bank ? `EMI ${fmtINR(bank.emi.reduce((s, e) => s + e.amount, 0))}, interest ${fmtINR(bank.interest.reduce((s, e) => s + e.amount, 0))} in bank period` : 'Not provided'], ['Bureau Conduct', risk.snapshot['CIBIL/CMR Conduct'] || 'Not provided']];
    add({ name: 'S36 Funding Basis', cols: [['No', 'number', '0'], ['Based On', 'text'], ['Value', 'text']], rows: FB.map(([k, v], i) => [i + 1, k, v]) });
    add({ name: 'S36 Method', cols: [['No', 'number', '0'], ['Calculation', 'text']], rows: risk.funding.method.map((m, i) => [i + 1, m]) });
  }
  add({ name: 'S37 Products', cols: [['No', 'number', '0'], ['Product', 'text'], ['Indicative Suitability', 'text']], rows: PRODUCTS.map((p, i) => {
    const seg = (v: string) => v.toLowerCase().replace(/cc \/ od/g, 'cc/od').split(/\s+\/\s+|\s+or\s+|\s*[()]\s*/).map((x) => x.trim()).filter(Boolean);
    const hit = risk.products.find((x) => seg(x.name).includes(seg(p)[0]));
    return [i + 1, p, hit ? `Suitable — ${hit.why}` : 'Not indicated by the analysis'];
  }) });
  const d = risk.decision;
  add({ name: 'S38 Recommendation', cols: [['No', 'number', '0'], ['Item', 'text'], ['Recommendation', 'text']], rows: [
    [1, 'Credit Decision', d.decision], [2, 'Recommended Funding', d.recommendedFunding === null ? 'Not assessable' : fmtCr(d.recommendedFunding)], [3, 'Recommended Product', d.product], [4, 'Indicative Tenure', d.tenure],
    [5, 'Repayment Capacity', d.repayment], [6, 'Security Requirement', d.security], [7, 'Additional Collateral / FLDG Requirement', d.collateral]] });
  add({ name: 'S38 Key Points', cols: [['No', 'number', '0'], ['Heading', 'text'], ['Point', 'text']], rows: ([['Key Strengths', d.strengths], ['Key Risks', d.risks], ['Risk Mitigants', d.mitigants], ['Conditions Before Funding', d.conditions], ['Additional Documents / Clarifications', d.documents]] as [string, string[]][])
    .flatMap(([h, list]) => list.map((p) => [h, p])).map(([h, p], i) => [i + 1, h, p]) });
  add({ name: 'S39 Analyst Note', cols: [['Credit Analyst Note', 'text']], rows: [[risk.analystNote]] });
  add({ name: 'S39 Questions', cols: [['No', 'number', '0'], ['Question', 'text'], ['Answer', 'text']], rows: QUESTIONS.map((q, i) => [i + 1, q, risk.qa.find((x) => x.q.toLowerCase().slice(0, 25) === q.toLowerCase().slice(0, 25))?.a || risk.qa[i]?.a || '—']) });
  add({ name: 'Evidence', cols: [['ID', 'text'], ['File', 'text'], ['Document Type', 'text'], ['What Was Read', 'text']], rows: ev.items.map((e) => [e.id, e.file, e.type, e.used]) });

  /* ---------------- 17 pages ---------------- */
  const has = (nm: string) => tables.some((t) => t.name === nm && t.rows.length);
  const W = 1280;
  const pages: { name: string; displayName: string; height: number; visuals: Spec[] }[] = [];
  const cov = `Coverage: ${fys.length ? `audited ${fys[0]} to ${last}` : 'no audited financials'} · ${gst ? `GST ${monthLabel(gst.months[0])} to ${monthLabel(gst.months[gst.months.length - 1])}` : 'no GST data'} · ${bank ? `banking ${monthLabel(bank.months[0])} to ${monthLabel(bank.months[bank.months.length - 1])}` : 'no banking data'}`;
  const page = (title: string, sub: string, height: number, body: (y0: number) => Spec[]) => {
    const vs = [TB(16, 8, W - 32, 58, [{ value: title, size: '16pt', bold: true }, { value: sub, size: '9pt' }]), ...body(72), TB(16, height - 84, W - 32, 76, [{ value: DISCLAIMER, size: '7pt' }])];
    for (const v of vs) if (v.x + v.w > W || v.y + v.h > height) throw new Error(`Visual outside page "${title}"`);
    pages.push({ name: `Section${String(pages.length + 1).padStart(2, '0')}`, displayName: title.replace(/^PART [A-H] — /, ''), height, visuals: vs });
  };
  const cards = (items: [string, string][], y: number, h = 84, x0 = 16, x1 = W - 16) => { const gap = 10, w = Math.floor((x1 - x0 - gap * (items.length - 1)) / items.length); return items.map(([m, t], i) => V('card', x0 + i * (w + gap), y, w, h, { Values: [M(m)] }, t)); };
  const tbl = (t: string, colsList: string[], x: number, y: number, w: number, h: number, title: string) => V('tableEx', x, y, w, h, { Values: colsList.map((c) => C(t, c)) }, title, true);
  const missing = (what: string, y: number) => [TB(16, y, W - 32, 60, [{ value: `${what} — not provided in the uploaded files.`, size: '12pt', bold: true }])];
  const fyCols = fys;

  page('1. COMPANY & CREDIT SNAPSHOT', `INTEGRATED FINANCIAL, GST, BANKING & CREDIT ANALYSIS REPORT — ${a.company} · ${cov}`, 1060, (y) => [
    ...cards([['Latest Turnover', `Latest Turnover (₹) ${last || ''}`], ['EBITDA', 'EBITDA (₹)'], ['PAT', 'PAT (₹)'], ['Tangible Net Worth', 'Tangible Net Worth (₹)'], ['Total Debt', 'Total Debt (₹)'], ['Decision', 'Final Recommendation']], y),
    tbl('S01 Snapshot', ['No', 'Particular', 'Details'], 16, y + 94, 760, 790, 'Particular / Details'),
    tbl('S01 Directors', ['Director', 'Designation', 'Ceased'], 786, y + 94, 478, 200, 'Promoters / Directors'),
    tbl('S01 Charges', ['Charge Holder', 'Amount', 'Created', 'Status'], 786, y + 304, 478, 200, 'Charges registered (existing lenders)'),
    ...(has('Fin Trend') ? [V('clusteredColumnChart', 786, y + 514, 478, 370, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'Revenue'), S('Fin Trend', 'EBITDA'), S('Fin Trend', 'PAT')] }, 'Three-year performance (₹)')] : []),
  ]);
  page('2. EXECUTIVE AI CREDIT SUMMARY', 'Consolidated assessment from Financial + GST + Banking + Bureau + Invoice data (rule-based engine)', 1010, (y) => [
    ...cards([['Decision', 'Final Recommendation — GO / CONDITIONAL GO / NO-GO'], ['Funding Eligibility', 'Indicative Funding Eligibility'], ['Overall Risk', 'Overall Credit Risk']], y, 96),
    tbl('S02 Executive', ['No', 'Area', 'Assessment', 'Scale'], 16, y + 106, 820, 420, 'Final Snapshot'),
    V('gauge', 846, y + 106, 418, 260, { Y: [M('Overall Score')], MaxValue: [M('Score Max')] }, 'Overall AI Credit Score (/100)'),
    V('card', 846, y + 376, 418, 150, { Values: [M('Red Flags')] }, 'Red flags raised (sections 31–33)'),
    ...(has('S26 Year-wise') ? [V('clusteredColumnChart', 16, y + 536, 620, 310, { Category: [C('S26 Year-wise', 'FY')], Y: [S('S26 Year-wise', 'Financial Turnover'), S('S26 Year-wise', 'GST Turnover'), S('S26 Year-wise', 'Adjusted Business Inflow')] }, 'Financial vs GST vs Banking (₹)')] : []),
    V('clusteredBarChart', 646, y + 536, 618, 310, { Category: [C('S35 Scorecard', 'Assessment')], Y: [S('S35 Scorecard', 'Score')] }, 'Scorecard by area (/100)'),
  ]);
  page('PART A — 3. THREE-YEAR FINANCIAL PERFORMANCE', 'Audited financial statements · each financial year presented separately · YoY and 3-year trend', 1200, (y) => fin ? [
    tbl('S03 Performance', ['No', 'Financial Parameter', ...fyCols, 'YoY %', 'CAGR', '3-Year Trend'], 16, y, 840, 640, 'Financial Parameter — FY-wise'),
    V('clusteredColumnChart', 866, y, 398, 310, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'Revenue'), S('Fin Trend', 'Total Debt'), S('Fin Trend', 'Net Worth')] }, 'Revenue, debt and net worth (₹)'),
    V('lineChart', 866, y + 320, 398, 320, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'EBITDA Margin'), S('Fin Trend', 'PAT Margin')] }, 'EBITDA margin and PAT margin'),
    tbl('S03 AI Trend', ['No', 'AI Financial Trend'], 16, y + 650, W - 32, 380, 'AI Financial Trend'),
  ] : missing('Audited financial statements', y));
  page('4. CORE FINANCIAL CALCULATIONS & RATIOS', '21 financial parameters for the available financial periods', 1180, (y) => fin ? [
    tbl('S04 Ratios', ['No', 'Parameter', 'Formula / Calculation', ...fyCols, 'Trend'], 16, y, W - 32, 690, '21 parameters'),
    TB(16, y + 696, W - 32, 34, [{ value: 'Note: Promoter Net Worth — the specific formula is not defined in the source; it is captured separately from promoter financial / net-worth information when provided.', size: '9pt' }]),
    V('lineChart', 16, y + 736, 410, 280, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'Current Ratio'), S('Fin Trend', 'Quick Ratio')] }, 'Liquidity (x)'),
    V('lineChart', 436, y + 736, 410, 280, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'Debt Equity'), S('Fin Trend', 'TOL TNW'), S('Fin Trend', 'Debt EBITDA')] }, 'Leverage (x)'),
    V('lineChart', 856, y + 736, 408, 280, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'DSCR'), S('Fin Trend', 'ICR')] }, 'Debt servicing (x)'),
  ] : missing('Audited financial statements', y));
  page('5. WORKING CAPITAL CYCLE', 'Inventory Days + Debtor Days – Creditor Days = Net Working Capital Cycle', 860, (y) => fin ? [
    tbl('S05 Working Capital', ['No', 'Item', ...fyCols], 16, y, 820, 260, 'Working capital analysis'),
    V('clusteredColumnChart', 846, y, 418, 350, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'Inventory Days'), S('Fin Trend', 'Debtor Days'), S('Fin Trend', 'Creditor Days'), S('Fin Trend', 'WC Cycle')] }, 'Days by year'),
    tbl('S05 AI Assessment', ['No', 'Assessment', 'Result', 'Scale'], 16, y + 270, 820, 250, 'AI Assessment'),
    ...cards([['Additional WC', 'Additional WC Requirement (₹)'], ['MPBF', 'MPBF — Tandon II (₹)']], y + 360, 80, 846),
    V('lineChart', 846, y + 450, 418, 250, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'WC Cycle')] }, 'Net working capital cycle (days)'),
  ] : missing('Audited financial statements', y));
  page('PART B — 6–7. GST BUYER & SUPPLIER ANALYSIS', '6. GST sales & purchase analysis — 6.1 Buyer analysis · 7. Supplier analysis', 1240, (y) => gst ? [
    V('slicer', 16, y, 260, 64, { Values: [C('S06 Buyers', 'FY')] }, 'FY (buyers)'),
    ...cards([['Top 5 Buyers %', 'Top 5 Buyer Concentration'], ['Top 10 Buyers %', 'Top 10 Buyer Concentration'], ['Largest Buyer %', 'Largest Buyer Contribution'], ['Largest Buyer', 'Largest Buyer'], ['Buyer Concentration Risk', 'Buyer Concentration Risk']], y, 64, 286),
    tbl('S06 Buyers', ['Buyer', 'Total Sales', '% of Total Sales', 'State', 'Transaction Trend'], 16, y + 74, 820, 380, 'Buyer-wise table'),
    V('clusteredBarChart', 846, y + 74, 418, 300, { Category: [C('S06 Buyers', 'Buyer')], Y: [S('S06 Buyers', 'Total Sales')] }, 'Top buyers (₹)'),
    V('card', 846, y + 384, 418, 70, { Values: [M('Customer Diversification')] }, 'Customer diversification'),
    V('slicer', 16, y + 470, 260, 64, { Values: [C('S07 Suppliers', 'FY')] }, 'FY (suppliers)'),
    ...cards([['Top 5 Suppliers %', 'Top 5 Supplier Concentration'], ['Top 10 Suppliers %', 'Top 10 Supplier Concentration'], ['Largest Supplier %', 'Largest Supplier Contribution'], ['Largest Supplier', 'Largest Supplier'], ['Supplier Concentration Risk', 'Supplier Concentration Risk']], y + 470, 64, 286),
    tbl('S07 Suppliers', ['Supplier', 'Total Purchase', '% of Total Purchase', 'State', 'Transaction Trend'], 16, y + 544, 820, 380, 'Supplier-wise table'),
    V('clusteredBarChart', 846, y + 544, 418, 300, { Category: [C('S07 Suppliers', 'Supplier')], Y: [S('S07 Suppliers', 'Total Purchase')] }, 'Top suppliers (₹)'),
    tbl('S06 Buyer Concentration', ['FY', 'Largest %', 'Top 5 %', 'Top 10 %', 'Parties', 'HHI', 'Risk'], 846, y + 854, 418, 70, 'Concentration by FY'),
  ] : missing('GST data', y));
  page('8–10. SALES-TO-PURCHASE, EXPORTS & GST FILING', '8. Sales-to-purchase ratio · 9. Export analysis · 10. GST filing analysis', 1080, (y) => gst ? [
    V('lineClusteredColumnComboChart', 16, y, 820, 300, { Category: [C('S08 GST Monthly', 'Month')], Y: [S('S08 GST Monthly', 'Sales'), S('S08 GST Monthly', 'Purchases')], Y2: [S('S08 GST Monthly', 'Sales to Purchase')] }, 'Month-wise GST sales vs purchases (₹) and ratio'),
    tbl('S08 Annual', ['FY', 'Total Sales', 'Total Purchases', 'Sales to Purchase Ratio'], 846, y, 418, 190, 'Annual trend'),
    V('card', 846, y + 200, 418, 100, { Values: [M('Unusual Movement')] }, 'AI highlight — unusual movement'),
    tbl('S09 Exports', ['FY', 'Domestic Sales', 'Export Sales', 'Total Turnover', 'Export Ratio', 'Export Growth'], 16, y + 310, 820, 170, 'Export analysis — Export Turnover / Annual Turnover × 100'),
    V('card', 846, y + 310, 418, 80, { Values: [M('Export Dependency')] }, 'Export Dependency'),
    V('clusteredColumnChart', 846, y + 400, 418, 80, { Category: [C('S09 Exports', 'FY')], Y: [S('S09 Exports', 'Export Sales')] }, 'Exports by FY'),
    ...cards([['GST Compliance', 'GST Compliance'], ['Late Returns', 'Number of late filings'], ['Late Filing %', 'Late filing %'], ['Est Late Fee', 'Late fee (₹, where available)'], ['Missing Periods', 'Missing filing periods']], y + 490, 76),
    tbl('S10 Filing by GSTIN', ['GSTIN', 'State', 'Return', 'Returns', 'Late', 'Avg Delay', 'Max Delay', 'Missing Periods'], 16, y + 576, 620, 330, 'Filing consistency by GSTIN'),
    tbl('S10 Filings', ['State', 'Return', 'Period', 'Due Date', 'Filing Date', 'Delay Days'], 646, y + 576, 618, 330, 'Filing date vs due date'),
  ] : missing('GST data', y));
  page('11–13. STATE-WISE, INTRA-GROUP & HSN', '11. State-wise / location-wise revenue · 12. Intra-group transactions · 13. HSN / product-wise analysis', 1010, (y) => [
    ...(gst ? [
      V('slicer', 16, y, 260, 64, { Values: [C('S11 States', 'FY')] }, 'Financial year'),
      V('card', 286, y, 978, 64, { Values: [M('Geographical Concentration')] }, 'Geographical concentration'),
      tbl('S11 States', ['State', 'Sales', '% Revenue', 'Purchases', '% Purchase'], 16, y + 74, 620, 300, 'State-wise revenue and purchases'),
      V('clusteredBarChart', 646, y + 74, 618, 300, { Category: [C('S11 States', 'State')], Y: [S('S11 States', 'Sales'), S('S11 States', 'Purchases')] }, 'State-wise sales vs purchases (₹)'),
    ] : missing('GST data', y)),
    tbl('S12 Group Entities', ['Group Entity', 'Sales', 'Purchases', 'Total Transactions', '% of Business', 'Bank Inflow', 'Bank Outflow'], 16, y + 384, 900, 260, 'Intra-group transactions — GST and banking'),
    ...(gst ? [V('card', 926, y + 384, 338, 125, { Values: [M('Related-Party Dependency')] }, 'Related-Party Dependency')] : []),
    V('clusteredBarChart', 926, y + 519, 338, 125, { Category: [C('S12 Group Entities', 'Group Entity')], Y: [S('S12 Group Entities', 'Bank Inflow'), S('S12 Group Entities', 'Bank Outflow')] }, 'Group money flows (₹)'),
    ...(gst ? [tbl('S13 HSN', ['HSN Code', 'Product', ...gst.fys.map((f) => `Sales ${f}`)], 16, y + 654, W - 32, 180, 'HSN / product-wise analysis')] : []),
  ]);
  page('PART C — 14–17. BANKING TREND, INTERNAL & ADJUSTED INFLOW', '14. Latest 12-month banking trend · 15. Internal transactions · 16. Adjusted business inflow · 17. Inflow / outflow', 1300, (y) => bank ? [
    tbl('S14 Bank Monthly', ['Month', 'Total Inflow', 'Total Outflow', 'Adjusted Inflow', 'Closing Balance'], 16, y, 620, 330, 'Month-wise (all operative accounts)'),
    V('lineClusteredColumnComboChart', 646, y, 618, 250, { Category: [C('S14 Bank Monthly', 'Month')], Y: [S('S14 Bank Monthly', 'Total Inflow'), S('S14 Bank Monthly', 'Total Outflow')], Y2: [S('S14 Bank Monthly', 'Adjusted Inflow')] }, 'Inflow, outflow and adjusted inflow (₹)'),
    V('card', 646, y + 260, 618, 70, { Values: [M('Banking Trend')] }, 'Increasing / Stable / Declining / Volatile Banking Trend'),
    tbl('S15 Internal', ['Type', 'Counterparty', 'Inflow', 'Outflow', 'Entries'], 16, y + 340, 620, 330, '15. Internal transactions (own accounts, group, promoter)'),
    V('waterfallChart', 646, y + 340, 618, 330, { Category: [C('S16 Waterfall', 'Step')], Y: [S('S16 Waterfall', 'Amount')] }, '16. Adjusted Business Inflow (total bar = adjusted inflow)'),
    tbl('S16 Adjusted Inflow', ['No', 'Step', 'Amount', 'What is removed'], 16, y + 680, W - 32, 200, 'Calculation'),
    ...cards([['Total Inflow', 'Total inflow (₹)'], ['Total Outflow', 'Total outflow (₹)'], ['Avg Monthly Inflow', 'Average monthly inflow (₹)'], ['Avg Monthly Outflow', 'Average monthly outflow (₹)']], y + 890, 76),
    ...cards([['Peak Month', 'Peak month'], ['Lowest Month', 'Lowest month'], ['Volatility', 'Volatility (CV)'], ['Net Cash Movement', 'Net cash movement (₹)']], y + 976, 76),
    V('clusteredColumnChart', 16, y + 1062, W - 32, 70, { Category: [C('S14 Bank Monthly', 'Month')], Y: [S('S14 Bank Monthly', 'Closing Balance')] }, 'Closing balance by month (₹)'),
  ] : missing('Banking data', y));
  page('18–21. RETURNS, ECS / NACH, CREDIT ENTRIES & BTO', '18. Cheque return analysis · 19. ECS / NACH / EMI return & penal charges · 20. Number of credit entries · 21. Banking turnover', 1150, (y) => bank ? [
    ...cards([['Inward Returns', 'Inward cheque returns — number'], ['Inward Return Amount', 'Inward — amount (₹)'], ['Outward Returns', 'Outward returns — number'], ['Outward Return Amount', 'Outward — amount (₹)'], ['Cheque Return Risk', 'Risk: Nil / Low / Moderate / High']], y, 80),
    tbl('S18 Returns', ['Type', 'Date', 'Account', 'Narration', 'Amount'], 16, y + 90, W - 32, 230, 'Return, ECS / NACH / EMI and penal entries'),
    ...cards([['ECS NACH EMI Returns', 'ECS / NACH / EMI returns'], ['Penal Entries', 'Penal charge entries'], ['Penal Charges', 'Penal charges (₹)']], y + 330, 76, 16, 836),
    V('card', 846, y + 330, 418, 76, { Values: [M('Repeated Instances')] }, 'Potential stress indicator'),
    ...cards([['Credit Entries', 'Total credit entries'], ['Monthly Avg Credits', 'Monthly average'], ['Avg Credit Amount', 'Average credit amount (₹)'], ['Largest Credit', 'Largest credit (₹)']], y + 416, 76),
    V('clusteredColumnChart', 16, y + 502, 620, 260, { Category: [C('S14 Bank Monthly', 'Month')], Y: [S('S14 Bank Monthly', 'Credit Entries')] }, 'Transaction frequency — credit entries per month'),
    tbl('S20 Largest Credits', ['Date', 'Party', 'Class', 'Amount'], 646, y + 502, 618, 260, 'Largest credits'),
    tbl('S21 BTO', ['No', 'Item', 'Value'], 16, y + 772, 820, 210, '21. Banking turnover — BTO compared with GST and financial turnover'),
    ...cards([['BTO to GST', 'Banking Turnover / GST Sales'], ['BTO to Financial', 'Banking Turnover / Sales (annualised)']], y + 772, 100, 846),
  ] : missing('Banking data', y));
  page('22–25. PARTIES, LOANS, CASH & CC / OD', '22. Party-wise inflow / outflow · 23. Loan disbursement · 24. Cash deposit · 25. CC / OD utilisation', 1450, (y) => bank ? [
    tbl('S22 Inflow Parties', ['Party', 'Amount', '% of Total Inflow', 'Class'], 16, y, 620, 300, 'Top inflow parties'),
    tbl('S22 Outflow Parties', ['Party', 'Amount', '% of Total Outflow', 'Class'], 646, y, 618, 300, 'Top outflow parties'),
    V('clusteredBarChart', 16, y + 310, 620, 230, { Category: [C('S23 Loans', 'Type')], Y: [S('S23 Loans', 'Amount')] }, '23. Loan / borrowing credits by type (not operating receipts)'),
    tbl('S23 Loans', ['Date', 'Type', 'Description', 'Amount'], 646, y + 310, 618, 230, 'Loan disbursement entries'),
    ...cards([['Cash Deposits', 'Total cash deposits (₹)'], ['Cash Deposit Count', 'Number of cash deposits'], ['Cash % of Credits', 'Cash as % of total credits']], y + 550, 74),
    V('clusteredColumnChart', 16, y + 634, 620, 230, { Category: [C('S24 Cash', 'Month')], Y: [S('S24 Cash', 'Cash Deposits')] }, 'Month-wise cash deposits (₹)'),
    tbl('S24 Large Cash', ['Date', 'Narration', 'Amount'], 646, y + 634, 618, 230, 'Unusually large cash credits'),
    tbl('S25 Utilisation', ['Account', 'Sanctioned Limit', 'Average', 'Peak', 'Minimum', 'Days above 90%', 'Overdrawn Days', 'Classification'], 16, y + 874, W - 32, 110, '25. CC / OD utilisation'),
    V('lineChart', 16, y + 994, 820, 270, { Category: [C('S25 CC Daily', 'Date')], Y: [S('S25 CC Daily', 'Drawn'), S('S25 CC Daily', 'Limit')] }, 'Daily drawn balance vs sanctioned limit (₹)'),
    V('card', 846, y + 994, 418, 120, { Values: [M('CC Classification')] }, 'AI Classification'),
    V('card', 846, y + 1124, 418, 140, { Values: [M('Interest Servicing')] }, 'Interest servicing behaviour'),
  ] : missing('Banking data', y));
  page('PART D — 26–28. INTEGRATED RECONCILIATION', '26. Financial vs GST vs Banking · 27. Buyer vs banking · 28. Supplier vs banking', 1720, (y) => [
    tbl('S26 Sources', ['No', 'Source', 'Reported Amount', 'Variance', 'AI Remarks'], 16, y, W - 32, 250, '26. Financial vs GST vs Banking'),
    ...cards([['Reconciliation Status', 'AI Reconciliation Status'], ...(rec.overlap ? [['Overlap Status', 'Banking vs GST on the same months'] as [string, string]] : [])], y + 260, 80),
    tbl('S26 Year-wise', ['FY', 'Financial Turnover', 'GST Turnover', 'Gross Banking Inflow', 'Adjusted Business Inflow', 'GST vs Financial', 'Status', 'AI Remarks'], 16, y + 350, W - 32, 220, 'Year-wise reconciliation'),
    ...(has('S26 Overlap') ? [V('clusteredColumnChart', 16, y + 580, W - 32, 260, { Category: [C('S26 Overlap', 'Month')], Y: [S('S26 Overlap', 'GST Sales incl GST'), S('S26 Overlap', 'Adjusted Business Inflow')] }, 'Same months: GST sales incl. tax vs adjusted bank inflow (₹)')] : []),
    tbl('S27 Buyer vs Bank', ['GST Buyer', 'GST incl Tax', 'Bank Party', 'Bank Amount', 'Variance', 'Status'], 16, y + 850, 820, 320, '27. Buyer vs banking reconciliation'),
    tbl('S27 Credits not in GST', ['Party', 'Amount'], 846, y + 850, 418, 320, 'Large credits from parties not in GST buyers'),
    tbl('S28 Supplier vs Bank', ['GST Supplier', 'GST incl Tax', 'Bank Party', 'Bank Amount', 'Variance', 'Status'], 16, y + 1180, 820, 340, '28. Supplier vs banking reconciliation'),
    tbl('S28 Payments not in GST', ['Party', 'Amount'], 846, y + 1180, 418, 340, 'Large payments to parties not in GST suppliers'),
  ]);
  page('PART E — 29–30. INVOICE AGEING & CIBIL / CMR', '29. Invoice ageing · 30. CIBIL / CMR analysis', 1000, (y) => [
    tbl('S29 Ageing', ['Age', 'Receivable', 'Receivable %', 'Payable', 'Payable %', 'Status'], 16, y, 820, 230, 'Receivable and payable ageing'),
    V('clusteredColumnChart', 846, y, 418, 230, { Category: [C('S29 Ageing', 'Age')], Y: [S('S29 Ageing', 'Receivable'), S('S29 Ageing', 'Payable')] }, 'Ageing buckets (₹)'),
    ...(has('Fin Trend') ? [V('clusteredColumnChart', 846, y + 240, 418, 230, { Category: [C('Fin Trend', 'FY')], Y: [S('Fin Trend', 'Debtor Days'), S('Fin Trend', 'Creditor Days')] }, 'Proxy: debtor vs creditor days')] : []),
    tbl('S30 Bureau', ['No', 'Bureau Item', 'Available Information'], 16, y + 240, 820, 520, '30. CIBIL / CMR analysis'),
    V('card', 846, y + 480, 418, 110, { Values: [M('Bureau Risk')] }, 'Bureau Risk — CLEAN / SATISFACTORY / WATCHLIST / HIGH RISK'),
  ]);
  page('PART F — 31–34. AI RISK ENGINE & SWOT', '31. Financial red flags · 32. GST red flags · 33. Banking red flags · 34. AI SWOT analysis', 1480, (y) => [
    tbl('S31 Financial Flags', ['No', 'Severity', 'Red Flag'], 16, y, 620, 300, '31. Financial Red Flags'),
    tbl('S32 GST Flags', ['No', 'Severity', 'Red Flag'], 646, y, 618, 300, '32. GST Red Flags'),
    tbl('S33 Banking Flags', ['No', 'Severity', 'Red Flag'], 16, y + 310, 820, 300, '33. Banking Red Flags'),
    V('clusteredBarChart', 846, y + 310, 418, 300, { Category: [C('Flag Count', 'Area')], Series: [C('Flag Count', 'Severity')], Y: [S('Flag Count', 'Flags')] }, 'Red flags by area and severity'),
    tbl('S34 Strengths', ['No', 'Point', 'Evidence'], 16, y + 620, 620, 340, 'STRENGTHS'),
    tbl('S34 Weaknesses', ['No', 'Point', 'Evidence', 'Severity'], 646, y + 620, 618, 340, 'WEAKNESSES'),
    tbl('S34 Opportunities', ['No', 'Point', 'Evidence'], 16, y + 970, 620, 340, 'OPPORTUNITIES'),
    tbl('S34 Threats', ['No', 'Point', 'Evidence', 'Severity'], 646, y + 970, 618, 340, 'THREATS'),
  ]);
  page('PART G — 35. INTEGRATED AI CREDIT SCORE', '35. Credit scorecard — scoring weights, benchmarks and cut-offs should be separately defined and approved before production use', 900, (y) => [
    tbl('S35 Scorecard', ['No', 'Assessment', 'Score Text', 'Risk Classification', 'Basis'], 16, y, 720, 500, 'Credit Scorecard'),
    V('gauge', 746, y, 518, 270, { Y: [M('Overall Score')], MaxValue: [M('Score Max')] }, 'OVERALL AI CREDIT SCORE (/100)'),
    ...cards([['Overall Risk', 'Overall Risk'], ['Decision', 'Decision'], ['Items Scored', 'Areas scored']], y + 280, 80, 746),
    V('clusteredBarChart', 16, y + 510, W - 32, 220, { Category: [C('S35 Scorecard', 'Assessment')], Y: [S('S35 Scorecard', 'Score')] }, 'Score by area (/100)'),
    V('card', 746, y + 370, 518, 130, { Values: [M('Reconciliation Status')] }, 'Financial-GST-Banking reconciliation'),
  ]);
  page('PART H — 36–38. FUNDING, PRODUCT MAPPING & RECOMMENDATION', '36. Funding capacity · 37. Product mapping · 38. Final AI credit recommendation', 1640, (y) => [
    tbl('S36 Funding Basis', ['No', 'Based On', 'Value'], 16, y, 620, 420, '36. Funding capacity — based on'),
    ...cards([['Additional Debt Capacity', 'Indicative Additional Debt Capacity (₹)'], ['WC Gap', 'Indicative Working Capital Gap (₹)']], y, 90, 646),
    V('card', 646, y + 100, 618, 80, { Values: [M('Funding Eligibility')] }, 'Indicative funding eligibility'),
    tbl('S36 Method', ['No', 'Calculation'], 646, y + 190, 618, 230, 'How the capacity is calculated'),
    tbl('S37 Products', ['No', 'Product', 'Indicative Suitability'], 16, y + 430, W - 32, 330, '37. Product mapping (final recommendation subject to lender policy and eligibility)'),
    tbl('S38 Recommendation', ['No', 'Item', 'Recommendation'], 16, y + 770, W - 32, 240, '38. Final AI Credit Recommendation'),
    tbl('S38 Key Points', ['No', 'Heading', 'Point'], 16, y + 1020, W - 32, 440, 'Key strengths, risks, mitigants, conditions and documents'),
  ]);
  page('39–40. FINAL CREDIT ANALYST REMARKS & DISCLAIMER', 'Financials → Ratios → WC cycle → GST → Buyers & suppliers → Compliance → Banking → Adjusted inflow → CC → Returns → Ageing → Bureau → Reconciliation → Red flags → Funding', 1240, (y) => [
    tbl('S39 Analyst Note', ['Credit Analyst Note'], 16, y, W - 32, 220, '39. Consolidated Credit Analyst Note'),
    tbl('S39 Questions', ['No', 'Question', 'Answer'], 16, y + 230, W - 32, 760, 'The conclusion answers'),
    TB(16, y + 1000, W - 32, 70, [{ value: '40. REPORT DISCLAIMER / DECLARATION', size: '12pt', bold: true }, { value: 'Shown at the bottom of every page of this report.', size: '9pt' }]),
  ]);

  /* ---------------- serialise ---------------- */
  const legacyReport = {
    config: JSON.stringify({ version: '5.59', themeCollection: { baseTheme: { name: 'CY24SU10', version: '5.59', type: 2 } }, activeSectionIndex: 0, defaultDrillFilterOtherVisuals: true, linguisticSchemaSyncVersion: 0, objects: {} }),
    layoutOptimization: 0,
    resourcePackages: [{ resourcePackage: { disabled: false, items: [{ name: 'CY24SU10', path: 'BaseThemes/CY24SU10.json', type: 202 }], name: 'SharedResources', type: 2 } }],
    sections: pages.map((p, i) => ({ config: '{}', displayName: p.displayName, displayOption: 2, filters: '[]', height: p.height, name: p.name, ordinal: i, visualContainers: p.visuals.map(legacyContainer), width: W })),
  };
  const base = `INGOVIZ_${a.company.replace(/[^\w]+/g, '_').slice(0, 30)}`;
  const j = (o: unknown) => strToU8(JSON.stringify(o, null, 2));
  const R = `${base}/${base}.Report`, L = `${base}/${base} (classic).Report`;
  const files: Record<string, Uint8Array> = {
    [`${base}/${base}.pbip`]: j({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json', version: '1.0', artifacts: [{ report: { path: `${base}.Report` } }], settings: { enableAutoRecovery: true } }),
    [`${R}/definition.pbir`]: j({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json', version: '4.0', datasetReference: { byPath: { path: `../${base}.SemanticModel` } } }),
    [`${R}/definition/version.json`]: j({ $schema: `${SCHEMA}/versionMetadata/1.0.0/schema.json`, version: '2.0.0' }),
    [`${R}/definition/report.json`]: j({ $schema: `${SCHEMA}/report/1.2.0/schema.json`, themeCollection: { baseTheme: { name: 'CY24SU10', reportVersionAtImport: '5.61', type: 'SharedResources' } }, layoutOptimization: 'None', resourcePackages: [{ name: 'SharedResources', type: 'SharedResources', items: [{ name: 'CY24SU10', path: 'BaseThemes/CY24SU10.json', type: 'BaseTheme' }] }], settings: { useStylableVisualContainerHeader: true, defaultDrillFilterOtherVisuals: true, allowChangeFilterTypes: true, useEnhancedTooltips: true, useDefaultAggregateDisplayName: true } }),
    [`${R}/definition/pages/pages.json`]: j({ $schema: `${SCHEMA}/pagesMetadata/1.0.0/schema.json`, pageOrder: pages.map((p) => p.name), activePageName: pages[0].name }),
    [`${R}/StaticResources/SharedResources/BaseThemes/CY24SU10.json`]: j(baseTheme),
    [`${base}/${base} (classic).pbip`]: j({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json', version: '1.0', artifacts: [{ report: { path: `${base} (classic).Report` } }], settings: { enableAutoRecovery: true } }),
    [`${L}/definition.pbir`]: j({ version: '1.0', datasetReference: { byPath: { path: `../${base}.SemanticModel` }, byConnection: null } }),
    [`${L}/report.json`]: j(legacyReport),
    [`${L}/StaticResources/SharedResources/BaseThemes/CY24SU10.json`]: j(baseTheme),
    [`${base}/${base}.SemanticModel/definition.pbism`]: j({ version: '1.0', settings: {} }),
    [`${base}/${base}.SemanticModel/model.bim`]: j(modelBim(tables)),
    [`${base}/README.txt`]: strToU8([
      `INGOVIZ AI — Integrated Financial, GST, Banking & Credit Analysis Report for ${a.company}`, '',
      'How to open:', '1. Extract (unzip) this folder on a Windows PC with Power BI Desktop (right-click → Extract All; do not open from inside the zip).',
      '2. Power BI Desktop → File → Options and settings → Options → Preview features: tick "Power BI Project (.pbip) save option" and "Store reports using enhanced metadata format (PBIR)". Restart.',
      `3. Double-click ${base}.pbip. If the pages are empty in your Power BI version, open "${base} (classic).pbip" instead — same data.`,
      '4. Click Refresh once. The data is stored inside the model (no files, paths or passwords needed).', '',
      `Pages (sections 1–40 in the order of the report format): ${pages.map((p) => p.displayName).join(' | ')}`,
      `Tables: ${tables.map((t) => `${t.name} (${t.rows.length} rows)`).join(', ')}`, '',
      'Every page carries the Section 40 disclaimer at the bottom. Save as .pbix from Power BI Desktop (File → Save as) to share a single file.',
    ].join('\r\n')),
  };
  pages.forEach((p) => {
    files[`${R}/definition/pages/${p.name}/page.json`] = j({ $schema: `${SCHEMA}/page/1.3.0/schema.json`, name: p.name, displayName: p.displayName, displayOption: 'FitToWidth', height: p.height, width: W });
    p.visuals.forEach((v, i) => { files[`${R}/definition/pages/${p.name}/visuals/${v.name}/visual.json`] = j(pbirVisual(v, i)); });
  });
  const zip = zipSync(files, { level: 6 });
  return { blob: new Blob([zip], { type: 'application/zip' }), fileName: `${base}_PowerBI.zip`, tables: tables.length, rows: tables.reduce((s, t) => s + t.rows.length, 0) };
}

