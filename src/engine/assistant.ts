/* INGOVIZ Assistant — answers questions about the loaded report from the analysed data only.
   It runs in the browser without any API key: questions are matched to intents (English, Hindi /
   Marathi in Roman script) and every answer quotes the figures with their evidence. When the data
   does not contain the answer, it says so instead of guessing. */
import type { Analysis } from './analyse';
import type { Dataset, ManualInputs } from './types';
import type { Metric } from './calcFinancial';
import { buildEvidence } from './evidence';
import { fmtCr, fmtINR, fmtPct, fmtX, fmtUnit, fmtDate } from './format';
import { monthLabel, fyOfMonth, nameSimilarity, normFY } from './utils';
import { companySnapshotRows } from './snapshotRows';

export interface Answer { text: string; bullets?: string[]; table?: { head: string[]; rows: string[][] }; sources: string[]; found: boolean }

const SYN: [RegExp, string][] = [
  [/\b(vikri|vikree|bikri|becha|sale|sales|turnover|revenue|income from operations|ulaadhal|ulaadhaal)\b/g, ' sales '],
  [/\b(kharedi|kharidi|khareedi|purchase|purchases|kharid)\b/g, ' purchases '],
  [/\b(nafa|naffa|munafa|profit|pat|net profit)\b/g, ' profit '],
  [/\b(karj|karza|karja|debt|borrowing|borrowings|loan|loans|udhaar|karz)\b/g, ' debt '],
  [/\b(grahak|graahak|customer|customers|buyer|buyers|kharidar|client|clients)\b/g, ' buyers '],
  [/\b(purvathadar|supplier|suppliers|vendor|vendors|vikreta)\b/g, ' suppliers '],
  [/\b(bank|banking|khate|khata|account|statement)\b/g, ' bank '],
  [/\b(kiti|kitna|kitni|kitne|how much|how many|total|ekun|ekoon)\b/g, ' howmuch '],
  [/\b(dhoka|dhokha|risk|risks|red flag|red flags|samasya|problem|problems|issue|issues)\b/g, ' risk '],
  [/\b(kamjori|kamkuvat|weakness|weaknesses)\b/g, ' weakness '],
  [/\b(takat|strength|strengths|majboot)\b/g, ' strength '],
  [/\b(sandhi|opportunity|opportunities|avsar)\b/g, ' opportunity '],
  [/\b(dhoke|threat|threats|khatra)\b/g, ' threat '],
  [/\b(milel|milega|eligib\w*|funding|kiti loan|limit milel|sanction)\b/g, ' funding '],
  [/\b(nirnay|faisla|decision|recommendation|go|no-go|shifaras)\b/g, ' decision '],
  [/\b(gst return|gstr|filing|late|vilamb|ushir|delay|delayed)\b/g, ' filing '],
  [/\b(bounce|return|returns|cheque return|dishonour)\b/g, ' bounce '],
  [/\b(cash|rokh|rokad|nakad)\b/g, ' cash '],
  [/\b(emi|hapta|kist|instalment|installment)\b/g, ' emi '],
  [/\b(score|gun|rating|cibil|cmr|bureau)\b/g, ' score '],
  [/\b(sambandh|reconcil\w*|match|mismatch|julna|jodani|variance|farak|fark)\b/g, ' recon '],
  [/\b(director|directors|sanchalak|promoter|promoters|malak|owner)\b/g, ' director '],
];
const norm = (q: string) => { let s = ` ${q.toLowerCase().replace(/[?,.!:;()"'’]/g, ' ')} `; for (const [re, w] of SYN) s = s.replace(re, w); return s.replace(/\s+/g, ' '); };
const has = (s: string, ...w: string[]) => w.some((x) => s.includes(` ${x} `) || s.includes(x));

const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

