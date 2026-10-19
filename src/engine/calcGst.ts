import type { GstData, GstParty, FYMap, GstFiling } from './types';
import { div, growth, fyOfMonth, sortFYs } from './utils';

export interface Concentration { fy: string; total: number; top1: number | null; top5: number | null; top10: number | null; largestName: string; count: number; hhi: number | null; risk: string }
export interface PartyRow { name: string; gstin: string; state: string; total: number; share: number; months: number; trend: string; byFY: FYMap }

export interface GstAnalysis {
  fys: string[];
  months: string[];
  revenueFY: FYMap;
  purchaseFY: FYMap;
  revenueYoY: FYMap;
  monthly: { month: string; fy: string; revenue: number; purchase: number; ratio: number | null; margin: number }[];
  salesPurchaseFY: { fy: string; sales: number; purchase: number; ratio: number | null }[];
  unusualMonths: { month: string; note: string }[];
  concentration: { buyers: Concentration[]; suppliers: Concentration[] };
  buyers: Record<string, PartyRow[]>; // FY -> rows (sorted)
  suppliers: Record<string, PartyRow[]>;
  states: { fy: string; rows: { state: string; sales: number; salesPct: number; purchase: number; purchasePct: number }[] }[];
  geoConcentration: { fy: string; topState: string; share: number }[];
  exports: { fy: string; domestic: number; export: number; total: number; ratio: number | null; growth: number | null }[];
  exportDependency: string;
  intraGroup: { fy: string; amount: number; pct: number | null }[];
  relatedPartyDependency: string;
  filing: {
    rows: GstFiling[];
    byGstin: { gstin: string; state: string; returnType: string; total: number; late: number; avgDelay: number; maxDelay: number; lateFee: number; missing: string[] }[];
    summary: { totalReturns: number; lateReturns: number; latePct: number; avgDelay: number; maxDelay: number; estLateFee: number; missingPeriods: number; establishments: number };
    compliance: string;
  };
  gstr1vs3b: { month: string; gstr1: number; gstr3b: number; diff: number }[];
  hsn: GstData['hsn'];
}

function partyRows(parties: GstParty[], fy: string, total: number, stateByCode: (g: string) => string): PartyRow[] {
  return parties
    .map((p) => {
      const amt = p.byFY[fy] ?? 0;
      const mths = Object.keys(p.monthly).filter((m) => fyOfMonth(m) === fy).sort();
      const vals = mths.map((m) => p.monthly[m]);
      let trend = '—';
      if (vals.length >= 2) {
        const h = Math.floor(vals.length / 2);
        const a = vals.slice(0, h).reduce((s, x) => s + x, 0) / h;
        const b2 = vals.slice(h).reduce((s, x) => s + x, 0) / (vals.length - h);
        trend = b2 > a * 1.1 ? 'Growing' : b2 < a * 0.9 ? 'Declining' : 'Stable';
      } else if (vals.length === 1) trend = 'One-off';
      return { name: p.name, gstin: p.gstin, state: stateByCode(p.gstin), total: amt, share: total ? amt / total : 0, months: mths.length, trend, byFY: p.byFY };
    })
    // pseudo-parties (B2C / export / unregistered aggregates) are not single buyers — keep them out of rankings
    .filter((r) => r.total !== 0 && !/^except b2b|^b2c|unregistered|^others?$/i.test(r.name))
    .sort((a, b) => b.total - a.total);
}

function concentrationOf(rows: PartyRow[], fy: string, total: number): Concentration {
  const s = (n: number) => (total ? rows.slice(0, n).reduce((a, r) => a + r.total, 0) / total : null);
  const hhi = total ? rows.reduce((a, r) => a + (r.total / total) ** 2, 0) : null;
  const top5 = s(5);
  const risk = top5 === null ? 'N/A' : top5 > 0.75 ? 'High' : top5 > 0.5 ? 'Moderate' : 'Low';
  return { fy, total, top1: s(1), top5, top10: s(10), largestName: rows[0]?.name || '—', count: rows.length, hhi, risk };
}

export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

/** GST late fee estimate: ₹50/day (₹25 CGST + ₹25 SGST) per return, capped at ₹10,000 per return. Nil returns attract less; shown as estimate. */
const lateFeeOf = (days: number) => Math.min(Math.max(0, days) * 50, 10000);

