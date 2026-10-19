import type { ManualInputs, FinancialData, GstData } from './types';
import type { FinAnalysis, Metric } from './calcFinancial';
import type { GstAnalysis } from './calcGst';
import type { BankAnalysis } from './calcBanking';
import type { ReconAnalysis } from './reconcile';
import { fmtINR, fmtPct, fmtX, fmtCr } from './format';

export interface Score { key: string; name: string; score: number | null; weight: number; classification: string; basis: string }
export interface Flag { area: 'Financial' | 'GST' | 'Banking' | 'Bureau' | 'Reconciliation'; severity: 'High' | 'Medium' | 'Low'; text: string }
export interface RiskAnalysis {
  snapshot: Record<string, string>;
  scores: Score[];
  overall: { score: number | null; risk: string; covered: number };
  flags: Flag[];
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  funding: { debtEbitda: number | null; tolTnw: number | null; dscr: number | null; additionalDebt: number | null; wcGap: number | null; method: string[] };
  products: { name: string; why: string }[];
  decision: { decision: string; recommendedFunding: number | null; product: string; tenure: string; repayment: string; security: string; collateral: string; strengths: string[]; risks: string[]; mitigants: string[]; conditions: string[]; documents: string[] };
  qa: { q: string; a: string }[];
  analystNote: string;
  trendComments: string[];
}

const band = (v: number | null | undefined, cuts: number[], scores: number[], higherBetter = true): number | null => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  for (let i = 0; i < cuts.length; i++) if (higherBetter ? v >= cuts[i] : v <= cuts[i]) return scores[i];
  return scores[scores.length - 1];
};
const cls = (s: number | null) => (s === null ? 'Not available' : s >= 75 ? 'Low risk' : s >= 60 ? 'Moderate' : s >= 45 ? 'High' : 'Very high');
const last = (m: Metric | undefined, fys: string[]) => (m && fys.length ? m.values[fys[fys.length - 1]] ?? null : null);
const prev = (m: Metric | undefined, fys: string[]) => (m && fys.length > 1 ? m.values[fys[fys.length - 2]] ?? null : null);

