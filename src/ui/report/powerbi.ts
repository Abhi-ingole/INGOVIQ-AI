/* "Open in Power BI": a Power BI Project (.pbip) — semantic model + report — with all reconciled
   data embedded in the model (no file paths, no gateway). Unzip and double-click the .pbip:
   Power BI Desktop opens a ready-made dashboard (Overview, Financials, GST, Banking, Reconciliation,
   Risk & SWOT). Tables are also usable from Excel / any BI tool. */
import { zipSync, strToU8 } from 'fflate';
import type { Analysis } from '../../engine/analyse';
import type { Dataset } from '../../engine/types';
import { fyOfMonth, monthLabel } from '../../engine/utils';
import { buildEvidence } from '../../engine/evidence';

type ColType = 'text' | 'number' | 'date';
interface Tbl { name: string; cols: [string, ColType][]; rows: (string | number | null)[][]; measures?: [string, string, string?][] }

const mStr = (v: string) => `"${v.replace(/"/g, '""').replace(/[\r\n\t]+/g, ' ')}"`;
const mVal = (v: string | number | null, t: ColType) => {
  if (v === null || v === undefined || v === '') return 'null';
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : 'null';
  if (t === 'date') { const m = String(v).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); return m ? `#date(${+m[1]}, ${+m[2]}, ${+(m[3] || 1)})` : 'null'; }
  return mStr(String(v));
};
const mType = (t: ColType) => (t === 'number' ? 'number' : t === 'date' ? 'date' : 'text');
const idName = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `#${mStr(n)}`);

function mExpression(t: Tbl): string[] {
  const type = `type table [${t.cols.map(([c, ty]) => `${idName(c)} = ${mType(ty)}`).join(', ')}]`;
  const rows = t.rows.map((r) => `        {${r.map((v, i) => mVal(v, t.cols[i][1])).join(', ')}}`);
  return ['let', `    Source = #table(${type}, {`, ...rows.map((r, i) => (i < rows.length - 1 ? r + ',' : r)), '    })', 'in', '    Source'];
}

function modelBim(tables: Tbl[], rels: [string, string, string, string][]) {
  return {
    compatibilityLevel: 1550,
    model: {
      culture: 'en-US',
      dataAccessOptions: { legacyRedirects: true, returnErrorValuesAsNull: true },
      defaultPowerBIDataSourceVersion: 'powerBI_V3',
      sourceQueryCulture: 'en-IN',
      tables: tables.map((t) => ({
        name: t.name,
        columns: t.cols.map(([c, ty]) => ({
          name: c, dataType: ty === 'number' ? 'double' : ty === 'date' ? 'dateTime' : 'string', sourceColumn: c,
          summarizeBy: ty === 'number' ? 'sum' : 'none', ...(ty === 'number' ? { formatString: '#,0.00' } : ty === 'date' ? { formatString: 'dd-mmm-yy' } : {}),
        })),
        partitions: [{ name: t.name, mode: 'import', source: { type: 'm', expression: mExpression(t) } }],
        ...(t.measures?.length ? { measures: t.measures.map(([name, expression, fmt]) => ({ name, expression, ...(fmt ? { formatString: fmt } : {}) })) } : {}),
      })),
      relationships: rels.map(([ft, fc, tt, tc], i) => ({ name: `rel${i + 1}`, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc })),
      annotations: [
        { name: 'PBI_QueryOrder', value: JSON.stringify(tables.map((t) => t.name)) },
        { name: '__PBI_TimeIntelligenceEnabled', value: '0' },
      ],
    },
  };
}

/* ---------------- report (PBIR-Legacy report.json) ---------------- */
interface Field { t: string; c: string; agg?: boolean; measure?: boolean }
const F = (t: string, c: string): Field => ({ t, c });
const S = (t: string, c: string): Field => ({ t, c, agg: true });
const Me = (t: string, c: string): Field => ({ t, c, measure: true });
const qref = (f: Field) => (f.agg ? `Sum(${f.t}.${f.c})` : `${f.t}.${f.c}`);

