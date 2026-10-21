import type { BankingData, BankTxn, ManualInputs, TxnClass, FinancialData } from './types';
import { nameTokens, div, fyOfMonth } from './utils';

export interface ClassifiedTxn extends BankTxn { counterparty: string; cls: TxnClass; reason: string }

export interface BankAnalysis {
  months: string[];
  fy: string[];
  txns: ClassifiedTxn[];
  monthly: {
    month: string; inflow: number; outflow: number; net: number; adjustedInflow: number; closing: number | null;
    credits: number; debits: number; cash: number; inwardReturns: number; outwardReturns: number; emi: number; interest: number; loans: number; internalIn: number; internalOut: number;
  }[];
  totals: { inflow: number; outflow: number; net: number; avgInflow: number; avgOutflow: number; peakMonth: string; lowMonth: string; volatility: number | null; trend: string };
  adjusted: { gross: number; returns: number; loans: number; internal: number; promoter: number; group: number; nonBusiness: number; adjusted: number };
  returns: {
    inward: { count: number; amount: number; months: number; items: ClassifiedTxn[] };
    outward: { count: number; amount: number; months: number; items: ClassifiedTxn[] };
    ecsNachEmi: { count: number; amount: number; items: ClassifiedTxn[] };
    penal: { count: number; amount: number; items: ClassifiedTxn[] };
    charges: { count: number; amount: number };
    risk: string;
  };
  creditEntries: { total: number; monthlyAvg: number; avgAmount: number; largest: ClassifiedTxn[]; perMonth: Record<string, number> };
  parties: { inflow: { party: string; amount: number; share: number; count: number; cls: TxnClass }[]; outflow: { party: string; amount: number; share: number; count: number; cls: TxnClass }[] };
  partyClasses: { party: string; cls: TxnClass; reason: string; credit: number; debit: number; count: number }[];
  loans: { date: string; description: string; amount: number; type: string; account: string }[];
  emi: { date: string; description: string; amount: number }[];
  interest: { month: string; amount: number }[];
  cash: { total: number; count: number; pctOfCredits: number | null; monthly: Record<string, number>; large: ClassifiedTxn[] };
  utilisation: {
    account: string; limit: number | null; limitSource: string; avgUtil: number | null; peakUtil: number | null; minUtil: number | null; daysAbove90: number; overdrawnDays: number; days: number; classification: string;
    daily: { date: string; balance: number }[];
  }[];
  internalTxns: ClassifiedTxn[];
  conduct: string;
}

/* counterparty from party column, else from the narration */
export function counterpartyOf(t: BankTxn): string {
  if (t.party && !/^(na|none|nan|-)$/i.test(t.party)) return t.party;
  const d = t.description.replace(/\s+/g, ' ');
  let m = d.match(/^(?:RTGS|NEFT)\s*(?:Cr|Dr)?-[A-Z0-9]{11}-([^-]+)-/i);
  if (m) return m[1].trim();
  m = d.match(/^IMPS\/[^/]*\/[^/]*\/[^/]*\/[^/]*\/[^/]*\/([^/]+)/i) || d.match(/^UPI\/[^/]*\/[^/]*\/([^/]+)/i);
  if (m) return m[1].trim();
  m = d.match(/^CMS-[A-Z0-9-]+\s+(.+)$/i);
  if (m) return m[1].trim();
  return d.slice(0, 40);
}

function lev1(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return true;
}

/** counterparty is the company itself (own account / FD) when its significant tokens are a prefix of the company's tokens */
function isSelf(cp: string, companyTok: string[]): boolean {
  if (!companyTok.length) return false;
  const joined = companyTok.join('');
  let tok = nameTokens(cp);
  if (!tok.length) return false;
  // allow concatenated forms: "sarangimetal", "sarangimetalworksinternatio"
  if (companyTok.length > 1 && tok[0].length >= 8 && (joined.startsWith(tok[0]) || tok[0].startsWith(joined))) return true;
  tok = tok.slice(0, companyTok.length);
  return tok.every((t, i) => lev1(t, companyTok[i]) || (t.length >= 4 && companyTok[i].startsWith(t)));
}

function containsPerson(cp: string, person: string[]): boolean {
  if (person.length < 2) return false;
  const tok = new Set(nameTokens(cp));
  return person.every((p) => tok.has(p));
}

