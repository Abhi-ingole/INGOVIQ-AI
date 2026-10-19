/* Additional visuals so every report page carries at least 4–5 charts. Each one only draws data
   that is actually loaded; charts without data are skipped rather than shown empty. */
import type { ReactNode } from 'react';
import type { PageCtx } from '../ctx';
import { pickFYs } from '../ctx';
import { ChartCard, Gauge, type ChartSpec } from '../Chart';
import { Section } from '../common';
import { monthLabel, fyOfMonth } from '../../engine/utils';
import type { Metric } from '../../engine/calcFinancial';

type Card = { title: string; sub?: string; spec: ChartSpec; height?: number } | null | false | undefined;
const hasData = (s: ChartSpec) => s.categories.length > 0 && s.series.some((x) => x.data.some((v) => v !== null && v !== 0));

function Grid({ ctx, title, cards, extra }: { ctx: PageCtx; title: string; cards: Card[]; extra?: ReactNode }) {
  const ok = cards.filter((c): c is Exclude<Card, null | false | undefined> => !!c && hasData(c.spec));
  if (!ok.length && !extra) return null;
  return (
    <>
      <Section title={title} />
      <div className="grid g2">
        {extra}
        {ok.map((c) => <ChartCard key={c.title} title={c.title} sub={c.sub} spec={c.spec} height={c.height || 260} themeKey={ctx.themeKey} />)}
      </div>
    </>
  );
}

const metric = (ctx: PageCtx, k: string): Metric | undefined => (ctx.a.fin ? [...ctx.a.fin.performance, ...ctx.a.fin.ratios, ...ctx.a.fin.extra].find((m) => m.key === k) : undefined);
const series = (ctx: PageCtx, fys: string[], keys: string[], startSlot = 0) => keys.map((k, i) => { const m = metric(ctx, k); return { name: m?.name.replace(/^\d+\.\s*/, '') || k, data: fys.map((f) => m?.values[f] ?? null), slot: startSlot + i }; });

/* ---------------- Ratios ---------------- */
export function RatioVisuals(ctx: PageCtx) {
  const fin = ctx.a.fin;
  if (!fin) return null;
  const fys = pickFYs(fin.fys, ctx.fySel);
  return <Grid ctx={ctx} title="Ratio visuals" cards={[
    { title: 'Liquidity ratios', sub: 'Current, quick and working-capital ratio (benchmark 1.33x)', spec: { categories: fys, unit: 'x', type: 'line', series: series(ctx, fys, ['r_cr', 'r_qr', 'r_wcr']) } },
    { title: 'Leverage ratios', sub: 'Debt–equity, adjusted D/E, TOL/TNW, Debt/EBITDA', spec: { categories: fys, unit: 'x', type: 'bar', series: series(ctx, fys, ['r_de', 'r_ade', 'r_toltnw', 'r_debitda']) } },
    { title: 'Debt-service cover', sub: 'DSCR, interest cover, OCF / interest', spec: { categories: fys, unit: 'x', type: 'bar', series: series(ctx, fys, ['r_dscr', 'r_icr', 'r_ocfi']) } },
    { title: 'Profitability', sub: 'Net profit to sales, ROE, ROCE', spec: { categories: fys, unit: 'pct', type: 'line', series: series(ctx, fys, ['r_nps', 'roe', 'roce']) } },
  ]} />;
}

