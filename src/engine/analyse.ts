import type { Dataset, ManualInputs, FinancialData, BankingData } from './types';
import { analyseFinancial, type FinAnalysis } from './calcFinancial';
import { analyseGst, type GstAnalysis } from './calcGst';
import { analyseBanking, type BankAnalysis } from './calcBanking';
import { reconcile, type ReconAnalysis } from './reconcile';
import { assessRisk, type RiskAnalysis } from './risk';
import { buildSwot, type SwotResult } from './swot';

export interface Analysis {
  company: string;
  fin: FinAnalysis | null;
  gst: GstAnalysis | null;
  bank: BankAnalysis | null;
  recon: ReconAnalysis;
  risk: RiskAnalysis;
  swot: SwotResult;
  generatedAt: string;
}

/** One deterministic pass: same files + same inputs => same numbers, every time. */
export function analyse(ds0: Dataset, inp: ManualInputs): Analysis {
  const ds = effectiveDataset(ds0, inp);
  const fin = ds.financial ? analyseFinancial(ds.financial, inp) : null;
  const gst = ds.gst ? analyseGst(ds.gst, ds.financial?.gstFilings || []) : null;
  const bank = ds.banking ? analyseBanking(ds.banking, inp, ds.financial) : null;
  const recon = reconcile(ds.financial, fin, ds.gst, gst, bank, inp);
  const risk = assessRisk(ds.financial, fin, ds.gst, gst, bank, recon, inp);
  const company = ds.financial?.company || ds.gst?.company.replace(/\s*\(.*\)$/, '') || ds.banking?.company || 'Company';
  const base = { company, fin, gst, bank, recon, risk, generatedAt: new Date().toISOString() };
  return { ...base, swot: buildSwot({ ...base, swot: { items: [], counts: { Strength: 0, Weakness: 0, Opportunity: 0, Threat: 0 }, highRisks: 0, generatedFrom: [] } }, ds, inp) };
}

/** Apply user choices that change the data itself: hand-typed financial years (scanned statements)
    and the "latest 12 months only" banking window. */
export function effectiveDataset(ds: Dataset, inp: ManualInputs): Dataset {
  let financial = ds.financial;
  const manual = (inp.manualFYs || []).filter((f) => /^FY \d{4}-\d{2}$/.test(f));
  if (manual.length) {
    const base: FinancialData = financial || {
      company: ds.extra?.profile['Name'] || ds.gst?.company.replace(/\s*\(.*\)$/, '') || ds.banking?.company || '', fys: [], items: {}, rawRows: [],
      profile: { ...(ds.extra?.profile || {}) }, directors: (ds.extra?.directors || []).map((d) => ({ name: d.name, designation: d.designation, ceased: '' })), charges: [], gstFilings: [], flags: [],
    };
    const fys = [...new Set([...base.fys, ...manual])].sort();
    financial = { ...base, fys };
  }
  let banking: BankingData | null = ds.banking;
  if (banking && inp.bankLast12 && banking.months.length > 12) {
    const months = banking.months.slice(-12);
    banking = { ...banking, months, txns: banking.txns.filter((t) => months.includes(t.month)) };
  }
  return financial === ds.financial && banking === ds.banking ? ds : { ...ds, financial, banking };
}