/** letters/digits only, legal-form words removed: "New Modern Technomech Pvt. Ltd." -> "newmoderntechnomech" */
export function coreName(s: string): string {
  return s.toLowerCase().replace(/m\/s\.?/g, ' ').replace(/[^a-z0-9]+/g, '')
    .replace(/(privatelimited|privatelimite|privatelimi|pvtltd|private|limited|pvt|ltd|llp|india)+$/g, '').replace(/(privatelimited|pvtltd)/g, '');
}
/** remitter / beneficiary names written in an RTGS / NEFT / IMPS narration */
function narrationNames(desc: string): string[] {
  const d = desc.replace(/\s+/g, ' ');
  const m = d.match(/^(?:RTGS|NEFT)\s*(?:Cr|Dr|O\/W|I\/W)?-[A-Z0-9]{11}-([^-]+)-([^-]+)/i);
  return m ? [m[1].trim(), m[2].trim()] : [];
}
/** same entity when one core name contains the other (min. 8 letters) — handles truncated / joined bank narrations */
function sameEntity(a: string, b: string): boolean {
  const x = coreName(a), y = coreName(b);
  if (x.length < 8 || y.length < 8) return false;
  return x.includes(y) || y.includes(x) || (x.length >= 12 && y.length >= 12 && x.slice(0, 12) === y.slice(0, 12));
}
/** credits from banks / NBFCs that are borrowings, not sales receipts */
const LENDER_RE = /\b(capital services?|capitalservices|finance (ltd|limited|pvt|private|company)|financial services|finserv|fincorp|india credit|indiacredit|credit (ltd|limited|pvt|private)|housing finance|nbfc|leasing|clix|smfg|lendingkart|bajaj fin|tata capital|aditya birla capital|iifl|shriram fin|indifi|neogrowth|flexiloans|ugro|capital float)\b/i;

export function classify(t: BankTxn, ctx: { companyTok: string[]; company?: string; directors: string[][]; related: { tok: string[]; relationship: string; name?: string }[]; overrides: Record<string, TxnClass> }): { cls: TxnClass; reason: string; counterparty: string } {
  const cp = counterpartyOf(t);
  const ov = ctx.overrides[cp.toLowerCase()];
  if (ov) return { cls: ov, reason: 'Manual classification', counterparty: cp };
  const cat = t.category.toLowerCase();
  const desc = t.description.toLowerCase();
  if (t.credit > 0 && (/bounce|reversal|return/.test(cat) || /\breturn\b|\(rej\)|rejected|reversal/.test(desc))) return { cls: 'Return / Reversal', reason: `Returned / reversed entry (${t.category || 'narration'})`, counterparty: cp };
  if (/loan disburs/.test(cat) || /loan disb/.test(desc)) return { cls: 'Loan Disbursal', reason: 'Loan disbursal credit', counterparty: cp };
  if (/internal/.test(cat)) return { cls: 'Internal / Self', reason: `Bank category "${t.category}"`, counterparty: cp };
  if (isSelf(cp, ctx.companyTok) || /fd creation|fixed deposit|sweep/.test(desc)) return { cls: 'Internal / Self', reason: 'Counterparty is the company itself (own account / FD)', counterparty: cp };
  // own-account transfers that the bank narration shows only partly ("CMS-A2A …", party column holding the tail of the company name, RTGS remitter = company)
  const co = ctx.company || '';
  const coCore = coreName(co);
  if (/^cms-a2a/i.test(t.description.trim()) && coCore && coreName(t.description).includes(coCore.slice(0, 10))) return { cls: 'Internal / Self', reason: 'Account-to-account (CMS-A2A) transfer in the company\'s own name', counterparty: cp };
  if (coCore.length >= 12 && coreName(cp).length >= 10 && coCore.includes(coreName(cp))) return { cls: 'Internal / Self', reason: 'Counterparty name is part of the company\'s own name (own account)', counterparty: cp };
  const nn = narrationNames(t.description);
  if (t.credit > 0 && nn.length && co && sameEntity(nn[0], co)) return { cls: 'Internal / Self', reason: 'Remitter in the narration is the company itself (own account)', counterparty: nn[0] };
  for (const d of ctx.directors) if (containsPerson(cp, d)) return { cls: 'Promoter / Director', reason: `Matches director ${d.join(' ')}`, counterparty: cp };
  const remitter = t.credit > 0 && nn.length ? nn[0] : t.debit > 0 && nn.length > 1 ? nn[1] : '';
  for (const r of ctx.related) {
    if ((r.tok.length && r.tok.slice(0, 2).every((x) => nameTokens(cp).includes(x))) || (r.name && (sameEntity(cp, r.name) || (remitter && sameEntity(remitter, r.name)) || (coreName(r.name).length >= 8 && coreName(t.description).includes(coreName(r.name)))))) {
      return /director|promoter|kmp/i.test(r.relationship) && !/group company|common directorship|associate|subsidiary|holding/i.test(r.relationship)
        ? { cls: 'Promoter / Director', reason: `Related party (${r.relationship})`, counterparty: cp }
        : { cls: 'Group / Related', reason: `Related party (${r.relationship})`, counterparty: cp };
    }
  }
  if (t.credit > 0 && (LENDER_RE.test(cp) || LENDER_RE.test(remitter))) return { cls: 'Loan Disbursal', reason: 'Credit from a bank / NBFC — borrowing, not a business receipt', counterparty: cp };
  if (t.credit > 0 && /interest (received|credit)|refund|dividend|insurance claim|subsidy/.test(cat + ' ' + desc)) return { cls: 'Non-Business', reason: 'Non-operating credit', counterparty: cp };
  return { cls: 'Business', reason: 'Trade / business transaction', counterparty: cp };
}