/* ---------------- Working capital ---------------- */
export function WcVisuals(ctx: PageCtx) {
  const fin = ctx.a.fin;
  if (!fin) return null;
  const fys = pickFYs(fin.fys, ctx.fySel);
  const wc = fin.wc.filter((w) => fys.includes(w.fy));
  const wa = fin.wcAssessment;
  return <Grid ctx={ctx} title="Working-capital visuals" cards={[
    { title: 'Days: inventory, debtors, creditors', spec: { categories: wc.map((w) => w.fy), unit: 'days', type: 'bar', series: [{ name: 'Inventory days', data: wc.map((w) => w.inventoryDays) }, { name: 'Debtor days', data: wc.map((w) => w.debtorDays), slot: 1 }, { name: 'Creditor days', data: wc.map((w) => w.creditorDays), slot: 2 }] } },
    { title: 'Net working-capital cycle', sub: 'Inventory + debtor − creditor days', spec: { categories: wc.map((w) => w.fy), unit: 'days', type: 'line', series: [{ name: 'Net cycle', data: wc.map((w) => w.cycle), slot: 3 }] } },
    { title: 'Working-capital gap', sub: 'Current assets − (current liabilities − bank borrowings)', spec: { categories: wc.map((w) => w.fy), unit: 'inr', type: 'bar', series: [{ name: 'WC gap', data: wc.map((w) => w.gap), slot: 4 }] } },
    { title: 'Requirement methods (latest year)', sub: 'MPBF (Tandon II) vs turnover method vs additional need', spec: { categories: ['MPBF (Tandon II)', 'Turnover method (20%)', 'Additional WC need'], unit: 'inr', type: 'bar', allowed: ['bar', 'hbar', 'table'], series: [{ name: 'Amount', data: [wa.mpbf, wa.turnoverMethod, wa.additionalWC], slot: 2 }] } },
    { title: 'Current assets mix', sub: 'Inventory, receivables and other current assets', spec: { categories: fys, unit: 'inr', type: 'stacked', series: series(ctx, fys, ['inventories', 'receivables', 'cash']) } },
  ]} />;
}

/* ---------------- Banking (extra) ---------------- */
export function BankVisuals(ctx: PageCtx) {
  const b = ctx.a.bank;
  if (!b) return null;
  const ms = b.months.filter((m) => !ctx.fySel.length || ctx.fySel.includes(fyOfMonth(m)));
  const classes = ['Business', 'Internal / Self', 'Promoter / Director', 'Group / Related', 'Loan Disbursal', 'Return / Reversal', 'Non-Business'] as const;
  return <Grid ctx={ctx} title="More banking visuals" cards={[
    { title: 'Credits by classification (monthly)', sub: 'Genuine business receipts vs internal / promoter / loans / returns', spec: { categories: ms.map(monthLabel), unit: 'inr', type: 'stacked', series: classes.map((c, i) => ({ name: c, data: ms.map((m) => b.txns.filter((t) => t.month === m && t.cls === c).reduce((s, t) => s + t.credit, 0)), slot: i })) } },
    { title: 'Top 10 inflow parties', spec: { categories: b.parties.inflow.slice(0, 10).map((p) => p.party.slice(0, 26)), unit: 'inr', type: 'hbar', series: [{ name: 'Credits', data: b.parties.inflow.slice(0, 10).map((p) => p.amount) }] }, height: 320 },
    { title: 'Top 10 outflow parties', spec: { categories: b.parties.outflow.slice(0, 10).map((p) => p.party.slice(0, 26)), unit: 'inr', type: 'hbar', series: [{ name: 'Debits', data: b.parties.outflow.slice(0, 10).map((p) => p.amount), slot: 1 }] }, height: 320 },
    { title: 'Month-end closing balance', spec: { categories: ms.map(monthLabel), unit: 'inr', type: 'line', series: [{ name: 'Closing balance', data: ms.map((m) => b.monthly.find((x) => x.month === m)?.closing ?? null), slot: 2 }] } },
    { title: 'Cash deposits by month', spec: { categories: ms.map(monthLabel), unit: 'inr', type: 'bar', series: [{ name: 'Cash deposits', data: ms.map((m) => b.cash.monthly[m] ?? 0), slot: 3 }] } },
  ]} />;
}

