import type { ManualInputs, FinancialData, GstData } from './types';
import type { FinAnalysis } from './calcFinancial';
import type { GstAnalysis } from './calcGst';
import type { BankAnalysis } from './calcBanking';
import { div, fyOfMonth, nameSimilarity, sortFYs, monthLabel } from './utils';

export interface ReconRow { fy: string; financial: number | null; gst: number | null; gstMonths: number; bankGross: number | null; bankAdjusted: number | null; bankMonths: number; varGst: number | null; varBank: number | null; status: string; remarks: string[] }
export interface PartyMatch { gstParty: string; gstin: string; gstAmount: number; gstGross: number; bankParty: string; bankAmount: number; score: number; variance: number | null; status: string }

export interface ReconAnalysis {
  fyRows: ReconRow[];
  overlap: null | {
    months: string[]; lagNote: string; label: string; gstTaxable: number; gstGross: number; bankGross: number; internal: number; loans: number; returns: number; promoter: number; group: number;
    bankAdjusted: number; variance: number | null; status: string; monthly: { month: string; gst: number; gstGross: number; bankAdjusted: number; bankGross: number }[];
  };
  bto: { bankTurnover: number; months: number; annualised: number; gstSamePeriod: number | null; financialLatest: number | null; btoToGst: number | null; btoToFinancial: number | null };
  buyers: { rows: PartyMatch[]; unmatchedBankCredits: { party: string; amount: number }[]; matchedShare: number | null };
  suppliers: { rows: PartyMatch[]; unmatchedBankDebits: { party: string; amount: number }[]; matchedShare: number | null };
  coverageNote: string | null;
  overallStatus: string;
}

export function statusOf(v: number | null): string {
  if (v === null) return 'Not comparable';
  const a = Math.abs(v);
  if (a <= 0.05) return 'MATCHED';
  if (a <= 0.15) return 'ACCEPTABLE VARIANCE';
  if (a <= 0.3) return 'MATERIAL VARIANCE';
  return 'INVESTIGATION REQUIRED';
}

function matchParties(gstRows: { name: string; gstin: string; amount: number }[], bank: { party: string; amount: number }[], gross: number): { rows: PartyMatch[]; unmatched: { party: string; amount: number }[] } {
  const used = new Set<number>();
  const rows: PartyMatch[] = gstRows.map((g) => {
    let best = -1, bestS = 0;
    bank.forEach((b, i) => {
      const s = nameSimilarity(g.name, b.party);
      if (s > bestS) { bestS = s; best = i; }
    });
    // aggregate every bank party that matches this GST party well (narrations vary)
    let bankAmount = 0;
    const names: string[] = [];
    if (bestS >= 0.6) bank.forEach((b, i) => { if (nameSimilarity(g.name, b.party) >= 0.6) { bankAmount += b.amount; used.add(i); names.push(b.party); } });
    const gGross = g.amount * (1 + gross);
    const variance = bankAmount ? (bankAmount - gGross) / gGross : null;
    const status = !bankAmount ? 'No banking receipt found' : Math.abs(variance!) <= 0.1 ? 'Matched' : Math.abs(variance!) <= 0.3 ? 'Partially matched' : 'Large difference';
    return { gstParty: g.name, gstin: g.gstin, gstAmount: g.amount, gstGross: gGross, bankParty: names.slice(0, 3).join('; ') || (best >= 0 && bestS > 0.3 ? `(closest: ${bank[best].party})` : '—'), bankAmount, score: bestS, variance, status };
  });
  const unmatched = bank.filter((_, i) => !used.has(i)).sort((a, b) => b.amount - a.amount);
  return { rows, unmatched };
}