export function analyseBanking(bd: BankingData, inp: ManualInputs, fin: FinancialData | null): BankAnalysis {
  const company = fin?.company || bd.company;
  const companyTok = nameTokens(company).slice(0, 2);
  const directors = (fin?.directors || []).map((d) => nameTokens(d.name)).filter((x) => x.length >= 2);
  const relSrc = [...bd.relatedParties, ...(fin?.associates || []).map((x) => ({ name: x.name, relationship: /director|promoter|kmp/i.test(x.relationship) && !/common directorship/i.test(x.relationship) ? x.relationship : `Group company (${x.relationship || 'associate'})` }))];
  const related = relSrc.filter((r, i, arr) => arr.findIndex((y) => coreName(y.name) === coreName(r.name)) === i).map((r) => ({ tok: nameTokens(r.name), relationship: r.relationship, name: r.name }));
  const overrides: Record<string, TxnClass> = {};
  for (const [k, v] of Object.entries(inp.partyClassOverrides || {})) overrides[k.toLowerCase()] = v;
  const ctx = { companyTok, company, directors, related, overrides };

  const txns: ClassifiedTxn[] = bd.txns.map((t) => ({ ...t, ...classify(t, ctx) }));
  const months = bd.months;
  const cat = (t: BankTxn) => t.category.toLowerCase();
  const isCash = (t: BankTxn) => t.credit > 0 && (/cash deposit/.test(cat(t)) || /^(by )?cash|cash dep/i.test(t.description));
  const isInwardReturn = (t: BankTxn) => t.credit > 0 && (/inward.*bounce|inward payment bounce|i\/w return/.test(cat(t)) || /\(rej\)|funds insufficient/i.test(t.description));
  const isOutwardReturn = (t: BankTxn) => t.debit > 0 && (/outward.*(bounce|return)|o\/w return/.test(cat(t)) || /o\/w.*ret|chq ret|cheque return/i.test(t.description));
  const isEcsReturn = (t: BankTxn) => /(ach|nach|ecs|emi).*(return|bounce|rtn|unpaid)|(return|bounce).*(ach|nach|ecs|emi)/i.test(t.category + ' ' + t.description) && !/charges?/i.test(t.category);
  const isPenal = (t: BankTxn) => t.debit > 0 && /penal/i.test(t.category + ' ' + t.description);
  const isCharge = (t: BankTxn) => t.debit > 0 && /(bounce|return).*charges?|charges?.*(bounce|return)/i.test(t.category + ' ' + t.description);
  const isEmi = (t: BankTxn) => t.debit > 0 && (/^emi$/.test(cat(t)) || /\bemi\b|loan repay/i.test(t.description));
  const isInterest = (t: BankTxn) => t.debit > 0 && (/interest paid/.test(cat(t)) || /int(erest)?\.? (debit|capitali|coll)/i.test(t.description));

  // closing balance per account per month (last transaction of month)
  const accts = [...new Set(txns.map((t) => t.account))];
  const lastBal: Record<string, Record<string, number>> = {};
  for (const t of txns) if (t.balance !== null) (lastBal[t.account] ||= {})[t.month] = t.balance;

  const monthly = months.map((m) => {
    const mt = txns.filter((t) => t.month === m);
    const s = (f: (t: ClassifiedTxn) => number) => mt.reduce((a, t) => a + f(t), 0);
    let closing: number | null = 0;
    for (const a of accts) {
      let v: number | undefined;
      for (const mm of months) { if (mm > m) break; if (lastBal[a]?.[mm] !== undefined) v = lastBal[a][mm]; }
      if (v === undefined) continue;
      closing += v;
    }
    if (!accts.some((a) => lastBal[a])) closing = null;
    return {
      month: m,
      inflow: s((t) => t.credit),
      outflow: s((t) => t.debit),
      net: s((t) => t.credit - t.debit),
      adjustedInflow: s((t) => (t.cls === 'Business' ? t.credit : 0)),
      closing,
      credits: mt.filter((t) => t.credit > 0).length,
      debits: mt.filter((t) => t.debit > 0).length,
      cash: s((t) => (isCash(t) ? t.credit : 0)),
      inwardReturns: s((t) => (isInwardReturn(t) ? t.credit : 0)),
      outwardReturns: s((t) => (isOutwardReturn(t) ? t.debit : 0)),
      emi: s((t) => (isEmi(t) ? t.debit : 0)),
      interest: s((t) => (isInterest(t) ? t.debit : 0)),
      loans: s((t) => (t.cls === 'Loan Disbursal' ? t.credit : 0)),
      internalIn: s((t) => (t.cls === 'Internal / Self' ? t.credit : 0)),
      internalOut: s((t) => (t.cls === 'Internal / Self' ? t.debit : 0)),
    };
  });

  const inflow = monthly.reduce((a, m) => a + m.inflow, 0);
  const outflow = monthly.reduce((a, m) => a + m.outflow, 0);
  const nM = monthly.length || 1;
  const sortedIn = [...monthly].sort((a, b) => b.inflow - a.inflow);
  const mean = inflow / nM;
  const sd = Math.sqrt(monthly.reduce((a, m) => a + (m.inflow - mean) ** 2, 0) / nM);
  const volatility = mean ? sd / mean : null;
  const adjSeries = monthly.map((m) => m.adjustedInflow);
  const half = Math.floor(adjSeries.length / 2);
  const firstH = adjSeries.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1);
  const secondH = adjSeries.slice(half).reduce((a, b) => a + b, 0) / ((adjSeries.length - half) || 1);
  const trend = volatility !== null && volatility > 0.6 ? 'Volatile' : secondH > firstH * 1.1 ? 'Increasing' : secondH < firstH * 0.9 ? 'Declining' : 'Stable';

  const sumCls = (c: TxnClass) => txns.reduce((a, t) => a + (t.cls === c ? t.credit : 0), 0);
  const adjusted = {
    gross: inflow,
    returns: sumCls('Return / Reversal'),
    loans: sumCls('Loan Disbursal'),
    internal: sumCls('Internal / Self'),
    promoter: sumCls('Promoter / Director'),
    group: sumCls('Group / Related'),
    nonBusiness: sumCls('Non-Business'),
    adjusted: sumCls('Business'),
  };

  const pick = (f: (t: ClassifiedTxn) => boolean) => txns.filter(f);
  const inwardItems = pick(isInwardReturn);
  const outwardItems = pick(isOutwardReturn);
  const ecsItems = pick(isEcsReturn);
  const penalItems = pick(isPenal);
  const chargeItems = pick(isCharge);
  const totalDebitCount = txns.filter((t) => t.debit > 0).length;
  const inwardPct = totalDebitCount ? inwardItems.length / totalDebitCount : 0;
  const returnsRisk = !inwardItems.length && !outwardItems.length && !ecsItems.length ? 'Nil' : inwardPct <= 0.01 && !ecsItems.length ? 'Low' : inwardPct <= 0.03 ? 'Moderate' : 'High';

  const creditTx = txns.filter((t) => t.credit > 0 && t.cls !== 'Return / Reversal');
  const perMonth: Record<string, number> = {};
  for (const t of creditTx) perMonth[t.month] = (perMonth[t.month] || 0) + 1;

  const partyAgg = (side: 'credit' | 'debit') => {
    const map = new Map<string, { amount: number; count: number; cls: TxnClass }>();
    for (const t of txns) {
      const v = t[side];
      if (v <= 0 || t.cls === 'Return / Reversal') continue;
      const key = t.counterparty || '(unidentified)';
      const e = map.get(key) || { amount: 0, count: 0, cls: t.cls };
      e.amount += v; e.count++;
      map.set(key, e);
    }
    const tot = [...map.values()].reduce((a, e) => a + e.amount, 0);
    return [...map.entries()].map(([party, e]) => ({ party, amount: e.amount, count: e.count, cls: e.cls, share: tot ? e.amount / tot : 0 })).sort((a, b) => b.amount - a.amount);
  };

  const pc = new Map<string, { cls: TxnClass; reason: string; credit: number; debit: number; count: number }>();
  for (const t of txns) {
    const e = pc.get(t.counterparty) || { cls: t.cls, reason: t.reason, credit: 0, debit: 0, count: 0 };
    e.credit += t.credit; e.debit += t.debit; e.count++;
    pc.set(t.counterparty, e);
  }
  const partyClasses = [...pc.entries()].map(([party, e]) => ({ party, ...e })).sort((a, b) => b.credit + b.debit - (a.credit + a.debit));

  const loans = txns.filter((t) => t.cls === 'Loan Disbursal').map((t) => {
    const d = t.description.toLowerCase();
    const type = /\b(od|cc|cash credit|wcdl|working capital)\b/.test(d) ? 'Working Capital Loan'
      : /hous|home|\blap\b|term|\btl\b|machinery|vehicle/.test(d) ? 'Term Loan'
      : /fin|nbfc|iifl|shriram|bajaj|tata capital|lending|capital/.test(d) ? 'Unsecured / NBFC Loan' : 'Other Borrowing';
    return { date: t.date, description: t.description, amount: t.credit, type, account: t.account };
  });
  for (const t of txns) if (t.cls === 'Promoter / Director' && t.credit > 0) loans.push({ date: t.date, description: `${t.counterparty} — ${t.description}`, amount: t.credit, type: 'Promoter Infusion', account: t.account });
  loans.sort((a, b) => a.date.localeCompare(b.date));

  const cashTx = txns.filter(isCash);
  const cashTotal = cashTx.reduce((a, t) => a + t.credit, 0);
  const cashMonthly: Record<string, number> = {};
  for (const t of cashTx) cashMonthly[t.month] = (cashMonthly[t.month] || 0) + t.credit;

  // ---- CC / OD utilisation from daily end-of-day balances
  const utilisation: BankAnalysis['utilisation'] = [];
  const odAccounts = bd.accounts.filter((a) => /overdraft|cash credit|\bod\b|\bcc\b/i.test(a.type));
  const candidates = odAccounts.length ? odAccounts : bd.accounts.filter((a) => txns.some((t) => t.account === a.account && (t.balance ?? 0) < 0));
  for (const acc of candidates) {
    const at = txns.filter((t) => t.account === acc.account && t.balance !== null);
    if (!at.length) continue;
    const eod = new Map<string, number>();
    for (const t of at) eod.set(t.date, t.balance as number);
    const start = new Date(months[0] + '-01T00:00:00Z');
    const endM = months[months.length - 1];
    const end = new Date(Date.UTC(+endM.slice(0, 4), +endM.slice(5, 7), 0));
    const daily: { date: string; balance: number }[] = [];
    let bal = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      if (eod.has(k)) bal = eod.get(k)!;
      daily.push({ date: k, balance: bal });
    }
    // sanction limit: manual input, else account sanction, else matching open charge
    let limit = inp.sanctionLimit ?? acc.sanction ?? null;
    let limitSource = inp.sanctionLimit ? 'Manual input' : acc.sanction ? 'Bank statement' : '';
    if (!limit && fin?.charges.length) {
      const bankTok = nameTokens(acc.bank)[0];
      const ch = fin.charges.filter((c) => !c.satisfied || c.satisfied === '-').filter((c) => bankTok && nameTokens(c.holder).includes(bankTok)).sort((a, b) => b.amount - a.amount)[0];
      if (ch) { limit = ch.amount; limitSource = `Open charge — ${ch.holder} (${ch.created})`; }
    }
    const used = daily.filter((d) => d.balance < 0 || d.date >= (at[0]?.date || '')).map((d) => Math.max(0, -d.balance));
    const active = daily.filter((d) => d.date >= at[0].date);
    const usedActive = active.map((d) => Math.max(0, -d.balance));
    const utils = limit ? usedActive.map((u) => u / limit!) : [];
    void used;
    const avgUtil = utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : null;
    const peakUtil = utils.length ? Math.max(...utils) : null;
    const minUtil = utils.length ? Math.min(...utils) : null;
    const daysAbove90 = utils.filter((u) => u > 0.9).length;
    const overdrawnDays = utils.filter((u) => u > 1).length;
    const classification = avgUtil === null ? 'Limit not known' : overdrawnDays > 5 || avgUtil > 0.95 ? 'Critical' : avgUtil > 0.85 ? 'Stretched' : avgUtil > 0.7 ? 'High Utilisation' : 'Comfortable';
    utilisation.push({ account: `${acc.bank} ${acc.account.slice(-4)}`, limit, limitSource, avgUtil, peakUtil, minUtil, daysAbove90, overdrawnDays, days: active.length, classification, daily });
  }

  const conduct = returnsRisk === 'High' || utilisation.some((u) => u.classification === 'Critical') ? 'Watchlist'
    : returnsRisk === 'Moderate' || utilisation.some((u) => u.classification === 'Stretched') ? 'Satisfactory'
    : 'Good';

  return {
    months, fy: [...new Set(months.map(fyOfMonth))], txns, monthly,
    totals: { inflow, outflow, net: inflow - outflow, avgInflow: inflow / nM, avgOutflow: outflow / nM, peakMonth: sortedIn[0]?.month || '', lowMonth: sortedIn[sortedIn.length - 1]?.month || '', volatility, trend },
    adjusted,
    returns: {
      inward: { count: inwardItems.length, amount: inwardItems.reduce((a, t) => a + t.credit, 0), months: new Set(inwardItems.map((t) => t.month)).size, items: inwardItems },
      outward: { count: outwardItems.length, amount: outwardItems.reduce((a, t) => a + t.debit, 0), months: new Set(outwardItems.map((t) => t.month)).size, items: outwardItems },
      ecsNachEmi: { count: ecsItems.length, amount: ecsItems.reduce((a, t) => a + t.credit + t.debit, 0), items: ecsItems },
      penal: { count: penalItems.length, amount: penalItems.reduce((a, t) => a + t.debit, 0), items: penalItems },
      charges: { count: chargeItems.length, amount: chargeItems.reduce((a, t) => a + t.debit, 0) },
      risk: returnsRisk,
    },
    creditEntries: { total: creditTx.length, monthlyAvg: creditTx.length / nM, avgAmount: div(creditTx.reduce((a, t) => a + t.credit, 0), creditTx.length) ?? 0, largest: [...creditTx].sort((a, b) => b.credit - a.credit).slice(0, 10), perMonth },
    parties: { inflow: partyAgg('credit'), outflow: partyAgg('debit') },
    partyClasses,
    loans,
    emi: txns.filter(isEmi).map((t) => ({ date: t.date, description: t.description, amount: t.debit })),
    interest: monthly.map((m) => ({ month: m.month, amount: m.interest })),
    cash: { total: cashTotal, count: cashTx.length, pctOfCredits: div(cashTotal, inflow), monthly: cashMonthly, large: cashTx.filter((t) => t.credit >= 200000) },
    utilisation,
    internalTxns: txns.filter((t) => t.cls === 'Internal / Self' || t.cls === 'Group / Related' || t.cls === 'Promoter / Director'),
    conduct,
  };
}