/* ---------------- Reconciliation ---------------- */
export function ReconVisuals(ctx: PageCtx) {
  const r = ctx.a.recon;
  const rows = r.fyRows.filter((x) => !ctx.fySel.length || ctx.fySel.includes(x.fy));
  const status = (list: { status: string }[]) => { const m = new Map<string, number>(); for (const x of list) m.set(x.status, (m.get(x.status) || 0) + 1); return [...m]; };
  const bs = status(r.buyers.rows), ss = status(r.suppliers.rows);
  return <Grid ctx={ctx} title="Reconciliation visuals" cards={[
    { title: 'Financial vs GST vs banking — by year', spec: { categories: rows.map((x) => x.fy), unit: 'inr', type: 'bar', series: [{ name: 'Financial turnover', data: rows.map((x) => x.financial) }, { name: 'GST turnover', data: rows.map((x) => x.gst), slot: 1 }, { name: 'Gross bank inflow', data: rows.map((x) => x.bankGross), slot: 2 }, { name: 'Adjusted bank inflow', data: rows.map((x) => x.bankAdjusted), slot: 3 }] } },
    r.overlap && { title: `Same months: GST incl. tax vs adjusted bank inflow`, sub: r.overlap.label, spec: { categories: r.overlap.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'line', series: [{ name: 'GST incl. tax', data: r.overlap.monthly.map((m) => m.gstGross) }, { name: 'Adjusted bank inflow', data: r.overlap.monthly.map((m) => m.bankAdjusted), slot: 1 }] } },
    { title: 'Top buyers: GST sales vs bank receipts', spec: { categories: r.buyers.rows.slice(0, 10).map((x) => x.gstParty.slice(0, 24)), unit: 'inr', type: 'hbar', series: [{ name: 'GST incl. tax', data: r.buyers.rows.slice(0, 10).map((x) => x.gstGross) }, { name: 'Bank receipts', data: r.buyers.rows.slice(0, 10).map((x) => x.bankAmount), slot: 1 }] }, height: 340 },
    { title: 'Top suppliers: GST purchases vs bank payments', spec: { categories: r.suppliers.rows.slice(0, 10).map((x) => x.gstParty.slice(0, 24)), unit: 'inr', type: 'hbar', series: [{ name: 'GST incl. tax', data: r.suppliers.rows.slice(0, 10).map((x) => x.gstGross), slot: 2 }, { name: 'Bank payments', data: r.suppliers.rows.slice(0, 10).map((x) => x.bankAmount), slot: 3 }] }, height: 340 },
    { title: 'Buyer match status', sub: `${Math.round((r.buyers.matchedShare ?? 0) * 100)}% of GST sales traced to bank receipts`, spec: { categories: bs.map(([k]) => k), unit: 'num', type: 'donut', allowed: ['donut', 'pie', 'bar', 'table'], series: [{ name: 'Buyers', data: bs.map(([, v]) => v) }] } },
    { title: 'Supplier match status', spec: { categories: ss.map(([k]) => k), unit: 'num', type: 'donut', allowed: ['donut', 'pie', 'bar', 'table'], series: [{ name: 'Suppliers', data: ss.map(([, v]) => v) }] } },
  ]} />;
}