export function assessRisk(fd: FinancialData | null, fin: FinAnalysis | null, _gd: GstData | null, gst: GstAnalysis | null, bank: BankAnalysis | null, rec: ReconAnalysis, inp: ManualInputs): RiskAnalysis {
  const fys = fin?.fys || [];
  const R = (k: string) => fin?.ratios.find((r) => r.key === k) || fin?.performance.find((r) => r.key === k) || fin?.extra.find((r) => r.key === k);
  const rev = R('revenue'), pat = R('pat'), ebitda = R('ebitda');
  const revYoY = rev && fys.length > 1 ? rev.yoy[fys[fys.length - 1]] ?? null : null;
  const patMargin = last(R('pat_margin'), fys), ebitdaMargin = last(R('ebitda_margin'), fys), prevEbitdaMargin = prev(R('ebitda_margin'), fys);
  const cr = last(R('r_cr'), fys), icr = last(R('r_icr'), fys), toltnw = last(R('r_toltnw'), fys), debtEbitda = last(R('r_debitda'), fys), dscr = last(R('r_dscr'), fys);
  const ocf = last(R('ocf'), fys), nw = last(R('networth'), fys), prevNw = prev(R('networth'), fys);
  const debt = last(R('total_debt'), fys), prevDebt = prev(R('total_debt'), fys);
  const wcLast = fin?.wc[fin.wc.length - 1];
  const principalKnown = fys.some((f) => (inp.principalRepayment?.[f] ?? 0) > 0);

  // ---------- scorecard
  const buyer = gst?.concentration.buyers[gst.concentration.buyers.length - 1];
  const supp = gst?.concentration.suppliers[gst.concentration.suppliers.length - 1];
  const ageTotal = inp.ageing.reduce((a, b) => a + b.receivable, 0);
  const ageOld = inp.ageing.filter((a) => /91|180/.test(a.bucket)).reduce((a, b) => a + b.receivable, 0);
  const s = (key: string, name: string, score: number | null, basis: string, weight = 1): Score => ({ key, name, score, weight, classification: cls(score), basis });
  const bp = band(revYoY, [0.2, 0.1, 0], [85, 75, 60, 35]);
  const scores: Score[] = [
    s('business', 'Business Performance', bp === null ? null : Math.max(0, bp - ((last(pat, fys) ?? 0) <= 0 ? 15 : 0)), `Revenue YoY ${fmtPct(revYoY)}; PAT ${fmtINR(last(pat, fys))}`),
    s('growth', 'Revenue Growth', band(rev?.cagr, [0.25, 0.1, 0], [90, 75, 60, 30]), `Revenue CAGR ${fmtPct(rev?.cagr ?? null)} over ${fys.length} years`),
    s('profit', 'Profitability', band(patMargin, [0.08, 0.05, 0.02, 0], [90, 80, 65, 45, 20]), `PAT margin ${fmtPct(patMargin)}, EBITDA margin ${fmtPct(ebitdaMargin)}`),
    s('leverage', 'Leverage', band(toltnw, [2, 3, 4, 6], [90, 75, 60, 40, 20], false), `TOL/TNW ${fmtX(toltnw)}, Debt/EBITDA ${fmtX(debtEbitda)}`),
    s('liquidity', 'Liquidity', band(cr, [1.5, 1.33, 1.1, 1], [90, 75, 60, 45, 25]), `Current ratio ${fmtX(cr)}`),
    s('debtservice', 'Debt Servicing', principalKnown ? band(dscr, [2, 1.5, 1.25, 1], [90, 75, 60, 40, 20]) : band(icr, [3, 2, 1.5, 1], [90, 75, 55, 40, 20]), principalKnown ? `DSCR ${fmtX(dscr)}` : `Interest coverage ${fmtX(icr)} (DSCR needs principal repayment input)`),
    s('wc', 'Working Capital', band(wcLast?.cycle ?? null, [60, 90, 120, 180], [85, 70, 55, 40, 25], false), `Net operating cycle ${wcLast?.cycle != null ? Math.round(wcLast.cycle) + ' days' : 'N/A'}`),
    s('gst', 'GST Conduct', gst ? ({ Regular: 90, 'Minor Delays': 70, Irregular: 45, 'High Concern': 25 } as Record<string, number>)[gst.filing.compliance] ?? null : null, gst ? `${gst.filing.summary.lateReturns}/${gst.filing.summary.totalReturns} returns late, max delay ${gst.filing.summary.maxDelay} days` : 'GST data not provided'),
    s('conc', 'Buyer/Supplier Concentration', buyer || supp ? Math.round(((band(buyer?.top5 ?? null, [0.4, 0.6, 0.8], [85, 65, 45, 30], false) ?? 60) + (band(supp?.top5 ?? null, [0.4, 0.6, 0.8], [85, 65, 45, 30], false) ?? 60)) / 2) : null, `Top-5 buyers ${fmtPct(buyer?.top5 ?? null)}, top-5 suppliers ${fmtPct(supp?.top5 ?? null)} (${buyer?.fy || ''})`),
    s('banking', 'Banking Conduct', bank ? Math.max(0, (({ Nil: 90, Low: 75, Moderate: 55, High: 30 } as Record<string, number>)[bank.returns.risk] ?? 60) - (bank.utilisation.some((u) => u.classification === 'Critical') ? 20 : bank.utilisation.some((u) => u.classification === 'Stretched') ? 10 : 0)) : null, bank ? `Cheque/EMI returns: ${bank.returns.risk}; CC/OD: ${bank.utilisation.map((u) => u.classification).join(', ') || 'no OD account'}` : 'Banking data not provided'),
    s('bureau', 'CIBIL/CMR', inp.cibilScore || inp.cmrRank ? Math.round(((band(inp.cibilScore, [750, 700, 650], [90, 75, 55, 30]) ?? band(inp.cmrRank, [3, 5, 7], [90, 75, 50, 25], false) ?? 60) + (band(inp.cmrRank, [3, 5, 7], [90, 75, 50, 25], false) ?? band(inp.cibilScore, [750, 700, 650], [90, 75, 55, 30]) ?? 60)) / 2) - (inp.dpdObserved ? 25 : 0) : null, inp.cibilScore || inp.cmrRank ? `CIBIL ${inp.cibilScore ?? '—'}, CMR ${inp.cmrRank ?? '—'}${inp.dpdObserved ? ', DPD observed' : ''}` : 'Bureau report not provided — enter in Settings'),
    s('ageing', 'Invoice Ageing', ageTotal ? band(ageOld / ageTotal, [0.1, 0.25, 0.4], [85, 65, 45, 25], false) : null, ageTotal ? `${fmtPct(ageOld / ageTotal)} of receivables older than 90 days` : 'Ageing data not provided — enter in Settings'),
    s('recon', 'Financial-GST-Banking Reconciliation', ({ MATCHED: 90, 'ACCEPTABLE VARIANCE': 75, 'MATERIAL VARIANCE': 50, 'INVESTIGATION REQUIRED': 25 } as Record<string, number>)[rec.overallStatus] ?? null, `Status: ${rec.overallStatus}`),
  ];
  const avail = scores.filter((x) => x.score !== null);
  const wsum = avail.reduce((a, x) => a + x.weight, 0);
  const overallScore = wsum ? Math.round(avail.reduce((a, x) => a + (x.score as number) * x.weight, 0) / wsum) : null;
  const overallRisk = overallScore === null ? 'N/A' : overallScore >= 75 ? 'LOW' : overallScore >= 60 ? 'MODERATE' : overallScore >= 45 ? 'HIGH' : 'VERY HIGH';

  // ---------- red flags
  const flags: Flag[] = [];
  const F = (area: Flag['area'], severity: Flag['severity'], text: string) => flags.push({ area, severity, text });
  if (fin && rev) {
    fys.slice(1).forEach((fy) => { const y = rev.yoy[fy]; if (y !== null && y !== undefined && y < 0) F('Financial', 'High', `Turnover declined ${fmtPct(-y)} in ${fy}`); });
    if (ebitda && prev(ebitda, fys) !== null && (last(ebitda, fys) ?? 0) < (prev(ebitda, fys) ?? 0)) F('Financial', 'Medium', 'EBITDA declined in the latest year');
    if ((last(ebitda, fys) ?? 0) < 0 || fys.some((f) => (ebitda?.values[f] ?? 0) < 0)) F('Financial', 'Medium', `Negative EBITDA in ${fys.filter((f) => (ebitda?.values[f] ?? 0) < 0).join(', ')}`);
    if (pat && prev(pat, fys) !== null && (last(pat, fys) ?? 0) < (prev(pat, fys) ?? 0)) F('Financial', 'Medium', 'PAT fell in the latest year');
    if (prevEbitdaMargin !== null && ebitdaMargin !== null && ebitdaMargin < prevEbitdaMargin - 0.01) F('Financial', 'Low', `EBITDA margin contracted from ${fmtPct(prevEbitdaMargin)} to ${fmtPct(ebitdaMargin)}`);
    if (ocf !== null && ocf < 0) F('Financial', 'High', `Negative operating cash flow (${fmtINR(ocf)}) in the latest year`);
    if (debt !== null && prevDebt !== null && debt > prevDebt * 1.5 && debt > 0) F('Financial', 'Medium', `Debt increased from ${fmtINR(prevDebt)} to ${fmtINR(debt)}`);
    if (toltnw !== null && toltnw > 4) F('Financial', toltnw > 6 ? 'High' : 'Medium', `High TOL/TNW of ${fmtX(toltnw)} (benchmark ≤ 4x)`);
    if (debtEbitda !== null && debtEbitda > 3.5) F('Financial', 'Medium', `High Debt/EBITDA of ${fmtX(debtEbitda)} (benchmark ≤ 3.5x)`);
    if (principalKnown && dscr !== null && dscr < 1.25) F('Financial', 'High', `Weak DSCR of ${fmtX(dscr)} (benchmark ≥ 1.25x)`);
    if (icr !== null && icr < 2) F('Financial', icr < 1.5 ? 'High' : 'Medium', `Weak interest coverage of ${fmtX(icr)} (benchmark ≥ 2x)`);
    if (nw !== null && prevNw !== null && nw < prevNw) F('Financial', 'High', 'Net-worth erosion in the latest year');
    if (nw !== null && nw <= 0) F('Financial', 'High', 'Negative net worth');
    if (wcLast?.debtorDays && wcLast.debtorDays > 120) F('Financial', 'Medium', `Stretched debtor cycle of ${Math.round(wcLast.debtorDays)} days`);
    const inv = R('inventories');
    if (inv && (prev(inv, fys) ?? 0) === 0 && (last(inv, fys) ?? 0) > 0) F('Financial', 'Low', 'Inventory built up from nil — verify stock statement');
    else if (wcLast?.inventoryDays && wcLast.inventoryDays > 120) F('Financial', 'Medium', `Excess inventory — ${Math.round(wcLast.inventoryDays)} days`);
    if (cr !== null && cr < 1.33) F('Financial', cr < 1 ? 'High' : 'Low', `Current ratio ${fmtX(cr)} is below the 1.33x benchmark`);
  }
  if (gst) {
    const fl = gst.fys;
    const partial = (fy: string) => gst.monthly.filter((m) => m.fy === fy && m.revenue > 0).length < 12;
    fl.slice(1).forEach((fy) => { const y = gst.revenueYoY[fy]; if (y !== null && y !== undefined && y < 0 && !partial(fy)) F('GST', 'High', `GST sales declined ${fmtPct(-y)} in ${fy}`); });
    if (gst.filing.summary.lateReturns) F('GST', gst.filing.compliance === 'Regular' ? 'Low' : gst.filing.compliance === 'Minor Delays' ? 'Medium' : 'High', `${gst.filing.summary.lateReturns} of ${gst.filing.summary.totalReturns} returns filed late (max ${gst.filing.summary.maxDelay} days, est. late fee ${fmtINR(gst.filing.summary.estLateFee)})`);
    if (gst.filing.summary.missingPeriods) F('GST', 'Medium', `${gst.filing.summary.missingPeriods} return period(s) missing in filing history`);
    if (buyer?.top5 && buyer.top5 > 0.75) F('GST', 'Medium', `High buyer concentration — top 5 buyers = ${fmtPct(buyer.top5)} of ${buyer.fy} sales`);
    if (supp?.top5 && supp.top5 > 0.75) F('GST', 'Medium', `High supplier concentration — top 5 suppliers = ${fmtPct(supp.top5)} of ${supp.fy} purchases`);
    if (gst.relatedPartyDependency !== 'Low') F('GST', 'Medium', `Intra-group sales dependency: ${gst.relatedPartyDependency}`);
    if (gst.unusualMonths.length) F('GST', 'Low', `Unusual sales/purchase movement in ${gst.unusualMonths.length} month(s) (e.g. ${gst.unusualMonths.slice(0, 2).map((u) => `${u.month}: ${u.note}`).join('; ')})`);
    const geo = gst.geoConcentration[gst.geoConcentration.length - 1];
    if (geo && geo.share > 0.6) F('GST', 'Low', `Geographical concentration — ${geo.topState} = ${fmtPct(geo.share)} of sales`);
    if (!gst.hsn.length) F('GST', 'Low', 'HSN-wise product data not provided — product concentration not assessed');
    const g13 = gst.gstr1vs3b.filter((x) => Math.abs(x.diff) > Math.max(1, x.gstr1 * 0.05));
    if (g13.length) F('GST', 'Medium', `GSTR-1 vs GSTR-3B mismatch in ${g13.length} month(s)`);
  }
  if (bank) {
    if (bank.returns.outward.count) F('Banking', 'Medium', `${bank.returns.outward.count} outward cheque return(s) — ${fmtINR(bank.returns.outward.amount)}`);
    if (bank.returns.inward.count) F('Banking', bank.returns.risk === 'High' ? 'High' : 'Medium', `${bank.returns.inward.count} inward cheque/payment return(s) (company's own payments) — ${fmtINR(bank.returns.inward.amount)}`);
    if (bank.returns.ecsNachEmi.count) F('Banking', 'High', `${bank.returns.ecsNachEmi.count} ECS/NACH/EMI return(s)`);
    if (bank.returns.penal.count) F('Banking', 'Low', `${bank.returns.penal.count} penal charge instance(s) — ${fmtINR(bank.returns.penal.amount)}`);
    const intShare = bank.adjusted.gross ? (bank.adjusted.internal + bank.adjusted.group) / bank.adjusted.gross : 0;
    if (intShare > 0.15) F('Banking', 'Medium', `High internal/group transfers — ${fmtPct(intShare)} of gross credits`);
    if ((bank.cash.pctOfCredits ?? 0) > 0.1) F('Banking', 'Medium', `Heavy cash deposits — ${fmtPct(bank.cash.pctOfCredits)} of credits`);
    for (const u of bank.utilisation) {
      if (u.classification === 'Critical' || u.classification === 'Stretched') F('Banking', u.classification === 'Critical' ? 'High' : 'Medium', `${u.account}: CC/OD ${u.classification.toLowerCase()} — average ${fmtPct(u.avgUtil)}, peak ${fmtPct(u.peakUtil)}, ${u.daysAbove90} days above 90%`);
      if (u.overdrawnDays) F('Banking', 'High', `${u.account}: overdrawn beyond limit on ${u.overdrawnDays} day(s)`);
    }
    if (bank.totals.trend === 'Declining') F('Banking', 'Medium', 'Falling adjusted business inflow in recent months');
    if (bank.adjusted.promoter > 0) F('Banking', 'Low', `Promoter/director credits of ${fmtINR(bank.adjusted.promoter)} excluded from business inflow`);
  }
  if (rec.overlap && (rec.overlap.status === 'MATERIAL VARIANCE' || rec.overlap.status === 'INVESTIGATION REQUIRED')) F('Reconciliation', rec.overlap.status === 'INVESTIGATION REQUIRED' ? 'High' : 'Medium', `Adjusted banking inflow differs ${fmtPct(rec.overlap.variance)} from GST sales (${rec.overlap.label})`);
  for (const r of rec.fyRows) if (r.varGst !== null && Math.abs(r.varGst) > 0.15 && r.gstMonths >= 12) F('Reconciliation', Math.abs(r.varGst) > 0.3 ? 'High' : 'Medium', `${r.fy}: GST turnover ${fmtPct(r.varGst)} vs audited turnover`);
  if (rec.coverageNote) F('Reconciliation', 'Medium', rec.coverageNote);
  if (inp.dpdObserved) F('Bureau', 'High', 'DPD observed in credit bureau report');
  for (const f of fd?.flags || []) if (f.colour === 'Red') F('Financial', 'High', `Company report flag: ${f.event}`);
  const sevOrder = { High: 0, Medium: 1, Low: 2 };
  flags.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  // ---------- executive snapshot
  const snap: Record<string, string> = {
    'Business Performance': cls(scores[0].score) === 'Low risk' ? 'Strong' : (scores[0].score ?? 0) >= 55 ? 'Satisfactory' : 'Weak',
    'Financial Performance': (scores[2].score ?? 0) >= 75 ? 'Strong' : (scores[2].score ?? 0) >= 55 ? 'Satisfactory' : 'Weak',
    Liquidity: cr === null ? 'N/A' : cr >= 1.33 ? 'Comfortable' : cr >= 1 ? 'Moderate' : 'Stressed',
    Leverage: toltnw === null ? 'N/A' : toltnw <= 3 ? 'Low' : toltnw <= 5 ? 'Moderate' : 'High',
    'Debt Servicing': (scores[5].score ?? 0) >= 75 ? 'Comfortable' : (scores[5].score ?? 0) >= 50 ? 'Moderate' : 'Weak',
    'Working Capital': fin ? (fin.wcAssessment.cycle === 'Deteriorating' || fin.wcAssessment.receivables === 'Critical' ? 'Stressed' : fin.wcAssessment.receivables === 'Stretched' ? 'Stretched' : 'Comfortable') : 'N/A',
    'GST Conduct': gst ? (gst.filing.compliance === 'Regular' ? 'Regular' : gst.filing.compliance === 'Minor Delays' ? 'Moderate Concern' : 'Irregular') : 'N/A',
    'Banking Conduct': bank ? (bank.conduct === 'Good' ? 'Good' : bank.conduct === 'Satisfactory' ? 'Satisfactory' : bank.conduct) : 'N/A',
    'CIBIL/CMR Conduct': scores[10].score === null ? 'Not provided' : scores[10].score >= 75 ? 'Clean' : scores[10].score >= 55 ? 'Satisfactory' : scores[10].score >= 40 ? 'Concern' : 'High Risk',
    'Overall Credit Risk': overallRisk === 'LOW' ? 'Low' : overallRisk === 'MODERATE' ? 'Moderate' : overallRisk === 'HIGH' ? 'High' : overallRisk === 'VERY HIGH' ? 'Very High' : 'N/A',
  };

  // ---------- funding capacity
  const ebitdaL = last(ebitda, fys) ?? 0;
  const tnw = last(R('tnw'), fys) ?? 0;
  const tol = last(R('tol'), fys) ?? 0;
  const interest = fin?.base.interest[fys[fys.length - 1]] ?? 0;
  const cashAccrual = (last(pat, fys) ?? 0) + (fin?.base.depreciation[fys[fys.length - 1]] ?? 0) + interest;
  const princ = inp.principalRepayment?.[fys[fys.length - 1]] ?? 0;
  const dE = fin ? 3 * ebitdaL - (debt ?? 0) : null;
  const tT = fin ? 4 * tnw - tol : null;
  const dS = fin ? (cashAccrual / 1.25 - interest - princ) / 0.31 : null;
  const capCands = [dE, tT, dS].filter((x): x is number => x !== null);
  const additionalDebt = capCands.length ? Math.max(0, Math.min(...capCands)) : null;
  const funding = {
    debtEbitda: dE, tolTnw: tT, dscr: dS, additionalDebt, wcGap: fin?.wcAssessment.additionalWC ?? null,
    method: [
      `Debt/EBITDA method: 3.0 × EBITDA (${fmtINR(ebitdaL)}) − existing debt (${fmtINR(debt)}) = ${fmtINR(dE)}`,
      `TOL/TNW method: 4.0 × TNW (${fmtINR(tnw)}) − TOL (${fmtINR(tol)}) = ${fmtINR(tT)}`,
      `DSCR method: (cash accruals ${fmtINR(cashAccrual)} ÷ 1.25 − interest − principal) ÷ 0.31 (11% interest + 5-yr repayment per ₹1) = ${fmtINR(dS)}`,
      `Indicative additional debt = lowest of the three, floored at nil = ${fmtINR(additionalDebt)}`,
      `Working-capital gap (MPBF method II vs 20% turnover method, less existing bank borrowing) = ${fmtINR(fin?.wcAssessment.additionalWC ?? null)}`,
    ],
  };

  // ---------- product mapping
  const products: { name: string; why: string }[] = [];
  const recvDays = wcLast?.debtorDays ?? 0;
  if ((fin?.wcAssessment.additionalWC ?? 0) > 0) products.push({ name: 'CC / OD or WCDL', why: `Working-capital gap of ${fmtINR(fin!.wcAssessment.additionalWC)}` });
  if (recvDays > 60) products.push({ name: 'Sales Invoice Discounting / Factoring', why: `Receivables of ${Math.round(recvDays)} days can be monetised against invoices` });
  if (recvDays > 60 && (buyer?.top5 ?? 0) > 0.5) products.push({ name: 'TReDS', why: 'Concentrated corporate buyers — TReDS platform discounting' });
  if ((supp?.top5 ?? 0) > 0.5) products.push({ name: 'Purchase Finance / Reverse Factoring', why: 'Purchases concentrated with a few suppliers' });
  if ((gst?.exports[gst.exports.length - 1]?.ratio ?? 0) > 0.03) products.push({ name: 'Export Finance (PCFC / EPC)', why: `Exports at ${fmtPct(gst!.exports[gst!.exports.length - 1].ratio)} of turnover` });
  if (fd?.items.forex_expenditure && Object.values(fd.items.forex_expenditure).some((v) => (v ?? 0) > 0)) products.push({ name: 'Import Finance / LC', why: 'Foreign-currency expenditure observed' });
  if (cr !== null && cr < 1.33) products.push({ name: 'WCDTL / Structured Debt', why: 'Liquidity below benchmark — term structure eases pressure on current ratio' });
  if (!products.length) products.push({ name: 'Term Loan', why: 'Default product subject to end-use' });

  // ---------- decision
  const highFlags = flags.filter((f) => f.severity === 'High').length;
  let decision = 'N/A';
  if (overallScore !== null) decision = overallScore >= 70 && highFlags <= 1 ? 'GO' : overallScore >= 50 && !(nw !== null && nw <= 0) ? 'CONDITIONAL GO' : 'NO-GO';
  const strengths: string[] = [], weaknesses: string[] = [], opportunities: string[] = [], threats: string[] = [];
  if ((rev?.cagr ?? 0) > 0.2) strengths.push(`Rapid turnover growth — ${fmtCr(rev!.values[fys[0]])} → ${fmtCr(last(rev, fys))}; latest YoY ${fmtPct(revYoY)}`);
  if ((last(pat, fys) ?? 0) > 0 && fys.every((f) => (pat?.values[f] ?? 0) > 0)) strengths.push('Profitable in every year analysed');
  if (nw !== null && prevNw !== null && nw > prevNw) strengths.push(`Net worth up from ${fmtINR(prevNw)} to ${fmtINR(nw)} through retained profits`);
  if (gst && gst.exports[gst.exports.length - 1]?.export) strengths.push('Export sales have started — diversifies revenue');
  if (bank && bank.returns.outward.count === 0) strengths.push('No outward cheque returns (customer cheques clear)');
  if (bank && bank.returns.ecsNachEmi.count === 0 && bank.emi.length) strengths.push('No EMI / NACH returns — loan instalments serviced on time');
  if (gst && gst.relatedPartyDependency === 'Low') strengths.push('No material intra-group sales');
  if (patMargin !== null && patMargin < 0.02) weaknesses.push(`Thin PAT margin of ${fmtPct(patMargin)}`);
  if (ebitdaMargin !== null && ebitdaMargin < 0.05) weaknesses.push(`Low EBITDA margin of ${fmtPct(ebitdaMargin)} — trading-type business`);
  if (icr !== null && icr < 2) weaknesses.push(`Interest coverage of ${fmtX(icr)} is below 2x`);
  if (toltnw !== null && toltnw > 4) weaknesses.push(`High TOL/TNW of ${fmtX(toltnw)} — thin equity base relative to liabilities`);
  if (cr !== null && cr < 1.33) weaknesses.push(`Current ratio ${fmtX(cr)} below the 1.33x benchmark`);
  if (gst && gst.filing.summary.lateReturns) weaknesses.push(`GST returns filed late (${gst.filing.summary.lateReturns} instances)`);
  if (bank && bank.returns.inward.count) weaknesses.push(`${bank.returns.inward.count} returns of the company's own cheques/payments`);
  if ((buyer?.top5 ?? 0) > 0.6) weaknesses.push(`Buyer concentration — top 5 = ${fmtPct(buyer!.top5)}`);
  opportunities.push('Scaling turnover with structured working-capital lines (CC/OD, invoice discounting)');
  if (recvDays > 90) opportunities.push('Unlocking cash tied in receivables through factoring / TReDS');
  if (gst && (gst.exports[gst.exports.length - 1]?.export ?? 0) > 0) opportunities.push('Export finance to support the new export business');
  if (fd?.charges.length) opportunities.push('Existing banking relationships (open charges) can be leveraged for enhancement');
  if (bank && bank.utilisation.some((u) => (u.avgUtil ?? 0) > 0.85)) threats.push('Bank limits fully drawn — little headroom for shocks');
  if ((buyer?.top5 ?? 0) > 0.6) threats.push('Loss of a key buyer would hit revenue sharply');
  if ((supp?.top5 ?? 0) > 0.6) threats.push('Supplier dependency — disruption risk on purchases');
  if (icr !== null && icr < 2) threats.push('Rising interest rates would further compress coverage');
  if (rec.overallStatus === 'MATERIAL VARIANCE' || rec.overallStatus === 'INVESTIGATION REQUIRED') threats.push('Unexplained differences between books, GST and banking');
  threats.push('Steel price volatility and working-capital intensity (sector risk)'.replace('Steel', fd?.profile['Corpository Sector']?.match(/steel|iron/i) ? 'Steel' : 'Commodity'));

  const recommendedFunding = additionalDebt !== null ? Math.min(additionalDebt + (fin?.wcAssessment.additionalWC ?? 0), inp.fundingRequirement ?? Infinity) : null;
  const mitigants: string[] = [];
  if (recvDays > 90) mitigants.push('Funding against receivables with escrow of buyer collections');
  if (bank?.utilisation.some((u) => (u.avgUtil ?? 0) > 0.85)) mitigants.push('Monthly stock & book-debt statements with drawing-power monitoring');
  mitigants.push('Personal guarantee of promoter-directors');
  if (gst?.filing.summary.lateReturns) mitigants.push('Covenant for timely GST filing; review GSTR-3B every quarter');
  const conditions = [
    'Latest provisional financials and FY-wise cash-flow statement',
    'Sanction letters and repayment schedules of existing facilities',
    principalKnown ? 'Confirmation of repayment track' : 'Principal repayment schedule (needed for DSCR)',
  ];
  if (additionalDebt !== null && additionalDebt <= 0) conditions.unshift(`No additional debt headroom at current leverage (TOL/TNW ${fmtX(toltnw)}) — equity / quasi-equity infusion or reduction of outside liabilities before fresh exposure; consider only substitution / restructuring of existing limits`);
  if (rec.coverageNote) conditions.push('GST returns / data for GSTINs not covered in the GST analysis');
  const documents: string[] = [];
  if (inp.cibilScore === null || inp.cmrRank === null) documents.push('CIBIL / CMR report of company and promoters');
  if (!inp.ageing.some((a) => a.receivable || a.payable)) documents.push('Debtor and creditor ageing as on latest date');
  if (!bank || bank.months.length < 12) documents.push('Last 12 months bank statements of all operative accounts');
  if (!fin) documents.push('Audited financial statements for the last 3 years (text PDFs or the INGOVIQ financial input template)');
  if (!gst?.hsn.length) documents.push('HSN-wise sales summary (GSTR-1 Table 12)');
  if (!inp.promoterNetWorth) documents.push('Promoter net-worth statement');

  const decisionObj = {
    decision,
    recommendedFunding: recommendedFunding !== null && Number.isFinite(recommendedFunding) ? recommendedFunding : null,
    product: products[0]?.name || '—',
    tenure: products[0]?.name.match(/term/i) ? '3–5 years' : '12 months (renewable)',
    repayment: (scores[5].score ?? 0) >= 75 ? 'Comfortable' : (scores[5].score ?? 0) >= 50 ? 'Moderate' : 'Weak',
    security: 'Hypothecation of current assets (stock & book debts)',
    collateral: overallRisk === 'LOW' ? 'Not required beyond primary security' : overallRisk === 'MODERATE' ? '25–50% collateral or FLDG, subject to lender policy' : '≥ 50% collateral / FLDG, subject to lender policy',
    strengths: strengths.slice(0, 3), risks: [...weaknesses, ...threats].slice(0, 3), mitigants: mitigants.slice(0, 3), conditions: conditions.slice(0, 3), documents: documents.slice(0, 3),
  };

  // ---------- trend comments (AI Financial Trend)
  const trendComments: string[] = [];
  if (fin && rev) {
    trendComments.push(`Revenue ${rev.trend.toLowerCase()} — ${fys.map((f) => `${f}: ${fmtCr(rev.values[f])}`).join(', ')}; CAGR ${fmtPct(rev.cagr)}.`);
    if (ebitda) trendComments.push(`EBITDA moved ${fys.map((f) => fmtCr(ebitda.values[f])).join(' → ')}; margin ${fys.map((f) => fmtPct(R('ebitda_margin')?.values[f] ?? null)).join(' → ')} (${(ebitdaMargin ?? 0) >= (prevEbitdaMargin ?? 0) ? 'expansion' : 'contraction'} in the latest year).`);
    if (pat) trendComments.push(`PAT ${fys.map((f) => fmtCr(pat.values[f])).join(' → ')} — ${pat.trend.toLowerCase()}.`);
    trendComments.push(`Operating cash flow ${fys.map((f) => fmtCr(R('ocf')?.values[f] ?? null)).join(' → ')}${(ocf ?? 0) < 0 ? ' — growth is consuming cash (working capital build-up)' : ''}.`);
    trendComments.push(`Net worth ${fys.map((f) => fmtCr(R('networth')?.values[f] ?? null)).join(' → ')}; total debt ${fys.map((f) => fmtCr(R('total_debt')?.values[f] ?? null)).join(' → ')}.`);
    trendComments.push(`Liquidity: current ratio ${fys.map((f) => fmtX(R('r_cr')?.values[f] ?? null)).join(' → ')}; working-capital cycle ${fin.wc.map((w) => (w.cycle === null ? '—' : Math.round(w.cycle) + 'd')).join(' → ')} (${fin.wcAssessment.cycle.toLowerCase()}).`);
    const sustain = (rev.cagr ?? 0) > 0.3 && (ocf ?? 0) < 0 ? 'Growth is fast but funded by creditors and bank borrowing rather than internal cash — sustainability depends on collections.' : (rev.cagr ?? 0) > 0 && (patMargin ?? 0) > 0.03 ? 'Growth is supported by profitability.' : 'Growth sustainability needs monitoring.';
    trendComments.push(sustain);
  }

  // ---------- 18 questions
  const yes = (b: boolean) => (b ? 'Yes' : 'No');
  const qa = [
    { q: "Is the company's turnover growing or declining?", a: rev ? `${rev.trend}. ${fys.map((f) => `${f} ${fmtCr(rev.values[f])}`).join(', ')}.` : 'Financials not provided.' },
    { q: 'Is the growth supported by profitability?', a: patMargin === null ? 'N/A' : `${yes((last(pat, fys) ?? 0) > 0 && (patMargin ?? 0) >= 0.02)} — PAT margin ${fmtPct(patMargin)}, EBITDA margin ${fmtPct(ebitdaMargin)}.` },
    { q: 'Is operating cash flow adequate?', a: ocf === null ? 'Not derivable.' : `${yes(ocf > 0 && ocf >= interest)} — OCF ${fmtINR(ocf)} vs interest ${fmtINR(interest)}.` },
    { q: 'Is existing leverage sustainable?', a: toltnw === null ? 'N/A' : `${yes(toltnw <= 4 && (debtEbitda ?? 0) <= 3.5)} — TOL/TNW ${fmtX(toltnw)}, Debt/EBITDA ${fmtX(debtEbitda)}.` },
    { q: 'Can the company comfortably service existing and proposed debt?', a: `${principalKnown ? `DSCR ${fmtX(dscr)}` : `Interest coverage ${fmtX(icr)}`} — repayment capacity ${decisionObj.repayment.toLowerCase()}.` },
    { q: 'Is the working-capital requirement justified?', a: fin ? `Cycle ${wcLast?.cycle != null ? Math.round(wcLast.cycle) + ' days' : 'N/A'} (${fin.wcAssessment.cycle}); indicative additional WC ${fmtINR(fin.wcAssessment.additionalWC)}.` : 'N/A' },
    { q: 'Do GST sales support the reported financial turnover?', a: rec.fyRows.filter((r) => r.varGst !== null).map((r) => `${r.fy}: GST ${fmtPct(r.varGst)} vs books (${r.status})`).join('; ') + (rec.coverageNote ? ` ${rec.coverageNote}` : '') || 'No overlapping year.' },
    { q: 'Does adjusted banking turnover support GST/financial turnover?', a: rec.overlap ? `${rec.overlap.label}: adjusted bank inflow ${fmtINR(rec.overlap.bankAdjusted)} vs GST incl. tax ${fmtINR(rec.overlap.gstGross)} → ${fmtPct(rec.overlap.variance)} (${rec.overlap.status}).` : 'No overlapping months between GST and banking data.' },
    { q: 'Are buyer and supplier concentrations acceptable?', a: buyer ? `Top-5 buyers ${fmtPct(buyer.top5)} (${buyer.risk} risk), top-5 suppliers ${fmtPct(supp?.top5 ?? null)} (${supp?.risk} risk) in ${buyer.fy}.` : 'N/A' },
    { q: 'Is banking conduct satisfactory?', a: bank ? `${bank.conduct}. Trend ${bank.totals.trend.toLowerCase()}, returns risk ${bank.returns.risk}.` : 'N/A' },
    { q: 'Are there cheque/ECS/EMI return concerns?', a: bank ? `Inward returns ${bank.returns.inward.count} (${fmtINR(bank.returns.inward.amount)}), outward ${bank.returns.outward.count}, ECS/NACH/EMI ${bank.returns.ecsNachEmi.count}.` : 'N/A' },
    { q: 'Is CC/OD utilisation comfortable or stressed?', a: bank?.utilisation.length ? bank.utilisation.map((u) => `${u.account}: ${u.classification} (avg ${fmtPct(u.avgUtil)}, peak ${fmtPct(u.peakUtil)}; limit ${fmtINR(u.limit)} — ${u.limitSource || 'not known'})`).join('; ') : 'No CC/OD account in the statement.' },
    { q: 'Is CIBIL/CMR conduct satisfactory?', a: snap['CIBIL/CMR Conduct'] === 'Not provided' ? 'Bureau report not provided.' : snap['CIBIL/CMR Conduct'] },
    { q: 'Are there material discrepancies or red flags?', a: `${flags.filter((f) => f.severity === 'High').length} high, ${flags.filter((f) => f.severity === 'Medium').length} medium, ${flags.filter((f) => f.severity === 'Low').length} low flags. Reconciliation: ${rec.overallStatus}.` },
    { q: "What is the company's indicative additional funding capacity?", a: `${fmtCr(additionalDebt)} additional debt; working-capital gap ${fmtCr(fin?.wcAssessment.additionalWC ?? null)}.` },
    { q: 'Which financial product is most appropriate?', a: products.map((p) => p.name).slice(0, 3).join(', ') },
    { q: 'What conditions/mitigants should be imposed?', a: [...mitigants, ...conditions].slice(0, 4).join('; ') },
    { q: 'Should the proposal be classified as GO, CONDITIONAL GO or NO-GO?', a: `${decision} (overall score ${overallScore ?? '—'}/100, ${overallRisk} risk).` },
  ];

  const analystNote = [
    fin ? `Over ${fys[0]}–${fys[fys.length - 1]}, ${fd?.company || 'the company'} grew revenue from ${fmtCr(rev?.values[fys[0]] ?? null)} to ${fmtCr(last(rev, fys))} with PAT of ${fmtCr(last(pat, fys))} (margin ${fmtPct(patMargin)}).` : '',
    fin ? `Liquidity is ${snap.Liquidity.toLowerCase()} (current ratio ${fmtX(cr)}), leverage ${snap.Leverage.toLowerCase()} (TOL/TNW ${fmtX(toltnw)}) and interest cover ${fmtX(icr)}. The working-capital cycle is ${wcLast?.cycle != null ? Math.round(wcLast.cycle) + ' days' : 'not available'} and ${fin.wcAssessment.cycle.toLowerCase()}.` : '',
    gst ? `GST data shows ${gst.fys.map((f) => `${f} ${fmtCr(gst.revenueFY[f])}`).join(', ')}; filing is ${gst.filing.compliance.toLowerCase()} and top-5 buyers make up ${fmtPct(buyer?.top5 ?? null)} of sales.` : '',
    bank ? `Banking over ${bank.months.length} months shows gross credits of ${fmtCr(bank.adjusted.gross)} and adjusted business inflow of ${fmtCr(bank.adjusted.adjusted)} after removing returns, loans, internal and promoter credits; conduct is ${bank.conduct.toLowerCase()}.` : '',
    `Reconciliation status: ${rec.overallStatus}.${rec.coverageNote ? ' ' + rec.coverageNote : ''}`,
    `Indicative additional debt capacity is ${fmtCr(additionalDebt)} with a working-capital gap of ${fmtCr(fin?.wcAssessment.additionalWC ?? null)}. Overall score ${overallScore ?? '—'}/100 (${overallRisk}); recommendation: ${decision}.`,
  ].filter(Boolean).join(' ');

  return { snapshot: snap, scores, overall: { score: overallScore, risk: overallRisk, covered: avail.length }, flags, swot: { strengths, weaknesses, opportunities, threats }, funding, products, decision: decisionObj, qa, analystNote, trendComments };
}