export function reconcile(fd: FinancialData | null, fin: FinAnalysis | null, gd: GstData | null, gst: GstAnalysis | null, bank: BankAnalysis | null, inp: ManualInputs): ReconAnalysis {
  const grossUp = inp.gstGrossUpPct / 100;
  const fys = sortFYs([...(fin?.fys || []), ...(gst?.fys || []), ...(bank?.fy || [])]);
  const gstMonthsIn = (fy: string) => (gst?.monthly || []).filter((m) => m.fy === fy && (m.revenue || m.purchase)).length;
  const fyRows: ReconRow[] = fys.map((fy) => {
    const financial = fin?.base.revenue?.[fy] ?? null;
    const gm = gstMonthsIn(fy);
    const gstV = gst ? gst.revenueFY[fy] ?? null : null;
    const bm = bank ? bank.monthly.filter((m) => fyOfMonth(m.month) === fy) : [];
    const bankGross = bm.length ? bm.reduce((a, m) => a + m.inflow, 0) : null;
    const bankAdj = bm.length ? bm.reduce((a, m) => a + m.adjustedInflow, 0) : null;
    const varGst = financial !== null && gstV !== null && financial ? (gstV - financial) / financial : null;
    const varBank = financial !== null && bankAdj !== null && financial && bm.length >= 12 ? (bankAdj / (1 + grossUp) - financial) / financial : null;
    const remarks: string[] = [];
    if (gstV !== null && gm && gm < 12) remarks.push(`GST data covers ${gm} month(s) of this year`);
    if (bm.length && bm.length < 12) remarks.push(`Banking covers ${bm.length} month(s) — not comparable with a full-year figure`);
    if (financial === null && (gstV !== null || bankAdj !== null)) remarks.push('Audited financials not available for this year');
    if (varGst !== null && varGst < -0.15) remarks.push('GST turnover lower than books — check GSTINs not covered, unregistered/export sales or job-work income');
    if (varGst !== null && varGst > 0.15) remarks.push('GST turnover higher than books — check stock transfers between own GSTINs, credit notes or timing');
    const base = statusOf(varGst ?? varBank);
    const status = base !== 'Not comparable' && gm < 12 ? `${base} (partial GST year)` : base;
    return { fy, financial, gst: gstV, gstMonths: gm, bankGross, bankAdjusted: bankAdj, bankMonths: bm.length, varGst, varBank, status, remarks };
  });

  // establishment coverage (GSTINs in GST data vs all GSTINs of the entity)
  let coverageNote: string | null = null;
  if (fd?.gstFilings.length && gd?.gstins.length) {
    const all = [...new Set(fd.gstFilings.map((f) => f.gstin))];
    const missing = all.filter((g) => !gd.gstins.includes(g));
    if (missing.length) coverageNote = `GST data covers ${gd.gstins.length} of ${all.length} registered GSTINs. Not covered: ${missing.map((m) => `${m} (${fd.gstFilings.find((f) => f.gstin === m)?.state || ''})`).join(', ')}. Turnover of these establishments is in the books but not in the GST analysis.`;
  }

  // overlap period GST vs banking (month-matched)
  let overlap: ReconAnalysis['overlap'] = null;
  if (gst && bank) {
    const months = bank.months.filter((m) => gst.months.includes(m) && (gd?.revenueMonthly[m] ?? 0) > 0);
    if (months.length) {
      const bm = bank.monthly.filter((m) => months.includes(m.month));
      const inSet = (d: string) => months.includes(d);
      const sumCls = (c: string) => bank.txns.filter((t) => inSet(t.month) && t.cls === c).reduce((a, t) => a + t.credit, 0);
      const gstTaxable = months.reduce((a, m) => a + (gd!.revenueMonthly[m] ?? 0), 0);
      const gstGross = gstTaxable * (1 + grossUp);
      const bankAdjusted = bm.reduce((a, m) => a + m.adjustedInflow, 0);
      const variance = div(bankAdjusted - gstGross, gstGross);
      const lagNote = fin && fin.wc.length && (fin.wc[fin.wc.length - 1].debtorDays ?? 0) > 60 ? `Debtor days of ${Math.round(fin.wc[fin.wc.length - 1].debtorDays!)} mean receipts lag sales by ~${Math.round((fin.wc[fin.wc.length - 1].debtorDays ?? 0) / 30)} month(s); part of the gap is timing.` : '';
      overlap = {
        lagNote,
        months, label: `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])} (${months.length} months)`,
        gstTaxable, gstGross, bankGross: bm.reduce((a, m) => a + m.inflow, 0),
        internal: sumCls('Internal / Self'), loans: sumCls('Loan Disbursal'), returns: sumCls('Return / Reversal'), promoter: sumCls('Promoter / Director'), group: sumCls('Group / Related'),
        bankAdjusted, variance, status: statusOf(variance),
        monthly: months.map((m) => ({ month: m, gst: gd!.revenueMonthly[m] ?? 0, gstGross: (gd!.revenueMonthly[m] ?? 0) * (1 + grossUp), bankAdjusted: bank.monthly.find((x) => x.month === m)!.adjustedInflow, bankGross: bank.monthly.find((x) => x.month === m)!.inflow })),
      };
    }
  }

  // BTO
  const bankTurnover = bank?.adjusted.adjusted ?? 0;
  const bMonths = bank?.months.length ?? 0;
  const lastFinFY = fin?.fys[fin.fys.length - 1];
  const financialLatest = lastFinFY ? fin!.base.revenue[lastFinFY] ?? null : null;
  const annualised = bMonths ? (bankTurnover / bMonths) * 12 : 0;
  const bto = {
    bankTurnover, months: bMonths, annualised,
    gstSamePeriod: overlap ? overlap.gstGross : null,
    financialLatest,
    btoToGst: overlap ? div(overlap.bankAdjusted, overlap.gstGross) : null,
    btoToFinancial: financialLatest ? div(annualised / (1 + grossUp), financialLatest) : null,
  };

  // party-wise triangular reconciliation on the overlap months (or the latest GST FY)
  const months = overlap?.months || [];
  const gstBuyers = (gd?.customers || []).map((p) => ({ name: p.name, gstin: p.gstin, amount: months.reduce((a, m) => a + (p.monthly[m] ?? 0), 0) })).filter((x) => x.amount > 0 && !/^except b2b|^b2c|unregistered|^others?$/i.test(x.name)).sort((a, b) => b.amount - a.amount);
  const gstSuppliers = (gd?.suppliers || []).map((p) => ({ name: p.name, gstin: p.gstin, amount: months.reduce((a, m) => a + (p.monthly[m] ?? 0), 0) })).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
  const agg = (side: 'credit' | 'debit') => {
    const map = new Map<string, number>();
    for (const t of bank?.txns || []) {
      if (!months.includes(t.month) || t[side] <= 0) continue;
      if (t.cls !== 'Business' && t.cls !== 'Group / Related') continue;
      map.set(t.counterparty, (map.get(t.counterparty) || 0) + t[side]);
    }
    return [...map.entries()].map(([party, amount]) => ({ party, amount }));
  };
  const b1 = matchParties(gstBuyers, agg('credit'), grossUp);
  const s1 = matchParties(gstSuppliers, agg('debit'), grossUp);
  const sharePct = (rows: PartyMatch[]) => { const t = rows.reduce((a, r) => a + r.gstAmount, 0); return t ? rows.filter((r) => r.bankAmount > 0).reduce((a, r) => a + r.gstAmount, 0) / t : null; };

  const statuses = [...fyRows.filter((r) => r.gstMonths >= 12).map((r) => r.status), overlap?.status].filter((s): s is string => !!s && s !== 'Not comparable');
  const order = ['MATCHED', 'ACCEPTABLE VARIANCE', 'MATERIAL VARIANCE', 'INVESTIGATION REQUIRED'];
  const overallStatus = statuses.length ? order[Math.max(...statuses.map((s) => order.indexOf(s)))] : 'Not comparable';

  return {
    fyRows, overlap, bto,
    buyers: { rows: b1.rows, unmatchedBankCredits: b1.unmatched.slice(0, 25), matchedShare: sharePct(b1.rows) },
    suppliers: { rows: s1.rows, unmatchedBankDebits: s1.unmatched.slice(0, 25), matchedShare: sharePct(s1.rows) },
    coverageNote, overallStatus,
  };
}