let vid = 0;
function visual(type: string, x: number, y: number, w: number, h: number, proj: Record<string, Field[]>, title: string) {
  const tables = [...new Set(Object.values(proj).flat().map((f) => f.t))];
  const alias = Object.fromEntries(tables.map((t, i) => [t, `t${i}`]));
  const sel = Object.values(proj).flat().filter((f, i, arr) => arr.findIndex((g) => qref(g) === qref(f)) === i).map((f) => {
    const col = { Expression: { SourceRef: { Source: alias[f.t] } }, Property: f.c };
    if (f.measure) return { Measure: col, Name: qref(f) };
    if (f.agg) return { Aggregation: { Expression: { Column: col }, Function: 0 }, Name: qref(f) };
    return { Column: col, Name: qref(f) };
  });
  const name = `v${++vid}${Math.random().toString(36).slice(2, 8)}`;
  const config = {
    name,
    layouts: [{ id: 0, position: { x, y, z: vid, width: w, height: h } }],
    singleVisual: {
      visualType: type,
      projections: Object.fromEntries(Object.entries(proj).map(([role, fs]) => [role, fs.map((f, i) => ({ queryRef: qref(f), ...(i === 0 && role === 'Category' ? { active: true } : {}) }))])),
      prototypeQuery: { Version: 2, From: tables.map((t) => ({ Name: alias[t], Entity: t, Type: 0 })), Select: sel },
      drillFilterOtherVisuals: true,
      vcObjects: { title: [{ properties: { show: { expr: { Literal: { Value: 'true' } } }, text: { expr: { Literal: { Value: `'${title.replace(/'/g, "''")}'` } } } } }] },
    },
  };
  return { legacy: { x, y, z: vid, width: w, height: h, config: JSON.stringify(config), filters: '[]' }, spec: { name, type, x, y, z: vid, w, h, proj, title } };
}
type Vis = ReturnType<typeof visual>;
const section = (name: string, i: number, visuals: Vis[]) => ({ name: `ReportSection${i}`, displayName: name, visuals });

/* PBIR (definition folder) serialisation — the current Power BI Desktop report format */
const SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition';
function pbirField(f: Field) {
  const col = { Expression: { SourceRef: { Entity: f.t } }, Property: f.c };
  return f.measure ? { Measure: col } : f.agg ? { Aggregation: { Expression: { Column: col }, Function: 0 } } : { Column: col };
}
function pbirVisual(v: Vis['spec'], i: number) {
  return {
    $schema: `${SCHEMA}/visualContainer/1.0.0/schema.json`,
    name: v.name,
    position: { x: v.x, y: v.y, z: v.z * 1000, height: v.h, width: v.w, tabOrder: i * 1000 },
    visual: {
      visualType: v.type,
      query: { queryState: Object.fromEntries(Object.entries(v.proj).map(([role, fs]) => [role, { projections: fs.map((f, k) => ({ field: pbirField(f), queryRef: qref(f), nativeQueryRef: f.agg ? `Sum of ${f.c}` : f.c, ...(k === 0 && role === 'Category' ? { active: true } : {}) })) }])) },
      drillFilterOtherVisuals: true,
      visualContainerObjects: { title: [{ properties: { show: { expr: { Literal: { Value: 'true' } } }, text: { expr: { Literal: { Value: `'${v.title.replace(/'/g, "''")}'` } } } } }] },
    },
  };
}
const THEME_NAME = 'CY24SU10';
const THEME = { name: THEME_NAME, dataColors: ['#2A6FDB', '#E8743B', '#19A979', '#945ECF', '#13A4B4', '#D64550', '#6C8893', '#EE9E64'], background: '#FFFFFF', foreground: '#252423', tableAccent: '#2A6FDB', textClasses: { title: { fontFace: 'Segoe UI Semibold', fontSize: 12, color: '#252423' } } };

