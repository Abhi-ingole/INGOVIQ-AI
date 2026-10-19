import type { Dataset, ManualInputs } from './types';
import { analyseFinancial, type FinAnalysis } from './calcFinancial';
import { analyseGst, type GstAnalysis } from './calcGst';
import { analyseBanking, type BankAnalysis } from './calcBanking';
import { reconcile, type ReconAnalysis } from './reconcile';
import { assessRisk, type RiskAnalysis } from './risk';

export interface Analysis {
  company: string;
  fin: FinAnalysis | null;
  gst: GstAnalysis | null;
  bank: BankAnalysis | null;
  recon: ReconAnalysis;
  risk: RiskAnalysis;
  generatedAt: string;
}

/** One deterministic pass: same files + same inputs => same numbers, every time. */
export function analyse(ds: Dataset, inp: ManualInputs): Analysis {
  const fin = ds.financial ? analyseFinancial(ds.financial, inp) : null;
  const gst = ds.gst ? analyseGst(ds.gst, ds.financial?.gstFilings || []) : null;
  const bank = ds.banking ? analyseBanking(ds.banking, inp, ds.financial) : null;
  const recon = reconcile(ds.financial, fin, ds.gst, gst, bank, inp);
  const risk = assessRisk(ds.financial, fin, ds.gst, gst, bank, recon, inp);
  const company = ds.financial?.company || ds.gst?.company.replace(/\s*\(.*\)$/, '') || ds.banking?.company || 'Company';
  return { company, fin, gst, bank, recon, risk, generatedAt: new Date().toISOString() };
}
