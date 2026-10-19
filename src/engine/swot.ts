/* Automatic, evidence-based SWOT. Every item states the metric it rests on, the value, the
   benchmark, the source documents (evidence IDs) and the report section; weaknesses and threats
   carry a severity and a concrete recommendation. Pure rules — no guessing, no external AI. */
import type { Analysis } from './analyse';
import type { Dataset, ManualInputs } from './types';
import type { Metric } from './calcFinancial';
import { buildEvidence } from './evidence';
import { fmtCr, fmtPct, fmtX, fmtINR } from './format';

export type SwotType = 'Strength' | 'Weakness' | 'Opportunity' | 'Threat';
export type Severity = 'Low' | 'Medium' | 'High';
export interface SwotItem {
  type: SwotType;
  title: string;
  detail: string;
  metric: string;
  value: string;
  benchmark: string;
  source: string; // evidence IDs / documents
  section: string; // report section the figure comes from
  severity: Severity;
  recommendation: string;
}
export interface SwotResult { items: SwotItem[]; counts: Record<SwotType, number>; highRisks: number; generatedFrom: string[] }

export function buildSwot(a: Analysis, ds: Dataset, inp: ManualInputs): SwotResult {
  const ev = buildEvidence(ds);
  const items: SwotItem[] = [];
  const add = (i: SwotItem) => items.push(i);
  const fin = a.fin, gst = a.gst, bank = a.bank, rec = a.recon, risk = a.risk;
  const fys = fin?.fys || [];
  const lastFy = fys[fys.length - 1];
  const M = (k: string): Metric | undefined => fin ? [...fin.performance, ...fin.ratios, ...fin.extra].find((m) => m.key === k) : undefined;
  const v = (k: string) => (lastFy ? M(k)?.values[lastFy] ?? null : null);
  const finSrc = `${ev.fin} · audited financials ${lastFy || ''}`.trim();

  /* ---------------- financial ---------------- */
  if (fin && lastFy) {
    const rev = M('revenue');
    const yoy = rev?.yoy[lastFy] ?? null;
    if (yoy !== null) {
      if (yoy > 0.15) add({ type: 'Strength', title: 'Strong revenue growth', detail: `Turnover grew ${fmtPct(yoy)} in ${lastFy} to ${fmtCr(v('revenue'))}${rev?.cagr != null ? `; CAGR ${fmtPct(rev.cagr)}` : ''}.`, metric: 'Revenue YoY growth', value: fmtPct(yoy), benchmark: '> 15% strong', source: finSrc, section: '3', severity: 'Low', recommendation: '' });
      else if (yoy < -0.05) add({ type: 'Weakness', title: 'Declining turnover', detail: `Turnover fell ${fmtPct(-yoy)} in ${lastFy}.`, metric: 'Revenue YoY growth', value: fmtPct(yoy), benchmark: '≥ 0%', source: finSrc, section: '3', severity: yoy < -0.2 ? 'High' : 'Medium', recommendation: 'Obtain the order book and month-wise sales of the current year; link fresh limits to a sales recovery plan and monitor through GST returns quarterly.' });
    }
    const em = v('ebitda_margin');
    if (em !== null) {
      if (em >= 0.12) add({ type: 'Strength', title: 'Healthy operating margin', detail: `EBITDA margin ${fmtPct(em)} in ${lastFy}.`, metric: 'EBITDA margin', value: fmtPct(em), benchmark: '≥ 12% healthy', source: finSrc, section: '3', severity: 'Low', recommendation: '' });
      else if (em < 0.05) add({ type: 'Weakness', title: 'Thin operating margin', detail: `EBITDA margin only ${fmtPct(em)} — little cushion against cost or price shocks.`, metric: 'EBITDA margin', value: fmtPct(em), benchmark: '≥ 8% comfortable', source: finSrc, section: '3', severity: em < 0.02 ? 'High' : 'Medium', recommendation: 'Prefer self-liquidating, transaction-linked products (invoice / purchase finance) over term debt; review pricing, product mix and procurement cost.' });
    }
    const pat = v('pat');
    if (pat !== null && pat < 0) add({ type: 'Weakness', title: 'Net loss', detail: `PAT of ${fmtCr(pat)} in ${lastFy}.`, metric: 'PAT', value: fmtCr(pat), benchmark: '> 0', source: finSrc, section: '3', severity: 'High', recommendation: 'Fresh exposure only against promoter infusion or full collateral; require a turnaround plan with quarterly milestones.' });
    else if (pat !== null && fys.every((f) => (M('pat')?.values[f] ?? 0) > 0)) add({ type: 'Strength', title: 'Consistently profitable', detail: `Profit after tax in every year analysed (${fys.join(', ')}); latest ${fmtCr(pat)}.`, metric: 'PAT', value: fmtCr(pat), benchmark: '> 0 every year', source: finSrc, section: '3', severity: 'Low', recommendation: '' });
    const cr = v('r_cr');
    if (cr !== null) {
      if (cr >= 1.33) add({ type: 'Strength', title: 'Comfortable liquidity', detail: `Current ratio ${fmtX(cr)}.`, metric: 'Current ratio', value: fmtX(cr), benchmark: '≥ 1.33x', source: finSrc, section: '4 (ratio 7)', severity: 'Low', recommendation: '' });
      else add({ type: 'Weakness', title: 'Tight liquidity', detail: `Current ratio ${fmtX(cr)} is below the 1.33x benchmark.`, metric: 'Current ratio', value: fmtX(cr), benchmark: '≥ 1.33x', source: finSrc, section: '4 (ratio 7)', severity: cr < 1 ? 'High' : 'Medium', recommendation: 'Structure part of the requirement as WCTL / long-term funds to lift the current ratio; ask promoters to bring margin money; avoid adding short-term debt.' });
    }
    const tol = v('r_toltnw');
    if (tol !== null) {
      if (tol > 4) add({ type: 'Threat', title: 'High leverage', detail: `TOL/TNW ${fmtX(tol)} — outside liabilities far exceed tangible net worth.`, metric: 'TOL / TNW', value: fmtX(tol), benchmark: '≤ 4x (≤ 3x preferred)', source: finSrc, section: '4 (ratio 12)', severity: tol > 6 ? 'High' : 'Medium', recommendation: 'Condition fresh exposure on equity / quasi-equity infusion or subordination of unsecured loans; cap total outside liabilities in the sanction covenants.' });
      else if (tol <= 2) add({ type: 'Strength', title: 'Conservative leverage', detail: `TOL/TNW ${fmtX(tol)}.`, metric: 'TOL / TNW', value: fmtX(tol), benchmark: '≤ 3x', source: finSrc, section: '4 (ratio 12)', severity: 'Low', recommendation: '' });
    }
    const icr = v('r_icr');
    if (icr !== null) {
      if (icr < 2) add({ type: 'Weakness', title: 'Weak interest cover', detail: `EBIT covers interest only ${fmtX(icr)}.`, metric: 'Interest coverage', value: fmtX(icr), benchmark: '≥ 2x', source: finSrc, section: '4 (ratio 11)', severity: icr < 1.25 ? 'High' : 'Medium', recommendation: 'Limit additional interest-bearing debt; consider longer tenure / moratorium and escrow of receivables for servicing.' });
      else if (icr >= 3) add({ type: 'Strength', title: 'Strong interest cover', detail: `EBIT covers interest ${fmtX(icr)}.`, metric: 'Interest coverage', value: fmtX(icr), benchmark: '≥ 2x', source: finSrc, section: '4 (ratio 11)', severity: 'Low', recommendation: '' });
    }
    const dscr = v('r_dscr');
    if (dscr !== null && dscr < 1.25) add({ type: 'Weakness', title: 'Debt service coverage below norm', detail: `DSCR ${fmtX(dscr)}.`, metric: 'DSCR', value: fmtX(dscr), benchmark: '≥ 1.25x', source: `${finSrc}; principal repayment (Settings)`, section: '4 (ratio 6)', severity: dscr < 1 ? 'High' : 'Medium', recommendation: 'Re-schedule repayments to match cash generation (longer tenure / step-up EMIs); stress-test DSCR before sanction.' });
    const ocf = v('ocf');
    if (ocf !== null && ocf < 0) add({ type: 'Weakness', title: 'Negative operating cash flow', detail: `Operating cash flow ${fmtCr(ocf)} in ${lastFy} — growth is absorbing cash.`, metric: 'Operating cash flow', value: fmtCr(ocf), benchmark: '> 0', source: finSrc, section: '3', severity: 'High', recommendation: 'Fund the working-capital build-up with drawing-power-linked limits; monitor stock and debtor statements monthly.' });
    const dd = v('r_dcp');
    if (dd !== null && dd > 90) add({ type: 'Weakness', title: 'Stretched receivables', detail: `Debtors take ${Math.round(dd)} days to collect.`, metric: 'Debtor days', value: `${Math.round(dd)} days`, benchmark: '≤ 90 days', source: finSrc, section: '4 (ratio 17)', severity: dd > 150 ? 'High' : 'Medium', recommendation: 'Use invoice discounting / factoring with collections routed to an escrow account; cap ineligible (> 90 days) debtors in drawing power.' });
    const sp = v('r_sp');
    if (sp !== null && sp > 120) add({ type: 'Weakness', title: 'High inventory holding', detail: `Stock period ${Math.round(sp)} days.`, metric: 'Stock days', value: `${Math.round(sp)} days`, benchmark: '≤ 90 days', source: finSrc, section: '4 (ratio 19)', severity: sp > 180 ? 'High' : 'Medium', recommendation: 'Insist on periodic stock audit; exclude slow-moving stock from drawing power.' });
    const nwT = M('networth');
    if (nwT && nwT.trend.startsWith('Consistent growth')) add({ type: 'Strength', title: 'Growing net worth', detail: `Net worth up to ${fmtCr(v('networth'))} through retained earnings.`, metric: 'Net worth', value: fmtCr(v('networth')), benchmark: 'rising', source: finSrc, section: '3', severity: 'Low', recommendation: '' });
  } else {
    const scanned = (ds.docs || []).some((d) => d.status === 'scanned' && /financial|itr/i.test(d.type));
    add({ type: 'Weakness', title: 'Audited financials not analysed', detail: scanned ? 'The audited statements in the file are scanned images, so profitability, leverage and liquidity could not be measured.' : 'No audited financial statements were provided.', metric: 'Financial statements', value: 'not available', benchmark: 'last 3 years audited', source: ev.ref(/financial|itr/i, 'documents list'), section: '3–5', severity: 'High', recommendation: 'Obtain text PDFs / Excel of the last 3 audited years (or fill the INGOVIQ financial input template) before credit approval.' });
  }

  /* ---------------- GST ---------------- */
  if (gst) {
    const full = gst.fys.filter((f) => gst.monthly.filter((m) => m.fy === f && m.revenue).length >= 12);
    const lf = full[full.length - 1];
    if (lf && gst.revenueYoY[lf] != null) {
      const g = gst.revenueYoY[lf]!;
      if (g > 0.15) add({ type: 'Strength', title: 'GST sales growing', detail: `GST-reported sales up ${fmtPct(g)} in ${lf} (${fmtCr(gst.revenueFY[lf])}).`, metric: 'GST sales YoY', value: fmtPct(g), benchmark: '> 15%', source: `${ev.gstSales} · GSTR-3B`, section: '6', severity: 'Low', recommendation: '' });
      else if (g < -0.1) add({ type: 'Threat', title: 'GST sales declining', detail: `GST sales down ${fmtPct(-g)} in ${lf}.`, metric: 'GST sales YoY', value: fmtPct(g), benchmark: '≥ 0%', source: ev.gstSales, section: '6', severity: g < -0.25 ? 'High' : 'Medium', recommendation: 'Seek explanation for the drop (customer loss, pricing, seasonality) and verify with the latest months of GSTR-3B before sanction.' });
    } else if (lf) add({ type: 'Strength', title: 'Sizeable GST turnover', detail: `${lf}: ${fmtCr(gst.revenueFY[lf])} declared in GST returns.`, metric: 'GST sales', value: fmtCr(gst.revenueFY[lf]), benchmark: 'full year', source: ev.gstSales, section: '6', severity: 'Low', recommendation: '' });
    const lastG = gst.fys[gst.fys.length - 1];
    const cb = gst.concentration.buyers.find((c) => c.fy === (lf || lastG));
    if (cb?.top5 != null) {
      if (cb.top5 > 0.6) add({ type: 'Threat', title: 'Buyer concentration', detail: `Top 5 buyers = ${fmtPct(cb.top5)} of sales; largest ${cb.largestName} ${fmtPct(cb.top1)}.`, metric: 'Top-5 buyer share', value: fmtPct(cb.top5), benchmark: '≤ 60%', source: ev.gstParties, section: '6.1', severity: cb.top5 > 0.8 ? 'High' : 'Medium', recommendation: 'Route the top buyers\' payments through an escrow / TRA; consider credit insurance; take buyer-wise confirmation of balances.' });
      else if (cb.count >= 15) add({ type: 'Strength', title: 'Diversified customer base', detail: `${cb.count} buyers; top 5 = ${fmtPct(cb.top5)}.`, metric: 'Top-5 buyer share', value: fmtPct(cb.top5), benchmark: '≤ 60%', source: ev.gstParties, section: '6.1', severity: 'Low', recommendation: '' });
    }
    const cs = gst.concentration.suppliers.find((c) => c.fy === (lf || lastG));
    if (cs?.top5 != null && cs.top5 > 0.7) add({ type: 'Threat', title: 'Supplier dependency', detail: `Top 5 suppliers = ${fmtPct(cs.top5)} of purchases; largest ${cs.largestName}.`, metric: 'Top-5 supplier share', value: fmtPct(cs.top5), benchmark: '≤ 70%', source: ev.gstParties, section: '7', severity: cs.top5 > 0.9 ? 'High' : 'Medium', recommendation: 'Ask for alternate-supplier arrangements; purchase finance / reverse factoring with the key suppliers can secure supply terms.' });
    const fs = gst.filing.summary;
    if (fs.totalReturns) {
      if (fs.lateReturns === 0) add({ type: 'Strength', title: 'Timely GST compliance', detail: `All ${fs.totalReturns} returns filed by the due date.`, metric: 'Late GST returns', value: '0', benchmark: '0', source: ev.ref(/gstr-3b/i, ev.gst), section: '10', severity: 'Low', recommendation: '' });
      else add({ type: fs.latePct > 0.3 ? 'Threat' : 'Weakness', title: 'Late GST filings', detail: `${fs.lateReturns} of ${fs.totalReturns} returns late (max ${fs.maxDelay} days; est. late fee ${fmtINR(fs.estLateFee)}).`, metric: 'Late returns', value: fmtPct(fs.latePct), benchmark: '< 10%', source: ev.gst, section: '10', severity: fs.latePct > 0.3 ? 'High' : fs.latePct > 0.1 ? 'Medium' : 'Low', recommendation: 'Covenant for timely GST filing; review GSTR-3B every quarter; obtain explanation for delayed periods.' });
      if (fs.missingPeriods > 0) add({ type: 'Weakness', title: 'GST returns missing in the file', detail: `${fs.missingPeriods} period(s) not provided.`, metric: 'Missing periods', value: String(fs.missingPeriods), benchmark: '0', source: ev.gst, section: '10', severity: 'Medium', recommendation: 'Collect the missing GSTR-3B returns (or GST portal filing status) to complete the analysis.' });
    }
    const ex = gst.exports[gst.exports.length - 1];
    if (ex?.ratio != null && ex.ratio > 0.05) add({ type: 'Opportunity', title: 'Export business', detail: `Exports ${fmtPct(ex.ratio)} of turnover.`, metric: 'Export ratio', value: fmtPct(ex.ratio), benchmark: '—', source: ev.gstSales, section: '9', severity: 'Low', recommendation: 'Pre-shipment / post-shipment export credit (PCFC / EPC) at lower cost.' });
    const geo = gst.geoConcentration[gst.geoConcentration.length - 1];
    if (geo && geo.share > 0.85 && (ds.gst?.gstins.length || 0) > 1) add({ type: 'Threat', title: 'Geographic concentration', detail: `${geo.topState} contributes ${fmtPct(geo.share)} of ${geo.fy} sales despite ${ds.gst?.gstins.length} GST registrations.`, metric: 'Top-state share', value: fmtPct(geo.share), benchmark: '≤ 85%', source: ev.gstSales, section: '11', severity: 'Low', recommendation: 'Track the ramp-up of the other state registrations; regional demand shocks hit the whole business.' });
    if ((ds.gst?.gstins.length || 0) > 1) add({ type: 'Opportunity', title: 'Multi-state presence', detail: `${ds.gst?.gstins.length} GST registrations — scope to grow sales outside the home state.`, metric: 'GST registrations', value: String(ds.gst?.gstins.length), benchmark: '—', source: ev.ref(/gst registration|gstr-3b/i, ev.gst), section: '11', severity: 'Low', recommendation: '' });
    if (gst.unusualMonths.length) add({ type: 'Weakness', title: 'Unusual sales / purchase movement', detail: gst.unusualMonths.slice(0, 3).map((u) => `${u.month}: ${u.note}`).join('; '), metric: 'Sales ÷ purchases (monthly)', value: `${gst.unusualMonths.length} month(s)`, benchmark: 'stable', source: `${ev.gstSales}; ${ev.gstParties}`, section: '8', severity: gst.unusualMonths.length > 3 ? 'Medium' : 'Low', recommendation: 'Reconcile purchase booking for those months (Tally purchase register vs GSTR-2B ITC) — sales without matching purchases need explanation.' });
  }

  /* ---------------- banking ---------------- */
  if (bank) {
    const r = bank.returns;
    const inw = r.inward.count, ecs = r.ecsNachEmi.count;
    if (inw + ecs === 0) add({ type: 'Strength', title: 'Clean repayment conduct in banking', detail: 'No own-cheque or ECS / NACH / EMI returns in the statements.', metric: 'Inward + ECS returns', value: '0', benchmark: '0', source: ev.bank, section: '18–19', severity: 'Low', recommendation: '' });
    else add({ type: ecs ? 'Threat' : 'Weakness', title: 'Payment returns in bank statements', detail: `${inw} own-cheque / payment return(s) (${fmtINR(r.inward.amount)})${ecs ? `, ${ecs} ECS/NACH/EMI return(s)` : ''}.`, metric: 'Inward + ECS returns', value: String(inw + ecs), benchmark: '0', source: ev.bank, section: '18–19', severity: ecs > 1 || inw > 3 ? 'High' : 'Medium', recommendation: 'Obtain reasons for each return; insist on NACH for repayments with a cash-flow buffer; monitor statement monthly for 6 months.' });
    if (bank.totals.trend === 'Increasing' || bank.totals.trend === 'Growing') add({ type: 'Strength', title: 'Rising banking turnover', detail: `Monthly inflows show an ${bank.totals.trend.toLowerCase()} trend.`, metric: 'Banking trend', value: bank.totals.trend, benchmark: 'increasing / stable', source: ev.bank, section: '14', severity: 'Low', recommendation: '' });
    if ((bank.totals.volatility ?? 0) > 0.6) add({ type: 'Weakness', title: 'Volatile monthly inflows', detail: `Coefficient of variation of monthly inflow ${fmtPct(bank.totals.volatility)}.`, metric: 'Inflow volatility', value: fmtPct(bank.totals.volatility), benchmark: '≤ 40%', source: ev.bank, section: '17', severity: 'Medium', recommendation: 'Match EMI dates to strong collection months or use a structured / ballooning schedule; keep a DSRA of one instalment.' });
    const cashPct = bank.cash.pctOfCredits ?? 0;
    if (cashPct > 0.2) add({ type: 'Weakness', title: 'Heavy cash deposits', detail: `Cash = ${fmtPct(cashPct)} of credits.`, metric: 'Cash % of credits', value: fmtPct(cashPct), benchmark: '≤ 10%', source: ev.bank, section: '24', severity: cashPct > 0.4 ? 'High' : 'Medium', recommendation: 'Obtain the business reason for cash sales; verify against GST B2C sales.' });
    for (const u of bank.utilisation) if ((u.avgUtil ?? 0) > 0.85) add({ type: 'Threat', title: 'CC / OD limit fully drawn', detail: `${u.account}: average utilisation ${fmtPct(u.avgUtil)}, ${u.daysAbove90} days above 90%, ${u.overdrawnDays} overdrawn days.`, metric: 'Average CC utilisation', value: fmtPct(u.avgUtil), benchmark: '≤ 75%', source: `${ev.bank}; limit: ${u.limitSource}`, section: '25', severity: u.overdrawnDays > 0 ? 'High' : 'Medium', recommendation: 'Assess-based enhancement only after stock & debtor statement verification; monthly drawing-power monitoring.' });
    const adjShare = bank.adjusted.gross ? bank.adjusted.adjusted / bank.adjusted.gross : null;
    if (adjShare !== null && adjShare < 0.7) add({ type: 'Weakness', title: 'Large non-business credits', detail: `Only ${fmtPct(adjShare)} of gross credits are genuine business receipts (rest: internal / promoter / loans / returns).`, metric: 'Adjusted ÷ gross inflow', value: fmtPct(adjShare), benchmark: '≥ 80%', source: ev.bank, section: '16', severity: adjShare < 0.5 ? 'High' : 'Medium', recommendation: 'Use adjusted inflow (not gross) for BTO-based eligibility; obtain details of large internal / promoter transfers.' });
  }

  /* ---------------- reconciliation ---------------- */
  if (rec.overlap && rec.overlap.variance != null) {
    const vv = rec.overlap.variance;
    if (Math.abs(vv) <= 0.1) add({ type: 'Strength', title: 'GST and banking reconcile', detail: `Adjusted bank inflow within ${fmtPct(Math.abs(vv))} of GST sales incl. tax (${rec.overlap.label}).`, metric: 'GST vs bank variance', value: fmtPct(vv), benchmark: '± 10%', source: `${ev.gstSales}; ${ev.bank}`, section: '26', severity: 'Low', recommendation: '' });
    else add({ type: Math.abs(vv) > 0.25 ? 'Threat' : 'Weakness', title: 'GST vs banking mismatch', detail: `Adjusted bank inflow differs ${fmtPct(vv)} from GST sales incl. tax over ${rec.overlap.label}. ${rec.overlap.lagNote}`, metric: 'GST vs bank variance', value: fmtPct(vv), benchmark: '± 10%', source: `${ev.gstSales}; ${ev.bank}`, section: '26', severity: Math.abs(vv) > 0.25 ? 'High' : 'Medium', recommendation: 'Obtain statements of all operative accounts (incl. other banks) and debtor-wise collections; explain the difference before sanction.' });
  }
  if (rec.buyers.matchedShare != null && rec.buyers.matchedShare < 0.5) add({ type: 'Weakness', title: 'Buyer receipts not traceable in bank', detail: `Only ${fmtPct(rec.buyers.matchedShare)} of GST sales could be matched to banking receipts from the same parties.`, metric: 'Buyer-to-bank match', value: fmtPct(rec.buyers.matchedShare), benchmark: '≥ 70%', source: `${ev.gstParties}; ${ev.bank}`, section: '27', severity: 'Medium', recommendation: 'Collect buyer ledgers / confirmations; check if receipts come into accounts not provided.' });

  /* ---------------- bureau, ageing, obligations ---------------- */
  if (inp.cibilScore != null) {
    if (inp.cibilScore >= 750) add({ type: 'Strength', title: 'Good promoter credit score', detail: `CIBIL ${inp.cibilScore}.`, metric: 'CIBIL score (lowest promoter)', value: String(inp.cibilScore), benchmark: '≥ 750', source: ev.bureau, section: '30', severity: 'Low', recommendation: '' });
    else add({ type: inp.cibilScore < 650 ? 'Threat' : 'Weakness', title: 'Promoter credit score below 750', detail: `Lowest promoter CIBIL ${inp.cibilScore}.`, metric: 'CIBIL score', value: String(inp.cibilScore), benchmark: '≥ 750', source: ev.bureau, section: '30', severity: inp.cibilScore < 650 ? 'High' : 'Medium', recommendation: 'Review the bureau report for overdue / settled accounts; obtain explanation and closure letters.' });
  }
  if (inp.cmrRank != null) {
    if (inp.cmrRank <= 4) add({ type: 'Strength', title: 'Strong commercial bureau rank', detail: `CMR-${inp.cmrRank}.`, metric: 'CMR rank', value: `CMR-${inp.cmrRank}`, benchmark: 'CMR 1–4', source: ev.bureau, section: '30', severity: 'Low', recommendation: '' });
    else add({ type: 'Weakness', title: 'Weak commercial bureau rank', detail: `CMR-${inp.cmrRank}.`, metric: 'CMR rank', value: `CMR-${inp.cmrRank}`, benchmark: 'CMR 1–4', source: ev.bureau, section: '30', severity: inp.cmrRank >= 8 ? 'High' : 'Medium', recommendation: 'Examine overdue facilities in the CMR report; seek regularisation proof before sanction.' });
  }
  if (inp.dpdObserved) add({ type: 'Threat', title: 'Delinquency noted in bureau history', detail: 'The bureau report lists past delinquency (DPD) among score factors.', metric: 'DPD / delinquency', value: 'observed', benchmark: 'nil', source: ev.bureau, section: '30', severity: 'Medium', recommendation: 'Obtain account-wise DPD history and No-Dues certificates; check that no account is currently overdue.' });
  const tot = (k: 'receivable' | 'payable') => inp.ageing.reduce((s, b) => s + (b[k] || 0), 0);
  if (tot('receivable')) {
    const old = inp.ageing.slice(3).reduce((s, b) => s + b.receivable, 0) / tot('receivable');
    if (old > 0.15) add({ type: 'Weakness', title: 'Old debtors', detail: `${fmtPct(old)} of receivables are over 90 days old.`, metric: 'Debtors > 90 days', value: fmtPct(old), benchmark: '≤ 15%', source: ev.ageing, section: '29', severity: old > 0.4 ? 'High' : old > 0.25 ? 'Medium' : 'Low', recommendation: 'Exclude > 90-day debtors from drawing power; follow up stressed buyers; consider credit insurance.' });
    else add({ type: 'Strength', title: 'Fresh receivables', detail: `Only ${fmtPct(old)} of receivables are over 90 days.`, metric: 'Debtors > 90 days', value: fmtPct(old), benchmark: '≤ 15%', source: ev.ageing, section: '29', severity: 'Low', recommendation: '' });
  }
  if (tot('payable')) {
    const oldP = inp.ageing.slice(3).reduce((s, b) => s + b.payable, 0) / tot('payable');
    if (oldP > 0.3) add({ type: 'Threat', title: 'Supplier-payment pressure', detail: `${fmtPct(oldP)} of payables are over 90 days.`, metric: 'Creditors > 90 days', value: fmtPct(oldP), benchmark: '≤ 25%', source: ev.ageing, section: '29', severity: oldP > 0.5 ? 'High' : 'Medium', recommendation: 'Purchase finance / reverse factoring can clear old creditors and protect supply; verify no supplier disputes.' });
  }
  const loans = ds.extra?.loans || [];
  const emi = loans.reduce((s, l) => s + (l.emi || 0), 0);
  if (emi && bank) {
    const avgAdj = bank.adjusted.adjusted / (bank.months.length || 1);
    const burden = avgAdj ? emi / avgAdj : null;
    if (burden !== null) add({ type: burden > 0.15 ? 'Threat' : 'Strength', title: burden > 0.15 ? 'Heavy EMI burden' : 'EMI burden manageable', detail: `Monthly EMI ${fmtINR(emi)} = ${fmtPct(burden)} of average adjusted monthly inflow (${fmtINR(avgAdj)}).`, metric: 'EMI ÷ monthly adjusted inflow', value: fmtPct(burden), benchmark: '≤ 15%', source: `${ev.loans}; ${ev.bank}`, section: '30 / 36', severity: burden > 0.3 ? 'High' : burden > 0.15 ? 'Medium' : 'Low', recommendation: burden > 0.15 ? 'Restrict new term debt; consider consolidating existing loans at longer tenure.' : '' });
  }
  if (ds.extra?.profile['MSME Category']) add({ type: 'Opportunity', title: 'MSME registered', detail: `${ds.extra.profile['MSME Category']} (${ds.extra.profile['Udyam Registration'] || 'Udyam'}).`, metric: 'Udyam registration', value: ds.extra.profile['MSME Category'], benchmark: '—', source: ev.ref(/udyam/i), section: '1', severity: 'Low', recommendation: 'Eligible for priority-sector lending, CGTMSE cover (collateral-free) and TReDS discounting of MSME receivables.' });
  for (const p of risk.products.slice(0, 3)) add({ type: 'Opportunity', title: `Funding fit: ${p.name}`, detail: p.why, metric: 'Product mapping', value: p.name, benchmark: '—', source: 'sections 5–30', section: '37', severity: 'Low', recommendation: '' });

  // red flags from the risk engine that no rule above covered become threats / weaknesses
  for (const f of risk.flags) {
    if (items.some((i) => f.text.toLowerCase().includes(i.metric.toLowerCase().split(' ')[0]) && i.type !== 'Strength' && i.type !== 'Opportunity')) continue;
    if (/company report flag/i.test(f.text)) add({ type: 'Threat', title: 'Adverse item in company report', detail: f.text.replace(/^Company report flag:\s*/i, ''), metric: 'Company report flag', value: f.severity, benchmark: 'none', source: ev.fin, section: '31', severity: f.severity, recommendation: 'Obtain the status / closure of the case or flag with supporting documents before sanction.' });
  }

  const order: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 };
  items.sort((p, q) => (p.type === q.type ? order[p.severity] - order[q.severity] : 0));
  const counts = { Strength: 0, Weakness: 0, Opportunity: 0, Threat: 0 } as Record<SwotType, number>;
  for (const i of items) counts[i.type]++;
  const generatedFrom = [fin ? 'Financials' : '', gst ? 'GST' : '', bank ? 'Banking' : '', inp.cibilScore != null || inp.cmrRank != null ? 'Bureau' : '', tot('receivable') ? 'Ageing' : '', loans.length ? 'Loans' : ''].filter(Boolean);
  return { items, counts, highRisks: items.filter((i) => (i.type === 'Weakness' || i.type === 'Threat') && i.severity === 'High').length, generatedFrom };
}