export function buildPowerBiProject(a: Analysis, ds: Dataset): { blob: Blob; fileName: string; tables: number; rows: number } {
  vid = 0;
  const ev = buildEvidence(ds);
  const fin = a.fin, gst = a.gst, bank = a.bank, rec = a.recon, risk = a.risk;
  const fyset = new Set<string>([...(fin?.fys || []), ...(gst?.fys || []), ...(bank?.months || []).map(fyOfMonth), ...rec.fyRows.map((r) => r.fy)]);
  const tables: Tbl[] = [];
  tables.push({ name: 'FY', cols: [['FY', 'text'], ['FY Start', 'number']], rows: [...fyset].sort().map((f) => [f, +f.slice(3, 7)]) });
  tables.push({
    name: 'Summary', cols: [['Item', 'text'], ['Value', 'text']],
    rows: [['Company', a.company], ['Decision', risk.decision.decision], ['Overall AI credit score', String(risk.overall.score ?? '')], ['Overall risk', risk.overall.risk], ['Recommended product', risk.decision.product], ['Indicative funding', risk.decision.recommendedFunding == null ? '' : String(Math.round(risk.decision.recommendedFunding))], ['Reconciliation status', rec.overallStatus], ...Object.entries(risk.snapshot), ['Generated by', `INGOVIQ AI · ${new Date().toISOString().slice(0, 10)}`]],
    measures: [['Overall Score', String(risk.overall.score ?? 'BLANK()'), '0'], ['Dimensions Scored', String(risk.overall.covered), '0']],
  });
  if (fin) tables.push({
    name: 'Financials', cols: [['Metric', 'text'], ['Group', 'text'], ['FY', 'text'], ['Value', 'number'], ['Unit', 'text'], ['Formula', 'text']],
    rows: [...fin.performance.map((m) => ['Performance', m] as const), ...fin.ratios.map((m) => ['21 Ratios', m] as const), ...fin.extra.map((m) => ['Supplementary', m] as const)]
      .flatMap(([g, m]) => fin.fys.map((f) => [m.name, g, f, m.values[f] ?? null, m.unit, m.formula])),
  });
  if (gst) {
    tables.push({ name: 'GST Monthly', cols: [['Month', 'date'], ['Month Label', 'text'], ['FY', 'text'], ['Sales', 'number'], ['Purchases', 'number']], rows: gst.monthly.map((m) => [m.month, monthLabel(m.month), m.fy, m.revenue, m.purchase]),
      measures: [['Total Sales', "SUM('GST Monthly'[Sales])", '#,0'], ['Total Purchases', "SUM('GST Monthly'[Purchases])", '#,0'], ['Sales to Purchase', "DIVIDE([Total Sales], [Total Purchases])", '0.00']] });
    const parties = (role: 'Buyers' | 'Suppliers') => gst.fys.flatMap((f) => ((role === 'Buyers' ? gst.buyers[f] : gst.suppliers[f]) || []).map((p) => [f, p.name, p.state, p.total, p.share, p.trend] as (string | number | null)[]));
    tables.push({ name: 'Buyers', cols: [['FY', 'text'], ['Party', 'text'], ['State', 'text'], ['Amount', 'number'], ['Share', 'number'], ['Trend', 'text']], rows: parties('Buyers') });
    tables.push({ name: 'Suppliers', cols: [['FY', 'text'], ['Party', 'text'], ['State', 'text'], ['Amount', 'number'], ['Share', 'number'], ['Trend', 'text']], rows: parties('Suppliers') });
    tables.push({ name: 'GST Filing', cols: [['GSTIN', 'text'], ['State', 'text'], ['Return', 'text'], ['FY', 'text'], ['Period', 'date'], ['Due Date', 'date'], ['Filed On', 'date'], ['Delay Days', 'number']], rows: gst.filing.rows.map((r) => [r.gstin, r.state, r.returnType, r.fy, r.period, r.due, r.filed || null, r.delayDays]) });
  }
  if (bank) {
    tables.push({ name: 'Bank Monthly', cols: [['Month', 'date'], ['Month Label', 'text'], ['FY', 'text'], ['Inflow', 'number'], ['Outflow', 'number'], ['Adjusted Inflow', 'number'], ['Closing Balance', 'number'], ['Credits', 'number'], ['Debits', 'number']], rows: bank.monthly.map((m) => [m.month, monthLabel(m.month), fyOfMonth(m.month), m.inflow, m.outflow, m.adjustedInflow, m.closing, m.credits, m.debits]),
      measures: [['Total Inflow', "SUM('Bank Monthly'[Inflow])", '#,0'], ['Total Outflow', "SUM('Bank Monthly'[Outflow])", '#,0'], ['Adjusted Business Inflow', "SUM('Bank Monthly'[Adjusted Inflow])", '#,0']] });
    tables.push({ name: 'Bank Transactions', cols: [['Date', 'date'], ['FY', 'text'], ['Account', 'text'], ['Bank', 'text'], ['Party', 'text'], ['Narration', 'text'], ['Debit', 'number'], ['Credit', 'number'], ['Balance', 'number'], ['Class', 'text'], ['Evidence', 'text']],
      rows: bank.txns.map((t) => [t.date, fyOfMonth(t.month), t.account, t.bank, t.counterparty, t.description, t.debit, t.credit, t.balance, t.cls, t.source || '']), measures: [['Transactions', "COUNTROWS('Bank Transactions')", '0']] });
  }
  tables.push({ name: 'Reconciliation', cols: [['FY', 'text'], ['Financial Turnover', 'number'], ['GST Turnover', 'number'], ['GST Months', 'number'], ['Bank Gross Inflow', 'number'], ['Bank Adjusted Inflow', 'number'], ['Bank Months', 'number'], ['Status', 'text'], ['Remarks', 'text']], rows: rec.fyRows.map((r) => [r.fy, r.financial, r.gst, r.gstMonths, r.bankGross, r.bankAdjusted, r.bankMonths, r.status, r.remarks.join('; ')]) });
  tables.push({ name: 'Scorecard', cols: [['Dimension', 'text'], ['Score', 'number'], ['Weight', 'number'], ['Classification', 'text'], ['Basis', 'text']], rows: risk.scores.map((s) => [s.name, s.score, s.weight, s.classification, s.basis]) });
  tables.push({ name: 'SWOT', cols: [['Type', 'text'], ['Observation', 'text'], ['Detail', 'text'], ['Metric', 'text'], ['Value', 'text'], ['Benchmark', 'text'], ['Severity', 'text'], ['Source', 'text'], ['Section', 'text'], ['Recommendation', 'text']], rows: a.swot.items.map((i) => [i.type, i.title, i.detail, i.metric, i.value, i.benchmark, i.severity, i.source, i.section, i.recommendation]) });
  tables.push({ name: 'Red Flags', cols: [['Area', 'text'], ['Severity', 'text'], ['Flag', 'text']], rows: risk.flags.map((f) => [f.area, f.severity, f.text]) });
  tables.push({ name: 'Evidence', cols: [['ID', 'text'], ['File', 'text'], ['Document Type', 'text'], ['What Was Read', 'text']], rows: ev.items.map((e) => [e.id, e.file, e.type, e.used]) });

  const rels: [string, string, string, string][] = [];
  for (const t of tables) if (t.name !== 'FY' && t.cols.some(([c]) => c === 'FY') && t.rows.length) rels.push([t.name, 'FY', 'FY', 'FY']);

  /* report pages */
  const has = (n: string) => tables.some((t) => t.name === n && t.rows.length);
  const pages: ReturnType<typeof section>[] = [];
  const ov = [visual('card', 20, 20, 290, 120, { Values: [Me('Summary', 'Overall Score')] }, 'Overall AI credit score /100')];
  if (has('GST Monthly')) ov.push(visual('card', 330, 20, 290, 120, { Values: [Me('GST Monthly', 'Total Sales')] }, 'GST sales'));
  if (has('Bank Monthly')) { ov.push(visual('card', 640, 20, 290, 120, { Values: [Me('Bank Monthly', 'Adjusted Business Inflow')] }, 'Adjusted business inflow')); ov.push(visual('card', 950, 20, 310, 120, { Values: [Me('Bank Monthly', 'Total Inflow')] }, 'Gross bank inflow')); }
  ov.push(visual('slicer', 20, 160, 220, 240, { Values: [F('FY', 'FY')] }, 'Financial year'));
  ov.push(visual('tableEx', 20, 420, 600, 280, { Values: [F('Summary', 'Item'), F('Summary', 'Value')] }, 'Credit snapshot'));
  if (has('GST Monthly')) ov.push(visual('clusteredColumnChart', 260, 160, 1000, 240, { Category: [F('GST Monthly', 'Month')], Y: [Me('GST Monthly', 'Total Sales'), Me('GST Monthly', 'Total Purchases')] }, 'GST sales vs purchases (monthly)'));
  ov.push(visual('clusteredBarChart', 640, 420, 620, 280, { Category: [F('Scorecard', 'Dimension')], Y: [S('Scorecard', 'Score')] }, 'Score by dimension'));
  pages.push(section('Overview', 0, ov));
  if (has('Financials')) pages.push(section('Financials', pages.length, [
    visual('slicer', 20, 20, 220, 200, { Values: [F('Financials', 'Group')] }, 'Group'),
    visual('pivotTable', 260, 20, 1000, 680, { Rows: [F('Financials', 'Metric')], Columns: [F('Financials', 'FY')], Values: [S('Financials', 'Value')] }, 'Three-year financials & 21 ratios'),
  ]));
  if (has('GST Monthly')) pages.push(section('GST', pages.length, [
    visual('slicer', 20, 20, 220, 200, { Values: [F('FY', 'FY')] }, 'Financial year'),
    visual('lineChart', 260, 20, 1000, 230, { Category: [F('GST Monthly', 'Month')], Y: [Me('GST Monthly', 'Total Sales'), Me('GST Monthly', 'Total Purchases')] }, 'Monthly GST sales & purchases'),
    visual('clusteredBarChart', 20, 270, 610, 430, { Category: [F('Buyers', 'Party')], Y: [S('Buyers', 'Amount')] }, 'Buyers'),
    visual('clusteredBarChart', 650, 270, 610, 430, { Category: [F('Suppliers', 'Party')], Y: [S('Suppliers', 'Amount')] }, 'Suppliers'),
  ]));
  if (has('Bank Monthly')) pages.push(section('Banking', pages.length, [
    visual('slicer', 20, 20, 220, 200, { Values: [F('Bank Transactions', 'Class')] }, 'Transaction class'),
    visual('clusteredColumnChart', 260, 20, 1000, 260, { Category: [F('Bank Monthly', 'Month')], Y: [S('Bank Monthly', 'Inflow'), S('Bank Monthly', 'Outflow'), S('Bank Monthly', 'Adjusted Inflow')] }, 'Inflow, outflow & adjusted inflow'),
    visual('tableEx', 20, 300, 1240, 400, { Values: [F('Bank Transactions', 'Date'), F('Bank Transactions', 'Account'), F('Bank Transactions', 'Party'), S('Bank Transactions', 'Debit'), S('Bank Transactions', 'Credit'), F('Bank Transactions', 'Class'), F('Bank Transactions', 'Evidence')] }, 'Transactions (with evidence)'),
  ]));
  pages.push(section('Reconciliation', pages.length, [
    visual('clusteredColumnChart', 20, 20, 1240, 320, { Category: [F('Reconciliation', 'FY')], Y: [S('Reconciliation', 'Financial Turnover'), S('Reconciliation', 'GST Turnover'), S('Reconciliation', 'Bank Adjusted Inflow')] }, 'Financial vs GST vs Banking'),
    visual('tableEx', 20, 360, 1240, 340, { Values: [F('Reconciliation', 'FY'), S('Reconciliation', 'Financial Turnover'), S('Reconciliation', 'GST Turnover'), S('Reconciliation', 'Bank Gross Inflow'), S('Reconciliation', 'Bank Adjusted Inflow'), F('Reconciliation', 'Status'), F('Reconciliation', 'Remarks')] }, 'Reconciliation by year'),
  ]));
  pages.push(section('Risk & SWOT', pages.length, [
    visual('slicer', 20, 20, 200, 160, { Values: [F('SWOT', 'Type')] }, 'SWOT'),
    visual('slicer', 20, 200, 200, 140, { Values: [F('SWOT', 'Severity')] }, 'Severity'),
    visual('tableEx', 240, 20, 1020, 420, { Values: [F('SWOT', 'Type'), F('SWOT', 'Observation'), F('SWOT', 'Metric'), F('SWOT', 'Value'), F('SWOT', 'Severity'), F('SWOT', 'Source'), F('SWOT', 'Recommendation')] }, 'Evidence-based SWOT'),
    visual('tableEx', 20, 460, 1240, 240, { Values: [F('Red Flags', 'Area'), F('Red Flags', 'Severity'), F('Red Flags', 'Flag')] }, 'Red flags'),
  ]));
  pages.push(section('Evidence', pages.length, [visual('tableEx', 20, 20, 1240, 680, { Values: [F('Evidence', 'ID'), F('Evidence', 'File'), F('Evidence', 'Document Type'), F('Evidence', 'What Was Read')] }, 'Evidence register')]));

  const legacyReport = {
    config: JSON.stringify({ version: '5.59', themeCollection: { baseTheme: { name: THEME_NAME, version: '5.59', type: 2 } }, activeSectionIndex: 0, defaultDrillFilterOtherVisuals: true, linguisticSchemaSyncVersion: 0, objects: {} }),
    layoutOptimization: 0,
    resourcePackages: [{ resourcePackage: { disabled: false, items: [{ name: THEME_NAME, path: `BaseThemes/${THEME_NAME}.json`, type: 202 }], name: 'SharedResources', type: 2 } }],
    sections: pages.map((p, i) => ({ config: '{}', displayName: p.displayName, displayOption: 1, filters: '[]', height: 720, name: p.name, ordinal: i, visualContainers: p.visuals.map((v) => v.legacy), width: 1280 })),
  };

  const base = `INGOVIQ_${a.company.replace(/[^\w]+/g, '_').slice(0, 30)}`;
  const j = (o: unknown) => strToU8(JSON.stringify(o, null, 2));
  const R = `${base}/${base}.Report`, L = `${base}/${base} (classic).Report`;
  const files: Record<string, Uint8Array> = {
    // main project: PBIR report format (Power BI Desktop 2024+)
    [`${base}/${base}.pbip`]: j({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json', version: '1.0', artifacts: [{ report: { path: `${base}.Report` } }], settings: { enableAutoRecovery: true } }),
    [`${R}/definition.pbir`]: j({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json', version: '4.0', datasetReference: { byPath: { path: `../${base}.SemanticModel` } } }),
    [`${R}/definition/version.json`]: j({ $schema: `${SCHEMA}/versionMetadata/1.0.0/schema.json`, version: '1.0.0' }),
    [`${R}/definition/report.json`]: j({ $schema: `${SCHEMA}/report/1.0.0/schema.json`, themeCollection: { baseTheme: { name: THEME_NAME, reportVersionAtImport: '5.59', type: 'SharedResources' } }, layoutOptimization: 'None', resourcePackages: [{ name: 'SharedResources', type: 'SharedResources', items: [{ name: THEME_NAME, path: `BaseThemes/${THEME_NAME}.json`, type: 'BaseTheme' }] }], settings: { useStylableVisualContainerHeader: true, defaultDrillFilterOtherVisuals: true, allowChangeFilterTypes: true, useEnhancedTooltips: true } }),
    [`${R}/definition/pages/pages.json`]: j({ $schema: `${SCHEMA}/pagesMetadata/1.0.0/schema.json`, pageOrder: pages.map((p) => p.name), activePageName: pages[0].name }),
    [`${R}/StaticResources/SharedResources/BaseThemes/${THEME_NAME}.json`]: j(THEME),
    // fallback project: classic report.json format (older Power BI Desktop)
    [`${base}/${base} (classic).pbip`]: j({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json', version: '1.0', artifacts: [{ report: { path: `${base} (classic).Report` } }], settings: { enableAutoRecovery: true } }),
    [`${L}/definition.pbir`]: j({ version: '1.0', datasetReference: { byPath: { path: `../${base}.SemanticModel` }, byConnection: null } }),
    [`${L}/report.json`]: j(legacyReport),
    [`${L}/StaticResources/SharedResources/BaseThemes/${THEME_NAME}.json`]: j(THEME),
    [`${base}/${base}.SemanticModel/definition.pbism`]: j({ version: '1.0', settings: {} }),
    [`${base}/${base}.SemanticModel/model.bim`]: j(modelBim(tables, rels)),
    [`${base}/README.txt`]: strToU8([
      `INGOVIQ AI — Power BI dashboard for ${a.company}`, '',
      'How to open:', '1. Extract (unzip) this folder anywhere on a Windows PC with Power BI Desktop (right-click → Extract All; do not open from inside the zip).',
      `2. Double-click ${base}.pbip  (or Power BI Desktop → File → Open → ${base}.pbip).`,
      `   If the pages are empty in your Power BI version, close it and open "${base} (classic).pbip" instead — same data, classic report format.`,
      '3. If Power BI asks, click "Refresh" / "Apply changes" once — the data is stored inside the model (no files or passwords needed).',
      '   Older Power BI versions: enable File → Options → Preview features → "Power BI Project (.pbip) save option" and restart.', '',
      `Pages: ${pages.map((p) => p.displayName).join(', ')}`,
      `Tables: ${tables.map((t) => `${t.name} (${t.rows.length} rows)`).join(', ')}`, '',
      'Every bank transaction carries its evidence (statement file and page); see also the Evidence table.',
      'Save as .pbix from Power BI Desktop (File → Save as) to share a single file.',
    ].join('\r\n')),
  };
  for (const p of pages) {
    files[`${R}/definition/pages/${p.name}/page.json`] = j({ $schema: `${SCHEMA}/page/1.0.0/schema.json`, name: p.name, displayName: p.displayName, displayOption: 'FitToPage', height: 720, width: 1280 });
    p.visuals.forEach((v, i) => { files[`${R}/definition/pages/${p.name}/visuals/${v.spec.name}/visual.json`] = j(pbirVisual(v.spec, i)); });
  }
  const zip = zipSync(files, { level: 6 });
  return { blob: new Blob([zip], { type: 'application/zip' }), fileName: `${base}_PowerBI.zip`, tables: tables.length, rows: tables.reduce((s, t) => s + t.rows.length, 0) };
}