const METRIC_WORDS: [RegExp, string][] = [
  [/current ratio/, 'r_cr'], [/quick ratio/, 'r_qr'], [/adjusted debt.?equity/, 'r_ade'], [/debt.?equity|d\/e/, 'r_de'], [/interest coverage|icr/, 'r_icr'],
  [/tol.?tnw|tol\/tnw/, 'r_toltnw'], [/dscr|debt service/, 'r_dscr'], [/debt.?ebitda/, 'r_debitda'], [/debtor (days|collection)|receivable days|collection period/, 'r_dcp'],
  [/creditor (days|payment)|payable days/, 'r_ccp'], [/stock (days|period)|inventory days/, 'r_sp'], [/drawing power/, 'r_dp'], [/working capital ratio/, 'r_wcr'],
  [/ebitda margin/, 'ebitda_margin'], [/pat margin|profit margin|net margin/, 'pat_margin'], [/ebitda/, 'ebitda'], [/\bebit\b/, 'ebit'], [/operating cash|ocf|cash flow/, 'ocf'],
  [/tangible net worth|tnw/, 'tnw'], [/net ?worth/, 'networth'], [/unsecured/, 'unsecured'], [/total debt| debt /, 'total_debt'], [/current assets/, 'total_ca'], [/current liabilities/, 'total_cl'],
  [/inventory|stock/, 'inventories'], [/receivables|debtors/, 'receivables'], [/payables|creditors/, 'payables'], [/roe|return on equity/, 'roe'], [/roce/, 'roce'], [/ profit /, 'pat'], [/ sales /, 'revenue'],
];

export const EXAMPLES = [
  'What is the overall credit score and decision?', 'Top 5 buyers in FY 2025-26', 'GST sales month-wise', 'Sales in May 2026',
  'Current ratio and TOL/TNW', 'Any cheque bounce?', 'GST filing late hai kya?', 'Kiti loan milel?', 'Weaknesses and recommendations',
  'Does banking match GST?', 'CIBIL score', 'Existing loans and EMI', 'Which documents are scanned?', 'Who are the directors?', 'Layakari Enterprises',
];

