import type { Workbook, BankingData, BankTxn, BankAccount, CleaningLog, Matrix } from './types';
import { str, num, parseDate, findRow } from './utils';

const COLS: Record<string, RegExp> = {
  sn: /^(sn|s\.? ?no\.?|sr\.? ?no\.?)$/i,
  date: /^(txn |transaction |value )?date$/i,
  desc: /^(description|narration|particulars|transaction details|remarks)$/i,
  debit: /^(debit|withdrawals?|dr\.?( amount)?|debit amount|withdrawal amt\.?)$/i,
  credit: /^(credit|deposits?|cr\.?( amount)?|credit amount|deposit amt\.?)$/i,
  balance: /^(balance|closing balance|running balance)$/i,
  category: /^category$/i,
  party: /^(name|party|party name|counterparty)$/i,
  bank: /^bank name$/i,
  account: /^(account number|a\/c no\.?|account no\.?)$/i,
};

function findTxnHeader(mx: Matrix): { r: number; idx: Record<string, number> } | null {
  for (let r = 0; r < Math.min(mx.length, 60); r++) {
    const row = (mx[r] || []).map(str);
    const idx: Record<string, number> = {};
    row.forEach((c, i) => {
      for (const [k, re] of Object.entries(COLS)) if (idx[k] === undefined && re.test(c)) idx[k] = i;
    });
    if (idx.date !== undefined && idx.desc !== undefined && (idx.debit !== undefined || idx.credit !== undefined)) return { r, idx };
  }
  return null;
}

export function parseBanking(wb: Workbook, log: CleaningLog[]): BankingData {
  const src = wb.fileName;
  // choose the transaction sheet: prefer "Raw Data", else the first sheet with a txn header
  const order = [...wb.sheetOrder].sort((a, b) => (/raw data/i.test(b) ? 1 : 0) - (/raw data/i.test(a) ? 1 : 0));
  let txns: BankTxn[] = [];
  let usedSheet = '';
  for (const s of order) {
    const mx = wb.sheets[s];
    const h = findTxnHeader(mx);
    if (!h) continue;
    const { idx } = h;
    let lastSn = 0;
    let id = 0;
    let dupBlocks = 0;
    for (let r = h.r + 1; r < mx.length; r++) {
      const row = mx[r] || [];
      const sn = idx.sn !== undefined ? num(row[idx.sn]) : null;
      // consolidated reports repeat the same transactions per account after the first block
      if (idx.sn !== undefined && sn !== null && sn < lastSn) { dupBlocks++; break; }
      if (sn !== null) lastSn = sn;
      const date = parseDate(row[idx.date]);
      if (!date) continue;
      // values kept as reported (a negative debit is a reversal of an earlier debit)
      const debit = idx.debit !== undefined ? num(row[idx.debit]) ?? 0 : 0;
      const credit = idx.credit !== undefined ? num(row[idx.credit]) ?? 0 : 0;
      if (!debit && !credit) continue;
      txns.push({
        id: ++id,
        date,
        month: date.slice(0, 7),
        description: str(row[idx.desc]),
        debit,
        credit,
        balance: idx.balance !== undefined ? num(row[idx.balance]) : null,
        category: idx.category !== undefined ? str(row[idx.category]) : '',
        party: idx.party !== undefined ? str(row[idx.party]) : '',
        account: idx.account !== undefined ? str(row[idx.account]) : 'Primary',
        bank: idx.bank !== undefined ? str(row[idx.bank]) : '',
      });
    }
    if (txns.length) {
      usedSheet = s;
      if (dupBlocks) log.push({ source: src, level: 'info', message: `"${s}": used the consolidated block only and skipped repeated account-wise copies (prevents double counting).` });
      break;
    }
  }
  txns.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const months = [...new Set(txns.map((t) => t.month))].sort();

  // accounts & summary from executive summary
  const accounts: BankAccount[] = [];
  const summary: Record<string, string> = {};
  const exec = wb.sheetOrder.find((s) => /exec(utive)? summary/i.test(s));
  if (exec) {
    const mx = wb.sheets[exec];
    const h = findRow(mx, /^particulars$/i);
    if (h >= 0) {
      const hdr = (mx[h] || []).map(str);
      const rowOf = (re: RegExp) => findRow(mx, re, { from: h });
      const rAcc = rowOf(/bank account number/i), rBank = rowOf(/name of the bank/i), rType = rowOf(/type of account/i), rPer = rowOf(/period of analysis/i), rSan = rowOf(/sanction/i);
      hdr.forEach((v, c) => {
        if (/account number/i.test(v)) {
          accounts.push({
            account: str(mx[rAcc]?.[c]) || v.replace(/.*:\s*/, ''),
            bank: str(mx[rBank]?.[c]).replace(/\s*\(.*\)$/, ''),
            type: str(mx[rType]?.[c]),
            period: str(mx[rPer]?.[c]),
            sanction: rSan >= 0 ? num(mx[rSan]?.[c]) : null,
          });
        }
      });
      const consolCol = hdr.findIndex((v) => /consolidated/i.test(v));
      if (consolCol > 0) for (let r = h + 1; r < Math.min(mx.length, h + 40); r++) {
        const k = str(mx[r]?.[0]);
        if (k) summary[k] = str(mx[r]?.[consolCol]);
      }
    }
  }
  if (!accounts.length) {
    for (const a of new Set(txns.map((t) => t.account))) {
      const t = txns.find((x) => x.account === a);
      accounts.push({ account: a, bank: t?.bank || '', type: '', period: months.length ? `${months[0]} to ${months[months.length - 1]}` : '', sanction: null });
    }
  }
  // flags
  const flags: BankingData['flags'] = [];
  const fs = wb.sheetOrder.find((s) => /^flags$/i.test(s));
  if (fs) {
    const mx = wb.sheets[fs];
    const h = findRow(mx, /^sn$/i);
    for (let r = h + 1; h >= 0 && r < mx.length; r++) {
      const f = str(mx[r]?.[2]);
      if (!f) continue;
      flags.push({ category: str(mx[r]?.[1]), flag: f, description: str(mx[r]?.[3]) });
    }
  }
  // related / group parties listed by the bank-analysis provider
  const relatedParties: BankingData['relatedParties'] = [];
  const rs = wb.sheetOrder.find((s) => /internal|group|related/i.test(s));
  if (rs) {
    const mx = wb.sheets[rs];
    for (let r = 0; r < Math.min(mx.length, 40); r++) {
      const row = (mx[r] || []).map(str);
      row.forEach((v, c) => {
        if (/^name$/i.test(v) && /relationship/i.test(row[c + 2] || '')) {
          for (let k = r + 1; k < mx.length; k++) {
            const nm = str(mx[k]?.[c]);
            if (!nm) break;
            relatedParties.push({ name: nm, relationship: str(mx[k]?.[c + 2]) });
          }
        }
      });
    }
  }
  log.push({ source: src, level: 'info', message: `Banking: ${txns.length} transactions from "${usedSheet}", ${accounts.length} account(s), ${months.length} months (${months[0] || '-'} to ${months[months.length - 1] || '-'}).` });
  if (months.length && months.length < 12) log.push({ source: src, level: 'warn', message: `Banking covers ${months.length} months; the credit framework expects the latest 12 months.` });

  const nameRow = wb.sheets[usedSheet]?.slice(0, 5).map((r) => str(r?.[0])).find((v) => v && !/consolidated/i.test(v));
  return { company: nameRow || wb.fileName, accounts, txns, months, summary, flags, relatedParties };
}