export function analyseGst(g: GstData, extraFilings: GstFiling[] = []): GstAnalysis {
  const fys = sortFYs(Object.keys(g.revenueFY).length ? Object.keys(g.revenueFY) : g.months.map(fyOfMonth));
  const revenueYoY: FYMap = {};
  fys.forEach((fy, i) => (revenueYoY[fy] = i ? growth(g.revenueFY[fy], g.revenueFY[fys[i - 1]]) : null));
  const monthly = g.months.map((m) => {
    const r = g.revenueMonthly[m] ?? 0, p = g.purchaseMonthly[m] ?? 0;
    return { month: m, fy: fyOfMonth(m), revenue: r, purchase: p, ratio: div(r, p), margin: r - p };
  });
  const unusualMonths: GstAnalysis['unusualMonths'] = [];
  for (const m of monthly) {
    if (m.revenue === 0 && m.purchase > 0) unusualMonths.push({ month: m.month, note: 'Purchases booked with nil sales' });
    else if (m.ratio !== null && m.ratio > 2) unusualMonths.push({ month: m.month, note: `Sales ${m.ratio.toFixed(1)}× purchases` });
    else if (m.ratio !== null && m.ratio < 0.5 && m.revenue > 0) unusualMonths.push({ month: m.month, note: `Sales only ${(m.ratio * 100).toFixed(0)}% of purchases` });
  }
  const avgRev = monthly.length ? monthly.reduce((s, m) => s + m.revenue, 0) / monthly.filter((m) => m.revenue > 0).length || 1 : 0;
  for (const m of monthly) if (avgRev && m.revenue > 2.5 * avgRev) unusualMonths.push({ month: m.month, note: `Sales spike: ${(m.revenue / avgRev).toFixed(1)}× monthly average` });

  const salesPurchaseFY = fys.map((fy) => ({ fy, sales: g.revenueFY[fy] ?? 0, purchase: g.purchaseFY[fy] ?? 0, ratio: div(g.revenueFY[fy], g.purchaseFY[fy]) }));

  const stateByCode = (gstin: string) => STATE_CODES[gstin.slice(0, 2)] || '';
  const buyers: Record<string, PartyRow[]> = {};
  const suppliers: Record<string, PartyRow[]> = {};
  const cb: Concentration[] = [], cs: Concentration[] = [];
  for (const fy of fys) {
    const rt = g.revenueFY[fy] ?? g.customers.reduce((s, p) => s + (p.byFY[fy] ?? 0), 0);
    const pt = g.purchaseFY[fy] ?? g.suppliers.reduce((s, p) => s + (p.byFY[fy] ?? 0), 0);
    buyers[fy] = partyRows(g.customers, fy, rt, stateByCode);
    suppliers[fy] = partyRows(g.suppliers, fy, pt, stateByCode);
    cb.push(concentrationOf(buyers[fy], fy, rt));
    cs.push(concentrationOf(suppliers[fy], fy, pt));
  }

  const states = fys.map((fy) => {
    const names = new Set([...g.statesRevenue.map((s) => s.state), ...g.statesPurchase.map((s) => s.state)]);
    const rt = g.statesRevenue.reduce((s, x) => s + (x.byFY[fy] ?? 0), 0) + (g.exportFY[fy] ?? 0);
    const pt = g.statesPurchase.reduce((s, x) => s + (x.byFY[fy] ?? 0), 0);
    const rows = [...names].map((st) => {
      const sv = g.statesRevenue.find((x) => x.state === st)?.byFY[fy] ?? 0;
      const pv = g.statesPurchase.find((x) => x.state === st)?.byFY[fy] ?? 0;
      return { state: st, sales: sv, salesPct: rt ? sv / rt : 0, purchase: pv, purchasePct: pt ? pv / pt : 0 };
    }).filter((r) => r.sales || r.purchase).sort((a, b) => b.sales - a.sales || b.purchase - a.purchase);
    return { fy, rows };
  });
  const geoConcentration = states.map((s) => ({ fy: s.fy, topState: s.rows[0]?.state || '—', share: s.rows[0]?.salesPct || 0 }));

  const exportsArr = fys.map((fy, i) => {
    const ex = g.exportFY[fy] ?? 0;
    const tot = g.revenueFY[fy] ?? 0;
    return { fy, domestic: tot - ex, export: ex, total: tot, ratio: div(ex, tot), growth: i ? growth(ex, g.exportFY[fys[i - 1]] ?? 0) : null };
  });
  const lastEx = exportsArr[exportsArr.length - 1]?.ratio ?? 0;
  const exportDependency = lastEx > 0.5 ? 'High' : lastEx > 0.2 ? 'Moderate' : 'Low';

  const intraGroup = fys.map((fy) => ({ fy, amount: g.intraGroupFY[fy] ?? 0, pct: div(g.intraGroupFY[fy] ?? 0, g.revenueFY[fy]) }));
  const maxIg = Math.max(0, ...intraGroup.map((x) => x.pct ?? 0));
  const relatedPartyDependency = maxIg > 0.25 ? 'High' : maxIg > 0.1 ? 'Moderate' : 'Low';

  // filings: GST report + company report establishment list, de-duplicated
  const seen = new Set<string>();
  const rows: GstFiling[] = [];
  for (const f of [...g.filings, ...extraFilings]) {
    const k = `${f.gstin}|${f.returnType}|${f.period}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(f);
  }
  rows.sort((a, b) => a.gstin.localeCompare(b.gstin) || a.returnType.localeCompare(b.returnType) || a.period.localeCompare(b.period));
  const groups = new Map<string, GstFiling[]>();
  for (const r of rows) { const k = `${r.gstin}|${r.returnType}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const byGstin = [...groups.entries()].map(([k, list]) => {
    const [gstin, returnType] = k.split('|');
    const late = list.filter((x) => x.delayDays > 0);
    const periods = new Set(list.map((x) => x.period));
    const missing: string[] = [];
    const first = list[0].period, lastP = list[list.length - 1].period;
    let [y, m] = first.split('-').map(Number);
    while (`${y}-${String(m).padStart(2, '0')}` <= lastP) {
      const p = `${y}-${String(m).padStart(2, '0')}`;
      if (!periods.has(p)) missing.push(p);
      m++; if (m > 12) { m = 1; y++; }
    }
    return {
      gstin, returnType, state: list.find((x) => x.state)?.state || STATE_CODES[gstin.slice(0, 2)] || '',
      total: list.length, late: late.length,
      avgDelay: late.length ? late.reduce((s, x) => s + x.delayDays, 0) / late.length : 0,
      maxDelay: Math.max(0, ...list.map((x) => x.delayDays)),
      lateFee: list.reduce((s, x) => s + lateFeeOf(x.delayDays), 0),
      missing,
    };
  });
  const lateAll = rows.filter((x) => x.delayDays > 0);
  const summary = {
    totalReturns: rows.length,
    lateReturns: lateAll.length,
    latePct: rows.length ? lateAll.length / rows.length : 0,
    avgDelay: lateAll.length ? lateAll.reduce((s, x) => s + x.delayDays, 0) / lateAll.length : 0,
    maxDelay: Math.max(0, ...rows.map((x) => x.delayDays)),
    estLateFee: byGstin.reduce((s, x) => s + x.lateFee, 0),
    missingPeriods: byGstin.reduce((s, x) => s + x.missing.length, 0),
    establishments: new Set(rows.map((r) => r.gstin)).size,
  };
  const compliance = !rows.length ? 'No filing data' : summary.latePct <= 0.1 && summary.maxDelay <= 15 ? 'Regular' : summary.latePct <= 0.3 && summary.maxDelay <= 30 ? 'Minor Delays' : summary.latePct <= 0.6 ? 'Irregular' : 'High Concern';

  return {
    fys, months: g.months, revenueFY: g.revenueFY, purchaseFY: g.purchaseFY, revenueYoY, monthly, salesPurchaseFY, unusualMonths,
    concentration: { buyers: cb, suppliers: cs }, buyers, suppliers, states, geoConcentration,
    exports: exportsArr, exportDependency, intraGroup, relatedPartyDependency,
    filing: { rows, byGstin, summary, compliance },
    gstr1vs3b: g.gstr1vs3b.map((x) => ({ ...x, diff: x.gstr3b - x.gstr1 })),
    hsn: g.hsn,
  };
}
