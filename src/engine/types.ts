// Core data model for INGOVIZ AI. Everything the dashboard shows is derived
// from these cleaned structures by deterministic code (no AI guesswork).

export type Matrix = (string | number | boolean | Date | null)[][];
export interface Workbook {
  fileName: string;
  sheets: Record<string, Matrix>;
  sheetOrder: string[];
}

export type FYMap = Record<string, number | null>; // "FY 2023-24" -> value

export interface CleaningLog {
  source: string;
  message: string;
  level: 'info' | 'warn';
}

/* ---------------- Financial statements ---------------- */
export interface FinancialData {
  company: string;
  fys: string[]; // ascending, e.g. ["FY 2021-22","FY 2022-23","FY 2023-24"]
  items: Record<string, FYMap>; // canonical key -> FY -> value
  rawRows: { sheet: string; label: string; key: string | null; values: FYMap }[];
  profile: Record<string, string>;
  directors: { name: string; designation: string; ceased: string }[];
  charges: { id: string; holder: string; amount: number; created: string; satisfied: string; assets: string; rate: string }[];
  gstFilings: GstFiling[]; // establishment-level filing list from the company report
  flags: { category: string; event: string; colour: string }[];
  associates?: { name: string; relationship: string }[]; // group / associate companies (common directorship)
}

/* ---------------- GST ---------------- */
export interface GstFiling {
  gstin: string;
  state: string;
  returnType: string; // GSTR3B / GSTR1
  fy: string;
  period: string; // "2024-04"
  due: string; // ISO date
  filed: string; // ISO date or ''
  delayDays: number;
}
export interface GstParty {
  name: string;
  gstin: string;
  monthly: Record<string, number>; // "2024-04" -> amount
  byFY: FYMap;
}
export interface GstData {
  company: string;
  gstins: string[];
  fys: string[];
  months: string[]; // "2023-04" ascending
  revenueMonthly: Record<string, number>;
  purchaseMonthly: Record<string, number>;
  revenueFY: FYMap;
  purchaseFY: FYMap;
  customers: GstParty[];
  suppliers: GstParty[];
  statesRevenue: { state: string; code: string; byFY: FYMap }[];
  statesPurchase: { state: string; code: string; byFY: FYMap }[];
  exportFY: FYMap;
  domesticFY: FYMap;
  intraGroupFY: FYMap;
  gstr1vs3b: { month: string; gstr1: number; gstr3b: number }[];
  filings: GstFiling[];
  taxRateEstimate: number | null; // total GST / taxable value
  hsn: { code: string; product: string; byFY: FYMap }[];
}

/* ---------------- Banking ---------------- */
export type TxnClass =
  | 'Business'
  | 'Internal / Self'
  | 'Promoter / Director'
  | 'Group / Related'
  | 'Loan Disbursal'
  | 'Return / Reversal'
  | 'Non-Business';

export interface BankTxn {
  id: number;
  date: string; // ISO yyyy-mm-dd
  month: string; // yyyy-mm
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  category: string;
  party: string;
  account: string;
  bank: string;
  source?: string; // evidence: file and page / sheet row the entry was read from
}
export interface BankAccount {
  account: string;
  bank: string;
  type: string;
  period: string;
  sanction: number | null;
}
export interface BankingData {
  company: string;
  accounts: BankAccount[];
  txns: BankTxn[];
  months: string[];
  summary: Record<string, string>;
  flags: { category: string; flag: string; description: string }[];
  relatedParties: { name: string; relationship: string }[];
}

/* ---------------- Manual inputs (things source files do not carry) ---------------- */
export interface ManualInputs {
  promoterNetWorth: number | null;
  principalRepayment: Record<string, number>; // FY -> principal repaid
  sanctionLimit: number | null;
  stockMarginPct: number; // DP margin on stock
  debtorMarginPct: number; // DP margin on debtors
  gstGrossUpPct: number; // GST rate used to gross-up taxable value before matching bank receipts
  fundingRequirement: number | null;
  purpose: string;
  proposedProduct: string;
  cibilScore: number | null;
  cmrRank: number | null;
  bureauNotes: string;
  dpdObserved: boolean;
  ageing: { bucket: string; receivable: number; payable: number }[];
  partyClassOverrides: Record<string, TxnClass>;
  financialOverrides: Record<string, Record<string, number>>; // key -> FY -> value
  manualFYs: string[]; // financial years typed in by hand when statements are scanned PDFs
  hidden: string[]; // page / section / visual keys the user has unticked (hidden everywhere incl. exports)
  bankLast12: boolean; // limit banking analysis to the latest 12 months
  pdfPasswords: string[];
  excludedSources: string[]; // data sources unticked in the Filters pane
  pdfDisclaimer: boolean; // print the Disclaimer / Declaration in PDF downloads
}

export const DEFAULT_INPUTS: ManualInputs = {
  promoterNetWorth: null,
  principalRepayment: {},
  sanctionLimit: null,
  stockMarginPct: 25,
  debtorMarginPct: 25,
  gstGrossUpPct: 18,
  fundingRequirement: null,
  purpose: '',
  proposedProduct: '',
  cibilScore: null,
  cmrRank: null,
  bureauNotes: '',
  dpdObserved: false,
  ageing: [
    { bucket: '0–30 Days', receivable: 0, payable: 0 },
    { bucket: '31–60 Days', receivable: 0, payable: 0 },
    { bucket: '61–90 Days', receivable: 0, payable: 0 },
    { bucket: '91–180 Days', receivable: 0, payable: 0 },
    { bucket: 'Above 180 Days', receivable: 0, payable: 0 },
  ],
  partyClassOverrides: {},
  financialOverrides: {},
  manualFYs: [],
  hidden: [],
  bankLast12: false,
  pdfPasswords: [],
  excludedSources: [],
  pdfDisclaimer: false,
};

export interface Dataset {
  financial: FinancialData | null;
  gst: GstData | null;
  banking: BankingData | null;
  files: { name: string; kind: 'financial' | 'gst' | 'banking' | 'unknown'; size: number; loadedAt: string }[];
  log: CleaningLog[];
  docs?: DocEntry[];
  extra?: ExtraData;
}

/* ---------------- Loan-file documents (folder / zip upload) ---------------- */
export interface DocEntry { path: string; size: number; type: string; status: 'used' | 'duplicate' | 'skipped' | 'needs password' | 'scanned' | 'error' | 'not used'; note: string }
export interface ExtraData {
  loans: import('./ingest/excelFormats').LoanRow[];
  ageing: import('./ingest/excelFormats').AgeingResult[];
  cibil: (import('./ingest/docsMisc').CibilCommercial | import('./ingest/docsMisc').CibilConsumer)[];
  networth: import('./ingest/docsMisc').NetWorthCert[];
  gstr3b: import('./ingest/gstr3b').Gstr3b[];
  profile: Record<string, string>;
  directors: { name: string; designation: string; appointed: string }[];
  gstCerts: { gstin: string; state: string; legalName: string; regDate: string; constitution?: string; tradeName?: string; address?: string }[];
  ledgerParties: import('./ingest/excelFormats').LedgerParty[];
  ledgerPeriod: string;
  momSales: import('./ingest/excelFormats').MomParty[];
  momPurchase: import('./ingest/excelFormats').MomParty[];
  statements: { file: string; account: string; bank: string; from: string; to: string; txns: number; mismatches: number }[];
}