/* ---------------- Ageing & bureau ---------------- */
export function AgeingVisuals(ctx: PageCtx) {
  const { inp, ds } = ctx;
  const x = ds.extra;
  const recv = x?.ageing.find((g) => g.side === 'receivable'), pay = x?.ageing.find((g) => g.side === 'payable');
  const cons = (x?.cibil || []).filter((c) => c.kind === 'consumer');
  return <Grid ctx={ctx} title="Ageing & bureau visuals" extra={inp.cibilScore != null ? (
    <div className="card"><div className="card-title">Lowest promoter CIBIL score</div><Gauge value={Math.round(((inp.cibilScore - 300) / 600) * 100)} label={`CIBIL ${inp.cibilScore} (300–900 scale)${inp.cmrRank ? ` · CMR-${inp.cmrRank}` : ''}`} themeKey={ctx.themeKey} /></div>
  ) : undefined} cards={[
    { title: 'Receivables by age', spec: { categories: inp.ageing.map((b) => b.bucket), unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'bar', 'table'], series: [{ name: 'Receivables', data: inp.ageing.map((b) => b.receivable) }] } },
    { title: 'Payables by age', spec: { categories: inp.ageing.map((b) => b.bucket), unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'bar', 'table'], series: [{ name: 'Payables', data: inp.ageing.map((b) => b.payable) }] } },
    recv && { title: 'Top debtors — outstanding', spec: { categories: [...recv.parties].sort((p, q) => q.outstanding - p.outstanding).slice(0, 10).map((p) => p.name.slice(0, 26)), unit: 'inr', type: 'hbar', series: [{ name: 'Outstanding', data: [...recv.parties].sort((p, q) => q.outstanding - p.outstanding).slice(0, 10).map((p) => p.outstanding) }] }, height: 320 },
    pay && { title: 'Top creditors — outstanding', spec: { categories: [...pay.parties].sort((p, q) => q.outstanding - p.outstanding).slice(0, 10).map((p) => p.name.slice(0, 26)), unit: 'inr', type: 'hbar', series: [{ name: 'Outstanding', data: [...pay.parties].sort((p, q) => q.outstanding - p.outstanding).slice(0, 10).map((p) => p.outstanding), slot: 1 }] }, height: 320 },
    recv && { title: 'Collection days by debtor', sub: 'Average days from bill to receipt', spec: { categories: recv.parties.filter((p) => p.avgDays != null).slice(0, 12).map((p) => p.name.slice(0, 22)), unit: 'days', type: 'bar', series: [{ name: 'Avg days', data: recv.parties.filter((p) => p.avgDays != null).slice(0, 12).map((p) => p.avgDays), slot: 2 }] } },
    cons.length > 0 && { title: 'Promoter CIBIL scores', spec: { categories: cons.map((c) => c.name.slice(0, 22)), unit: 'num', type: 'bar', series: [{ name: 'Score', data: cons.map((c) => (c.kind === 'consumer' ? c.score : null)), slot: 3 }] } },
    (x?.loans.length ?? 0) > 0 && { title: 'Existing loans — outstanding & EMI', spec: { categories: x!.loans.map((l) => `${l.lender.slice(0, 16)} ${l.facility}`), unit: 'inr', type: 'bar', series: [{ name: 'Outstanding', data: x!.loans.map((l) => l.outstanding) }, { name: 'EMI × 12', data: x!.loans.map((l) => (l.emi || 0) * 12), slot: 1 }] } },
  ]} />;
}

/* ---------------- Risk & SWOT / SWOT / Decision ---------------- */
const PLURAL = { Strength: 'Strengths', Weakness: 'Weaknesses', Opportunity: 'Opportunities', Threat: 'Threats' } as const;
const AREA_OF_SECTION = (sec: string) => { const n = parseInt(sec, 10); return Number.isNaN(n) ? 'Other' : n <= 5 ? 'Financial' : n <= 13 ? 'GST' : n <= 25 ? 'Banking' : n <= 28 ? 'Reconciliation' : n <= 30 ? 'Bureau & ageing' : 'Other'; };