export function ask(question: string, a: Analysis, ds: Dataset, inp: ManualInputs): Answer {
  const q = norm(question);
  const raw = question.toLowerCase();
  const ev = buildEvidence(ds);
  const fin = a.fin, gst = a.gst, bank = a.bank, rec = a.recon, risk = a.risk;
  const out = (text: string, sources: string[], extra: Partial<Answer> = {}): Answer => ({ text, sources: [...new Set(sources.filter(Boolean))], found: true, ...extra });

  // FY / month mentioned?
  const fyM = question.match(/(?:fy\s*)?(20\d{2})\s*[-–/]\s*(\d{2,4})/i);
  const fy = fyM ? normFY(fyM[0]) : null;
  let month: string | null = null;
  const mm = raw.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s-]*'?(\d{2,4})\b/);
  if (mm) { const y = mm[2].length === 2 ? 2000 + +mm[2] : +mm[2]; month = `${y}-${String(MONTHS[mm[1]] || MONTHS[mm[1].slice(0, 3)]).padStart(2, '0')}`; }
  const nMatch = raw.match(/\btop\s*(\d{1,2})\b/); const topN = nMatch ? Math.min(50, +nMatch[1]) : 10;

  /* help */
  if (/^\s*(hi|hello|hey|namaste|namaskar|help|madat)\b/.test(raw) || has(q, 'what can you')) {
    return out(`I answer from the data loaded for ${a.company} — financials, GST, banking, reconciliation, bureau, ageing, SWOT and the credit decision. Every answer shows where the number comes from. Try:`, [], { bullets: EXAMPLES });
  }

  /* month-specific */
  if (month) {
    const g = gst?.monthly.find((m) => m.month === month), b = bank?.monthly.find((m) => m.month === month);
    if (!g && !b) return { text: `No GST or banking data for ${monthLabel(month)} in the uploaded files.`, sources: [], found: false };
    const bl: string[] = [];
    if (g) bl.push(`GST sales ${fmtINR(g.revenue)} · purchases ${fmtINR(g.purchase)} · sales ÷ purchases ${fmtX(g.ratio)}`);
    if (b) bl.push(`Bank inflow ${fmtINR(b.inflow)} · outflow ${fmtINR(b.outflow)} · adjusted business inflow ${fmtINR(b.adjustedInflow)} · closing balance ${fmtINR(b.closing)} · ${b.credits} credits / ${b.debits} debits`);
    const r3 = ds.extra?.gstr3b.filter((r) => r.period === month) || [];
    for (const r of r3) bl.push(`GSTR-3B ${r.gstin}: taxable ${fmtINR(r.taxable)}, output tax ${fmtINR(r.outputTax)}, filed ${fmtDate(r.filedOn)} (${r.file || ''})`);
    return out(`${monthLabel(month)} (${fyOfMonth(month)}):`, [g ? ev.gstSales : '', b ? ev.bank : ''], { bullets: bl });
  }

  /* party lookup by name */
  const names = new Map<string, string[]>();
  const addName = (n: string, what: string) => { if (n && n.length > 3) names.set(n, [...(names.get(n) || []), what]); };
  for (const f of gst?.fys || []) { for (const b of gst!.buyers[f] || []) addName(b.name, 'buyer'); for (const s of gst!.suppliers[f] || []) addName(s.name, 'supplier'); }
  for (const p of bank?.parties.inflow || []) addName(p.party, 'bank-in');
  for (const p of bank?.parties.outflow || []) addName(p.party, 'bank-out');
  const qWords = raw.replace(/[^a-z0-9 ]/g, ' ').trim();
  if (qWords.split(/\s+/).length >= 1) {
    let best = '', bs = 0;
    for (const n of names.keys()) { const s = nameSimilarity(qWords, n); if (s > bs) { bs = s; best = n; } }
    // short queries: a party whose name contains the typed word(s)
    if (bs < 0.7 && qWords.split(/\s+/).length <= 3 && qWords.replace(/\s/g, '').length >= 4) {
      const hit = [...names.keys()].filter((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(qWords.replace(/[^a-z0-9]/g, ''))).sort((x, y) => x.length - y.length)[0];
      if (hit) { best = hit; bs = 0.75; }
    }
    // only when the question is mostly a name (avoid hijacking normal questions)
    if (bs >= 0.7 && !/(top|sales|purchase|score|ratio|cibil|bounce|filing|loan|emi|swot|risk)/.test(qWords.replace(best.toLowerCase(), ''))) {
      const bl: string[] = [];
      const like = (n: string) => nameSimilarity(n, best) >= 0.8;
      for (const f of gst?.fys || []) {
        const b = (gst!.buyers[f] || []).find((x) => like(x.name)); if (b) bl.push(`${f} GST sales to ${b.name}: ${fmtINR(b.total)} (${fmtPct(b.share)} of sales, ${b.months} months, ${b.trend})`);
        const s = (gst!.suppliers[f] || []).find((x) => like(x.name)); if (s) bl.push(`${f} GST purchases from ${s.name}: ${fmtINR(s.total)} (${fmtPct(s.share)} of purchases)`);
      }
      const bi = bank?.parties.inflow.filter((p) => nameSimilarity(p.party, best) >= 0.75) || [];
      const bo = bank?.parties.outflow.filter((p) => nameSimilarity(p.party, best) >= 0.75) || [];
      if (bi.length) bl.push(`Bank receipts: ${fmtINR(bi.reduce((s, p) => s + p.amount, 0))} in ${bi.reduce((s, p) => s + p.count, 0)} entries (${bi.map((p) => p.party).slice(0, 3).join('; ')})`);
      if (bo.length) bl.push(`Bank payments: ${fmtINR(bo.reduce((s, p) => s + p.amount, 0))} in ${bo.reduce((s, p) => s + p.count, 0)} entries`);
      const m = rec.buyers.rows.find((r) => like(r.gstParty)); if (m) bl.push(`Reconciliation: GST ${fmtINR(m.gstGross)} incl. tax vs bank ${fmtINR(m.bankAmount)} → ${m.status} (${fmtPct(m.variance)})`);
      const ag = ds.extra?.ageing.flatMap((x) => x.parties.filter((p) => like(p.name)).map((p) => `${x.side === 'receivable' ? 'Debtor' : 'Creditor'} ageing: billed ${fmtINR(p.invoiced)}, outstanding ${fmtINR(p.outstanding)}, avg ${p.avgDays != null ? Math.round(p.avgDays) : '—'} days`)) || [];
      bl.push(...ag);
      if (bl.length) return out(`${best}:`, [ev.gstParties, ev.bank, ag.length ? ev.ageing : ''], { bullets: bl });
    }
  }

  /* score / decision / funding */
  if (has(q, 'decision', 'funding') || (has(q, 'score') && !/cibil|cmr|bureau/.test(raw))) {
    const d = risk.decision;
    return out(`Decision: ${d.decision}. Overall AI credit score ${risk.overall.score ?? '—'}/100 (${risk.overall.risk} risk, ${risk.overall.covered} of ${risk.scores.length} dimensions scored).`, ['Scorecard (section 35)'], {
      bullets: [
        `Indicative funding: ${d.recommendedFunding !== null && d.recommendedFunding <= 0 ? 'Nil additional — no headroom at current leverage' : fmtCr(d.recommendedFunding)}`,
        `Product: ${d.product} · tenure ${d.tenure} · repayment capacity ${d.repayment}`,
        ...(fin ? risk.funding.method.slice(0, 4) : [
          'Leverage-based capacity (Debt/EBITDA, TOL/TNW) needs audited financials, which are not available in text form.',
          ...(gst ? (() => { const full = [...gst.fys].reverse().find((f) => gst.monthly.filter((m) => m.fy === f && m.revenue).length >= 12); return full ? [`Indicative only — turnover method on GST sales: 20% of ${full} GST sales ${fmtCr(gst.revenueFY[full])} = ${fmtCr((gst.revenueFY[full] ?? 0) * 0.2)} working-capital limit (to be validated with audited financials).`] : []; })() : []),
        ]),
        ...d.conditions.slice(0, 3).map((c) => `Condition: ${c}`),
      ],
      table: { head: ['Dimension', 'Score', 'Classification'], rows: risk.scores.map((s) => [s.name, s.score === null ? 'n/a' : String(s.score), s.classification]) },
    });
  }

  /* SWOT */
  const swType = has(q, 'weakness') ? 'Weakness' : has(q, 'strength') ? 'Strength' : has(q, 'opportunity') ? 'Opportunity' : has(q, 'threat') ? 'Threat' : /swot/.test(raw) ? 'all' : null;
  if (swType) {
    const items = a.swot.items.filter((i) => swType === 'all' || i.type === swType);
    const plural: Record<string, string> = { Strength: 'Strengths', Weakness: 'Weaknesses', Opportunity: 'Opportunities', Threat: 'Threats' };
    return out(swType === 'all' ? `SWOT for ${a.company}: ${a.swot.counts.Strength} strengths, ${a.swot.counts.Weakness} weaknesses, ${a.swot.counts.Opportunity} opportunities, ${a.swot.counts.Threat} threats.` : `${plural[swType]} (${items.length}):`, ['SWOT page'], {
      bullets: items.slice(0, 12).map((i) => `${swType === 'all' ? `[${i.type}] ` : ''}${i.title}${i.type === 'Weakness' || i.type === 'Threat' ? ` (${i.severity})` : ''} — ${i.metric} ${i.value} vs ${i.benchmark}; source ${i.source}${i.recommendation ? `. 💡 ${i.recommendation}` : ''}`),
    });
  }
  if (has(q, 'risk')) {
    return out(`${risk.flags.length} red flag(s); ${a.swot.highRisks} high-severity risk(s) in the SWOT.`, ['Risk engine (sections 31–33)'], { bullets: risk.flags.map((f) => `[${f.severity}] ${f.area}: ${f.text}`) });
  }

  /* buyers / suppliers */
  if (has(q, 'buyers', 'suppliers') && gst) {
    const isB = has(q, 'buyers');
    const f = fy && gst.fys.includes(fy) ? fy : gst.fys[gst.fys.length - 1];
    const rows = (isB ? gst.buyers[f] : gst.suppliers[f]) || [];
    const c = (isB ? gst.concentration.buyers : gst.concentration.suppliers).find((x) => x.fy === f);
    return out(`Top ${Math.min(topN, rows.length)} ${isB ? 'buyers' : 'suppliers'} in ${f} — top 5 = ${fmtPct(c?.top5)}, top 10 = ${fmtPct(c?.top10)}, concentration risk ${c?.risk || '—'}.`, [ev.gstParties], {
      table: { head: ['#', isB ? 'Buyer' : 'Supplier', 'Amount', 'Share', 'Trend'], rows: rows.slice(0, topN).map((r, i) => [String(i + 1), r.name, fmtINR(r.total), fmtPct(r.share), r.trend]) },
    });
  }

  /* financial metric */
  const metricKey = METRIC_WORDS.find(([re]) => re.test(q))?.[1];
  if (metricKey && !fin && !['revenue', 'pat', 'total_debt', 'receivables', 'payables', 'inventories'].includes(metricKey)) {
    return { text: `That ratio is calculated from the audited Profit & Loss and Balance Sheet, which are not available for ${a.company} in text form (scanned or not uploaded). Add the years in Data view → Financial line items (or upload the financial input template) and I will answer it.`, sources: [ev.fin], found: false };
  }
  if (metricKey && fin && !(metricKey === 'revenue' && !fin)) {
    const all: Metric[] = [...fin.performance, ...fin.ratios, ...fin.extra];
    const keys = METRIC_WORDS.filter(([re]) => re.test(q)).map(([, k]) => k).filter((k, i, arr) => arr.indexOf(k) === i).slice(0, 4);
    const ms = keys.map((k) => all.find((m) => m.key === k || m.key === `r_${k}`)).filter((m): m is Metric => !!m);
    if (ms.length && !(metricKey === 'revenue' && has(q, 'month'))) {
      const fys = fy && fin.fys.includes(fy) ? [fy] : fin.fys;
      return out(ms.map((m) => `${m.name}: ${fys.map((f) => `${f} ${fmtUnit(m.values[f], m.unit)}`).join(' · ')}${m.trend ? ` — ${m.trend}` : ''}`).join('\n'), [ev.fin], { bullets: ms.map((m) => `Formula: ${m.formula}${m.benchmark ? ` · benchmark ${m.benchmark}` : ''}`) });
    }
  }

  /* sales / purchases (GST) */
  if (has(q, 'sales', 'purchases') && gst) {
    if (/month|mahina|mahine|monthly/.test(raw)) {
      return out(`Month-wise GST sales and purchases (${gst.months.length} months):`, [ev.gstSales, ev.gstParties], { table: { head: ['Month', 'Sales', 'Purchases', 'Sales ÷ Purchases'], rows: gst.monthly.map((m) => [monthLabel(m.month), fmtINR(m.revenue), fmtINR(m.purchase), fmtX(m.ratio)]) } });
    }
    const rows = gst.salesPurchaseFY.filter((r) => !fy || r.fy === fy);
    return out(`GST-reported ${has(q, 'purchases') && !has(q, 'sales') ? 'purchases' : 'sales'}${fy ? ` for ${fy}` : ''}:`, [ev.gstSales, ev.gstParties], {
      table: { head: ['FY', 'Months', 'Sales', 'Purchases', 'YoY sales'], rows: rows.map((r) => { const mo = gst.monthly.filter((m) => m.fy === r.fy && m.revenue).length; return [r.fy, String(mo), fmtINR(r.sales), fmtINR(r.purchase), mo >= 12 ? fmtPct(gst.revenueYoY[r.fy]) : 'partial year']; }) },
      bullets: fin ? [`Audited turnover: ${fin.fys.map((f) => `${f} ${fmtCr(fin.performance.find((m) => m.key === 'revenue')?.values[f])}`).join(' · ')}`] : ['Audited financial turnover not available (statements scanned / not provided).'],
    });
  }

  /* GST filing */
  if (has(q, 'filing') && gst) {
    const s = gst.filing.summary;
    return out(`GST compliance: ${gst.filing.compliance}. ${s.lateReturns} of ${s.totalReturns} returns late (max ${s.maxDelay} days, est. late fee ${fmtINR(s.estLateFee)}); ${s.missingPeriods} missing period(s).`, [ev.ref(/gstr-3b/i, ev.gst)], {
      table: { head: ['GSTIN', 'State', 'Filed', 'Late', 'Max delay', 'Missing'], rows: gst.filing.byGstin.map((g) => [g.gstin, g.state, String(g.total), String(g.late), `${g.maxDelay}d`, g.missing.map(monthLabel).join(', ') || 'None']) },
    });
  }

  /* banking */
  if (has(q, 'bounce') && bank) {
    const r = bank.returns;
    return out(`Cheque / payment returns — risk ${r.risk}.`, [ev.bank], {
      bullets: [`Inward (own cheques / payments returned): ${r.inward.count} · ${fmtINR(r.inward.amount)}`, `Outward (customer cheques returned): ${r.outward.count} · ${fmtINR(r.outward.amount)}`, `ECS / NACH / EMI returns: ${r.ecsNachEmi.count}`, `Penal charges: ${r.penal.count} · ${fmtINR(r.penal.amount)}`,
        ...[...r.inward.items, ...r.outward.items].slice(0, 8).map((t) => `${fmtDate(t.date)} ${t.description.slice(0, 60)} ${fmtINR(t.debit || t.credit)} — ${t.source || ''}`)],
    });
  }
  if (has(q, 'cash') && bank) return out(`Cash deposits: ${fmtINR(bank.cash.total)} in ${bank.cash.count} entries = ${fmtPct(bank.cash.pctOfCredits)} of credits.`, [ev.bank], { bullets: Object.entries(bank.cash.monthly).filter(([, v]) => v).map(([m, v]) => `${monthLabel(m)}: ${fmtINR(v)}`) });
  if (has(q, 'emi') || (has(q, 'debt') && !fin)) {
    const loans = ds.extra?.loans || [];
    if (loans.length || bank?.emi.length) return out(`Existing loans: ${loans.length} facilities, outstanding ${fmtCr(loans.reduce((s, l) => s + (l.outstanding || 0), 0))}, EMI ${fmtINR(loans.reduce((s, l) => s + (l.emi || 0), 0))} per month.`, [ev.loans, ev.bank], {
      table: loans.length ? { head: ['Lender', 'Facility', 'Sanctioned', 'Outstanding', 'EMI'], rows: loans.map((l) => [l.lender, l.facility, fmtINR(l.sanction), fmtINR(l.outstanding), fmtINR(l.emi)]) } : undefined,
      bullets: bank?.emi.length ? [`EMI debits seen in bank: ${bank.emi.length}, total ${fmtINR(bank.emi.reduce((s, e) => s + e.amount, 0))}`] : undefined,
    });
  }
  if (has(q, 'recon')) {
    const o = rec.overlap;
    return out(`Reconciliation status: ${rec.overallStatus}.`, [ev.fin, ev.gstSales, ev.bank], {
      bullets: [...(o ? [`${o.label}: GST incl. tax ${fmtINR(o.gstGross)} vs adjusted bank inflow ${fmtINR(o.bankAdjusted)} → variance ${fmtPct(o.variance)} (${o.status}). ${o.lagNote}`] : []),
        ...rec.fyRows.map((r) => `${r.fy}: financial ${fmtINR(r.financial)}, GST ${fmtINR(r.gst)} (${r.gstMonths} m), bank adjusted ${fmtINR(r.bankAdjusted)} (${r.bankMonths} m) — ${r.status}`),
        `Buyers matched to bank receipts: ${fmtPct(rec.buyers.matchedShare)} of GST sales.`],
    });
  }
  if (has(q, 'bank') && bank) {
    const t = bank.totals, ad = bank.adjusted;
    return out(`Banking ${monthLabel(bank.months[0])} – ${monthLabel(bank.months[bank.months.length - 1])} (${bank.months.length} months, ${new Set(bank.txns.map((x) => x.account)).size} accounts): conduct ${bank.conduct}, trend ${t.trend}.`, [ev.bank], {
      bullets: [`Gross inflow ${fmtINR(ad.gross)} → adjusted business inflow ${fmtINR(ad.adjusted)} (less internal ${fmtINR(ad.internal)}, loans ${fmtINR(ad.loans)}, promoter ${fmtINR(ad.promoter)}, returns ${fmtINR(ad.returns)})`,
        `Average monthly inflow ${fmtINR(t.avgInflow)}, outflow ${fmtINR(t.avgOutflow)}; peak ${monthLabel(t.peakMonth)}, lowest ${monthLabel(t.lowMonth)}`,
        `Top inflow parties: ${bank.parties.inflow.slice(0, 5).map((p) => `${p.party} ${fmtCr(p.amount)}`).join('; ')}`,
        ...bank.utilisation.map((u) => `${u.account}: CC/OD average utilisation ${fmtPct(u.avgUtil)} (${u.classification})`)],
    });
  }

  /* bureau */
  if (has(q, 'score') || /cibil|cmr|bureau/.test(raw)) {
    const c = ds.extra?.cibil || [];
    return out(`CIBIL (lowest promoter) ${inp.cibilScore ?? 'not provided'} · CMR ${inp.cmrRank ? `CMR-${inp.cmrRank}` : 'not provided'} · bureau conduct ${risk.snapshot['CIBIL/CMR Conduct'] || '—'}.`, [ev.bureau], {
      bullets: c.map((x) => (x.kind === 'commercial' ? `${x.name}: CMR-${x.cmr ?? '?'}, ${x.facilities ?? '?'} facilities, outstanding ${fmtINR(x.outstanding)}, overdue ${fmtINR(x.overdue)}` : `${x.name}: score ${x.score ?? '?'}, ${x.accounts ?? '?'} accounts, current balance ${fmtINR(x.current)}, overdue ${fmtINR(x.overdue)}${x.delinquencyFlag ? ' — delinquency in history' : ''}`)),
    });
  }

  /* ageing */
  if (/ageing|aging|debtor|creditor|outstanding|receivable|payable|thakbaki|baki/.test(raw)) {
    const tot = (k: 'receivable' | 'payable') => inp.ageing.reduce((s, b) => s + (b[k] || 0), 0);
    return out(`Receivables ${fmtINR(tot('receivable'))} · payables ${fmtINR(tot('payable'))}.`, [ev.ageing], { table: { head: ['Age', 'Receivables', 'Payables'], rows: inp.ageing.map((b) => [b.bucket, fmtINR(b.receivable), fmtINR(b.payable)]) } });
  }

  /* documents */
  if (/document|file|scan|password|missing|kagad|kagadpatra/.test(raw)) {
    const d = ds.docs || [];
    const by = (s: string) => d.filter((x) => x.status === s);
    return out(`${d.length} files: ${by('used').length} used, ${by('scanned').length} scanned (no text), ${by('needs password').length} need a password, ${by('duplicate').length} duplicates, ${by('not used').length} listed only.`, ['Loan File page'], {
      bullets: [...by('scanned').map((x) => `Scanned: ${x.path.split('/').pop()}`), ...by('needs password').map((x) => `Password needed: ${x.path.split('/').pop()}`)].slice(0, 20),
      table: risk.decision.documents.length ? { head: ['Still required'], rows: risk.decision.documents.map((x) => [x]) } : undefined,
    });
  }

  /* company profile */
  if (has(q, 'director') || /cin|pan|gstin|address|incorporat|vintage|msme|udyam|company|lei|constitution|industry/.test(raw)) {
    const rows = companySnapshotRows(a, ds, inp);
    const pick = rows.filter(([k]) => { const kk = k.toLowerCase(); return raw.split(/\s+/).some((w) => w.length > 2 && kk.includes(w.replace(/s$/, ''))) || (has(q, 'director') && /director|promoter/i.test(k)); });
    return out(`${a.company}:`, [ev.profile], { table: { head: ['Particular', 'Details'], rows: (pick.length ? pick : rows.slice(0, 14)).map(([k, v]) => [k, v]) } });
  }

  /* the 18 analyst questions */
  let bestQ = -1, bestS = 0;
  const words = new Set(q.split(' ').filter((w) => w.length > 3));
  risk.qa.forEach((x, i) => { const s = norm(x.q).split(' ').filter((w) => words.has(w)).length; if (s > bestS) { bestS = s; bestQ = i; } });
  if (bestQ >= 0 && bestS >= 2) return out(risk.qa[bestQ].a, ['Final credit analyst remarks (section 39)'], { bullets: [`Q: ${risk.qa[bestQ].q}`] });

  /* last resort: search every snapshot row and SWOT detail */
  const facts: [string, string][] = [...companySnapshotRows(a, ds, inp), ...Object.entries(risk.snapshot), ...a.swot.items.map((i) => [i.title, `${i.detail} (${i.source})`] as [string, string])];
  const scored = facts.map(([k, v]) => [k, v, norm(`${k} ${v}`).split(' ').filter((w) => w.length > 3 && words.has(w)).length] as const).filter((x) => x[2] > 0).sort((p, q2) => q2[2] - p[2]).slice(0, 5);
  if (scored.length) return out('Closest matches in the report:', [], { bullets: scored.map(([k, v]) => `${k}: ${v}`) });
  return { text: 'I could not find that in the uploaded data. Try asking about sales, purchases, buyers, suppliers, banking, bounces, GST filing, ratios, CIBIL, loans, ageing, SWOT, documents or the credit decision.', sources: [], found: false, bullets: EXAMPLES.slice(0, 6) };
}