export function RiskVisuals(ctx: PageCtx) {
  const r = ctx.a.risk;
  const areas = ['Financial', 'GST', 'Banking', 'Reconciliation', 'Bureau'] as const;
  const sev = ['High', 'Medium', 'Low'] as const;
  const scored = r.scores.filter((s) => s.score !== null);
  return <Grid ctx={ctx} title="Risk visuals" cards={[
    { title: 'Red flags by area and severity', spec: { categories: [...areas], unit: 'num', type: 'stacked', series: sev.map((s, i) => ({ name: s, data: areas.map((a) => r.flags.filter((f) => f.area === a && f.severity === s).length), slot: [7, 3, 2][i] })) } },
    { title: 'Scorecard vs 60-point comfort line', spec: { categories: scored.map((s) => s.name), unit: 'num', type: 'hbar', series: [{ name: 'Score', data: scored.map((s) => s.score) }, { name: 'Comfort level', data: scored.map(() => 60), slot: 6 }] }, height: 340 },
    { title: 'Weighted contribution to the overall score', sub: 'Score × weight ÷ total weight of scored dimensions', spec: { categories: scored.map((s) => s.name), unit: 'num', type: 'donut', allowed: ['donut', 'pie', 'hbar', 'table'], series: [{ name: 'Points', data: scored.map((s) => Math.round(((s.score ?? 0) * s.weight) / (scored.reduce((t, x) => t + x.weight, 0) || 1) * 10) / 10) }] } },
    { title: 'SWOT balance', spec: { categories: ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'], unit: 'num', type: 'bar', series: [{ name: 'Items', data: [ctx.a.swot.counts.Strength, ctx.a.swot.counts.Weakness, ctx.a.swot.counts.Opportunity, ctx.a.swot.counts.Threat], slot: 1 }] } },
  ]} />;
}

export function SwotVisuals(ctx: PageCtx) {
  const sw = ctx.a.swot;
  const types = ['Strength', 'Weakness', 'Opportunity', 'Threat'] as const;
  const sev = ['High', 'Medium', 'Low'] as const;
  const risky = sw.items.filter((i) => i.type === 'Weakness' || i.type === 'Threat');
  const areas = [...new Set(sw.items.map((i) => AREA_OF_SECTION(i.section)))];
  return <Grid ctx={ctx} title="SWOT visuals" cards={[
    { title: 'SWOT items by type', spec: { categories: types.map((t) => PLURAL[t]), unit: 'num', type: 'bar', series: [{ name: 'Items', data: types.map((t) => sw.counts[t]) }] } },
    { title: 'Risk severity (weaknesses + threats)', spec: { categories: ['Weaknesses + threats'], unit: 'num', type: 'bar', allowed: ['bar', 'hbar', 'stacked', 'table'], series: sev.map((s, i) => ({ name: s, data: [risky.filter((x) => x.severity === s).length], slot: [7, 3, 2][i] })) } },
    { title: 'SWOT by data area', sub: 'Where each observation comes from', spec: { categories: areas, unit: 'num', type: 'stacked', series: types.map((t, i) => ({ name: PLURAL[t], data: areas.map((a) => sw.items.filter((x) => x.type === t && AREA_OF_SECTION(x.section) === a).length), slot: i })) } },
    { title: 'Severity by type', spec: { categories: ['Weaknesses', 'Threats'], unit: 'num', type: 'stacked', series: sev.map((s, i) => ({ name: s, data: [sw.items.filter((x) => x.type === 'Weakness' && x.severity === s).length, sw.items.filter((x) => x.type === 'Threat' && x.severity === s).length], slot: [7, 3, 2][i] })) } },
    { title: 'Scorecard dimensions', sub: 'The ratios behind the SWOT', spec: { categories: ctx.a.risk.scores.filter((s) => s.score !== null).map((s) => s.name), unit: 'num', type: 'hbar', series: [{ name: 'Score /100', data: ctx.a.risk.scores.filter((s) => s.score !== null).map((s) => s.score) }] }, height: 320 },
  ]} />;
}

export function DecisionVisuals(ctx: PageCtx) {
  const { a } = ctx;
  const r = a.risk, f = r.funding;
  const fys = a.fin?.fys || [];
  const last = fys[fys.length - 1];
  const g = a.gst, b = a.bank;
  const lastG = g ? [...g.fys].reverse().find((x) => g.monthly.filter((m) => m.fy === x && m.revenue).length >= 12) || g.fys[g.fys.length - 1] : undefined;
  return <Grid ctx={ctx} title="Decision visuals" extra={<div className="card"><div className="card-title">Overall AI credit score</div><Gauge value={r.overall.score} label={`${r.overall.risk} risk · ${r.decision.decision}`} themeKey={ctx.themeKey} /></div>} cards={[
    { title: 'Scores by dimension', spec: { categories: r.scores.filter((s) => s.score !== null).map((s) => s.name), unit: 'num', type: 'hbar', series: [{ name: 'Score /100', data: r.scores.filter((s) => s.score !== null).map((s) => s.score) }] }, height: 320 },
    { title: 'Turnover evidence used for funding', sub: 'Audited, GST and banking (latest full year / annualised)', spec: { categories: ['Audited turnover', 'GST sales', 'Adjusted bank inflow (annualised)'], unit: 'inr', type: 'bar', allowed: ['bar', 'hbar', 'table'], series: [{ name: 'Amount', data: [last ? a.fin?.performance.find((m) => m.key === 'revenue')?.values[last] ?? null : null, lastG ? g!.revenueFY[lastG] ?? null : null, b ? a.recon.bto.annualised : null], slot: 2 }] } },
    a.fin && { title: 'Leverage headroom', sub: 'Debt / EBITDA and TOL / TNW vs policy caps (3x / 4x)', spec: { categories: ['Debt / EBITDA', 'TOL / TNW', 'DSCR'], unit: 'x', type: 'bar', allowed: ['bar', 'table'], series: [{ name: 'Actual', data: [f.debtEbitda, f.tolTnw, f.dscr] }, { name: 'Policy level', data: [3, 4, 1.25], slot: 6 }] } },
    { title: 'Red flags by severity', spec: { categories: ['Red flags'], unit: 'num', type: 'bar', allowed: ['bar', 'hbar', 'stacked', 'table'], series: (['High', 'Medium', 'Low'] as const).map((s, i) => ({ name: s, data: [r.flags.filter((x) => x.severity === s).length], slot: [7, 3, 2][i] })) } },
    { title: 'Strengths vs risks considered', spec: { categories: ['Strengths', 'Risks', 'Mitigants', 'Conditions', 'Documents pending'], unit: 'num', type: 'bar', series: [{ name: 'Count', data: [r.decision.strengths.length, r.decision.risks.length, r.decision.mitigants.length, r.decision.conditions.length, r.decision.documents.length], slot: 1 }] } },
  ]} />;
}

/* ---------------- Loan file ---------------- */
export function LoanFileVisuals(ctx: PageCtx) {
  const x = ctx.ds.extra;
  if (!x) return null;
  const docs = ctx.ds.docs || [];
  const types = [...new Set(docs.map((d) => d.type))].map((t) => [t, docs.filter((d) => d.type === t).length] as const).sort((p, q) => q[1] - p[1]).slice(0, 12);
  const gstins = [...new Set(x.gstr3b.map((r) => r.gstin))];
  return <Grid ctx={ctx} title="Loan-file visuals" cards={[
    { title: 'Documents by type', spec: { categories: types.map(([t]) => t), unit: 'num', type: 'hbar', series: [{ name: 'Files', data: types.map(([, n]) => n) }] }, height: 340 },
    { title: 'Bank statements — transactions per file', spec: { categories: x.statements.map((s) => `${s.bank.slice(0, 8)} ${s.from.slice(2, 7)}→${s.to.slice(2, 7)}`), unit: 'num', type: 'bar', series: [{ name: 'Transactions', data: x.statements.map((s) => s.txns), slot: 1 }, { name: 'Balance breaks', data: x.statements.map((s) => s.mismatches), slot: 5 }] } },
    { title: 'GSTR-3B: output tax vs ITC by GSTIN', spec: { categories: gstins, unit: 'inr', type: 'bar', series: [{ name: 'Output tax', data: gstins.map((gi) => x.gstr3b.filter((r) => r.gstin === gi).reduce((s, r) => s + r.outputTax, 0)) }, { name: 'ITC available', data: gstins.map((gi) => x.gstr3b.filter((r) => r.gstin === gi).reduce((s, r) => s + r.itc, 0)), slot: 1 }] } },
    { title: 'Tally — top parties by sales', spec: { categories: [...x.ledgerParties].sort((p, q) => Object.values(q.sales).reduce((s, v) => s + v, 0) - Object.values(p.sales).reduce((s, v) => s + v, 0)).slice(0, 10).map((p) => p.name.slice(0, 24)), unit: 'inr', type: 'hbar', series: [{ name: 'Sales vouchers', data: [...x.ledgerParties].sort((p, q) => Object.values(q.sales).reduce((s, v) => s + v, 0) - Object.values(p.sales).reduce((s, v) => s + v, 0)).slice(0, 10).map((p) => Object.values(p.sales).reduce((s, v) => s + v, 0)), slot: 2 }] }, height: 320 },
  ]} />;
}

/* ---------------- Overview (extra) ---------------- */
export function OverviewVisuals(ctx: PageCtx) {
  const g = ctx.a.gst, b = ctx.a.bank;
  const lf = g?.fys[g.fys.length - 1];
  const st = g?.states.find((s) => s.fy === lf);
  const buyers = lf ? g!.buyers[lf] || [] : [];
  const ad = b?.adjusted;
  return <Grid ctx={ctx} title="At a glance" cards={[
    st && { title: `Sales by state — ${lf}`, spec: { categories: st.rows.map((r) => r.state), unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'hbar', 'table'], series: [{ name: 'Sales', data: st.rows.map((r) => r.sales) }] } },
    buyers.length > 0 && { title: `Top 5 buyers — ${lf}`, spec: { categories: buyers.slice(0, 5).map((x) => x.name.slice(0, 26)), unit: 'inr', type: 'hbar', series: [{ name: 'Sales', data: buyers.slice(0, 5).map((x) => x.total) }] } },
    ad && { title: 'Where bank credits came from', spec: { categories: ['Business', 'Promoter / Director', 'Internal', 'Loans', 'Returns', 'Group', 'Non-business'], unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'hbar', 'table'], series: [{ name: 'Credits', data: [ad.adjusted, ad.promoter, ad.internal, ad.loans, ad.returns, ad.group, ad.nonBusiness] }] } },
    { title: 'SWOT balance', spec: { categories: ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'], unit: 'num', type: 'bar', series: [{ name: 'Items', data: [ctx.a.swot.counts.Strength, ctx.a.swot.counts.Weakness, ctx.a.swot.counts.Opportunity, ctx.a.swot.counts.Threat], slot: 1 }] } },
  ]} />;
}

/* ---------------- My Visuals starter set (until the user builds their own) ---------------- */
export function StarterVisuals(ctx: PageCtx) {
  const { a } = ctx;
  const fin = a.fin, g = a.gst, b = a.bank;
  const fys = fin?.fys || [];
  return <Grid ctx={ctx} title="Starter visuals — switch type with ⇄, or build your own above" cards={[
    fin && { title: 'Revenue & PAT', spec: { categories: fys, unit: 'inr', type: 'bar', series: series(ctx, fys, ['revenue', 'pat']) } },
    g && { title: 'GST sales trend', spec: { categories: g.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'area', series: [{ name: 'Sales', data: g.monthly.map((m) => m.revenue) }] } },
    g && { title: 'GST purchases trend', spec: { categories: g.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'area', series: [{ name: 'Purchases', data: g.monthly.map((m) => m.purchase), slot: 1 }] } },
    b && { title: 'Adjusted business inflow', spec: { categories: b.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'line', series: [{ name: 'Adjusted inflow', data: b.monthly.map((m) => m.adjustedInflow), slot: 2 }] } },
    b && { title: 'Credit entries per month', spec: { categories: b.months.map(monthLabel), unit: 'num', type: 'bar', series: [{ name: 'Entries', data: b.months.map((m) => b.creditEntries.perMonth[m] || 0), slot: 3 }] } },
    { title: 'Score by dimension', spec: { categories: a.risk.scores.filter((s) => s.score !== null).map((s) => s.name), unit: 'num', type: 'hbar', series: [{ name: 'Score', data: a.risk.scores.filter((s) => s.score !== null).map((s) => s.score) }] }, height: 320 },
  ]} />;
}
