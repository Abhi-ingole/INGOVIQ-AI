import { useState } from 'react';
import type { PageCtx } from '../ctx';
import { BankVisuals } from './ExtraVisuals';
import { ChartCard } from '../Chart';
import { Section, Chip, Disclaimer, NoData, Kpi, Table } from '../common';
import { fmtCr, fmtINR, fmtPct, fmtDate } from '../../engine/format';
import { monthLabel, fyOfMonth } from '../../engine/utils';
import type { TxnClass } from '../../engine/types';
import type { ClassifiedTxn } from '../../engine/calcBanking';

const CLASSES: TxnClass[] = ['Business', 'Internal / Self', 'Promoter / Director', 'Group / Related', 'Loan Disbursal', 'Return / Reversal', 'Non-Business'];

const txnCols = [
  { key: 'date', label: 'Date', sort: (r: ClassifiedTxn) => r.date, render: (r: ClassifiedTxn) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</span> },
  { key: 'description', label: 'Narration', wrap: true, render: (r: ClassifiedTxn) => <span className="small">{r.description}</span> },
  { key: 'counterparty', label: 'Party' },
  { key: 'debit', label: 'Debit', num: true, render: (r: ClassifiedTxn) => (r.debit ? fmtINR(r.debit) : ''), sort: (r: ClassifiedTxn) => r.debit },
  { key: 'credit', label: 'Credit', num: true, render: (r: ClassifiedTxn) => (r.credit ? fmtINR(r.credit) : ''), sort: (r: ClassifiedTxn) => r.credit },
  { key: 'cls', label: 'Classification', render: (r: ClassifiedTxn) => <Chip s={r.cls} tone={r.cls === 'Business' ? 'good' : r.cls === 'Return / Reversal' ? 'serious' : 'info'} /> },
];

export function Banking(ctx: PageCtx) {
  const { a, inp, setInp, themeKey, exporting, fySel } = ctx;
  const b = a.bank;
  const [monthSel, setMonthSel] = useState<string[]>([]);
  const [partyFilter, setPartyFilter] = useState('');
  if (!b) return <><NoData what="Banking analysis report / bank statement" /><Disclaimer /></>;
  const inFy = (m: string) => !fySel.length || fySel.includes(fyOfMonth(m));
  const months = (monthSel.length ? b.months.filter((m) => monthSel.includes(m)) : b.months).filter(inFy);
  const mm = b.monthly.filter((m) => months.includes(m.month));
  const sum = (f: (x: (typeof mm)[number]) => number) => mm.reduce((s, x) => s + f(x), 0);
  const setClass = (party: string, cls: TxnClass) => setInp({ partyClassOverrides: { ...inp.partyClassOverrides, [party]: cls } });
  const adj = b.adjusted;

  return (
    <>
      <div className="filter-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <b className="small">Months:</b>
        {b.months.filter(inFy).map((m) => <button key={m} className={`btn small ${monthSel.includes(m) ? 'primary' : ''}`} onClick={() => setMonthSel((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}>{monthLabel(m)}</button>)}
        {monthSel.length > 0 && <button className="btn small" onClick={() => setMonthSel([])}>Clear</button>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{b.txns.length} transactions · {new Set(b.txns.map((t) => t.account)).size} account(s)</span>
      </div>

      <div className="grid g5" style={{ marginTop: 10 }}>
        <Kpi label="Total inflow" value={fmtCr(sum((x) => x.inflow))} delta={`Avg ${fmtCr(sum((x) => x.inflow) / (mm.length || 1))}/month`} />
        <Kpi label="Total outflow" value={fmtCr(sum((x) => x.outflow))} delta={`Avg ${fmtCr(sum((x) => x.outflow) / (mm.length || 1))}/month`} />
        <Kpi label="Adjusted business inflow" value={fmtCr(sum((x) => x.adjustedInflow))} delta={`${fmtPct(sum((x) => x.adjustedInflow) / (sum((x) => x.inflow) || 1))} of gross`} />
        <Kpi label="Banking trend" value={b.totals.trend} delta={`Volatility ${fmtPct(b.totals.volatility)}`} />
        <Kpi label="Banking conduct" value={b.conduct} delta={`Returns risk: ${b.returns.risk}`} />
      </div>

      <Section num="14" title="Banking trend (monthly)" right={<Chip s={b.totals.trend} />} />
      <div className="grid g2">
        <Table rows={mm} cols={[
          { key: 'month', label: 'Month', render: (r) => monthLabel(r.month) },
          { key: 'inflow', label: 'Total Inflow', num: true, render: (r) => fmtINR(r.inflow) },
          { key: 'outflow', label: 'Total Outflow', num: true, render: (r) => fmtINR(r.outflow) },
          { key: 'adjustedInflow', label: 'Adjusted Inflow', num: true, render: (r) => fmtINR(r.adjustedInflow) },
          { key: 'closing', label: 'Closing Balance', num: true, render: (r) => fmtINR(r.closing) },
        ]} />
        <ChartCard title="Inflow, outflow & adjusted inflow" themeKey={themeKey} spec={{ categories: mm.map((m) => monthLabel(m.month)), unit: 'inr', type: 'bar', series: [{ name: 'Inflow', data: mm.map((m) => m.inflow) }, { name: 'Outflow', data: mm.map((m) => m.outflow), slot: 1 }, { name: 'Adjusted inflow', data: mm.map((m) => m.adjustedInflow), slot: 2 }] }} />
      </div>

      <Section num="15" title="Internal transactions" />
      <div className="note small">Transfers between the company's own accounts, group companies, related parties and promoters/directors — kept separate from genuine business receipts and payments. Change any party's classification in section 22.</div>
      <Table rows={b.internalTxns.filter((t) => months.includes(t.month))} maxHeight={300} cols={txnCols} />

      <Section num="16" title="Adjusted business inflow (full statement period)" />
      <div className="grid g2">
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>
              <tr><td>Total bank inflow (gross credits)</td><td className="num">{fmtINR(adj.gross)}</td></tr>
              <tr><td>Less: cheque / payment returns & reversals</td><td className="num">−{fmtINR(adj.returns)}</td></tr>
              <tr><td>Less: internal transfers (own accounts / FD)</td><td className="num">−{fmtINR(adj.internal)}</td></tr>
              <tr><td>Less: loan disbursements</td><td className="num">−{fmtINR(adj.loans)}</td></tr>
              <tr><td>Less: promoter / director credits</td><td className="num">−{fmtINR(adj.promoter)}</td></tr>
              <tr><td>Less: group / related-party credits</td><td className="num">−{fmtINR(adj.group)}</td></tr>
              <tr><td>Less: identifiable non-business credits</td><td className="num">−{fmtINR(adj.nonBusiness)}</td></tr>
              <tr className="sub"><td>= Adjusted business inflow</td><td className="num">{fmtINR(adj.adjusted)}</td></tr>
            </tbody>
          </table>
        </div>
        <ChartCard title="Composition of gross credits" themeKey={themeKey} spec={{ categories: ['Business', 'Promoter / Director', 'Returns & reversals', 'Loans', 'Internal', 'Group / Related', 'Non-business'], unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'hbar', 'table'], series: [{ name: 'Credits', data: [adj.adjusted, adj.promoter, adj.returns, adj.loans, adj.internal, adj.group, adj.nonBusiness] }] }} />
      </div>

      <Section num="17" title="Inflow / outflow analysis" />
      <div className="grid g4">
        <Kpi label="Total inflow / outflow" value={fmtCr(b.totals.inflow)} delta={`Outflow ${fmtCr(b.totals.outflow)}`} />
        <Kpi label="Average monthly inflow / outflow" value={fmtCr(b.totals.avgInflow)} delta={`Outflow ${fmtCr(b.totals.avgOutflow)}`} />
        <Kpi label="Peak / lowest month" value={monthLabel(b.totals.peakMonth)} delta={`Lowest ${monthLabel(b.totals.lowMonth)}`} />
        <Kpi label="Net cash movement" value={fmtCr(b.totals.net)} deltaGood={b.totals.net >= 0} delta={`Volatility (CV) ${fmtPct(b.totals.volatility)}`} />
      </div>

      <Section num="18" title="Cheque return analysis" right={<Chip s={`Risk: ${b.returns.risk}`} tone={b.returns.risk === 'Nil' || b.returns.risk === 'Low' ? 'good' : b.returns.risk === 'Moderate' ? 'warn' : 'critical'} />} />
      <div className="grid g4">
        <Kpi label="Inward returns (own cheques / payments returned)" value={b.returns.inward.count} delta={`${fmtINR(b.returns.inward.amount)} · ${b.returns.inward.months} month(s)`} deltaGood={!b.returns.inward.count} />
        <Kpi label="Outward returns (customer cheques returned)" value={b.returns.outward.count} delta={`${fmtINR(b.returns.outward.amount)} · ${b.returns.outward.months} month(s)`} deltaGood={!b.returns.outward.count} />
        <Kpi label="Return / bounce charges" value={b.returns.charges.count} delta={fmtINR(b.returns.charges.amount)} />
        <Kpi label="Frequency" value={`${((b.returns.inward.count + b.returns.outward.count) / (b.months.length || 1)).toFixed(1)}/month`} />
      </div>
      {b.returns.inward.items.length > 0 && <div style={{ marginTop: 8 }}><Table rows={b.returns.inward.items} maxHeight={240} cols={txnCols} /></div>}

      <Section num="19" title="ECS / NACH / EMI returns & penal charges" />
      <div className="grid g3">
        <Kpi label="ECS / NACH / EMI returns" value={b.returns.ecsNachEmi.count} delta={fmtINR(b.returns.ecsNachEmi.amount)} deltaGood={!b.returns.ecsNachEmi.count} />
        <Kpi label="Penal charges" value={b.returns.penal.count} delta={fmtINR(b.returns.penal.amount)} deltaGood={!b.returns.penal.count} />
        <Kpi label="EMIs paid" value={b.emi.length} delta={fmtINR(b.emi.reduce((s, e) => s + e.amount, 0))} />
      </div>
      {b.returns.ecsNachEmi.count + b.returns.penal.count > 1 && <div className="note warn">Repeated instances observed — treat as potential stress indicators.</div>}

      <Section num="20" title="Number of credit entries" />
      <div className="grid g2">
        <div className="grid g3" style={{ alignContent: 'start' }}>
          <Kpi label="Total credit entries" value={b.creditEntries.total} />
          <Kpi label="Monthly average" value={b.creditEntries.monthlyAvg.toFixed(1)} />
          <Kpi label="Average credit" value={fmtCr(b.creditEntries.avgAmount)} />
        </div>
        <ChartCard title="Credit entries per month" themeKey={themeKey} height={200} spec={{ categories: b.months.map(monthLabel), unit: 'num', type: 'bar', series: [{ name: 'Credit entries', data: b.months.map((m) => b.creditEntries.perMonth[m] || 0) }] }} />
      </div>
      <div className="card-title" style={{ margin: '10px 0 6px' }}>Largest credits</div>
      <Table rows={b.creditEntries.largest} cols={txnCols} />

      <Section num="21" title="Banking turnover (BTO)" />
      <div className="tbl-wrap">
        <table className="tbl">
          <tbody>
            <tr><td>Banking turnover (adjusted business inflow, {a.recon.bto.months} months)</td><td className="num">{fmtINR(a.recon.bto.bankTurnover)}</td></tr>
            <tr><td>Annualised banking turnover</td><td className="num">{fmtINR(a.recon.bto.annualised)}</td></tr>
            <tr><td>GST turnover incl. tax — same months ({a.recon.overlap?.label || 'no overlap'})</td><td className="num">{fmtINR(a.recon.bto.gstSamePeriod)}</td></tr>
            <tr className="sub"><td>Banking turnover ÷ GST turnover (same months)</td><td className="num">{fmtPct(a.recon.bto.btoToGst)}</td></tr>
            <tr><td>Financial turnover (latest audited year)</td><td className="num">{fmtINR(a.recon.bto.financialLatest)}</td></tr>
            <tr className="sub"><td>Annualised BTO (ex-GST) ÷ financial turnover</td><td className="num">{fmtPct(a.recon.bto.btoToFinancial)}</td></tr>
          </tbody>
        </table>
      </div>

      <Section num="22" title="Party-wise inflow / outflow" />
      <div className="grid g2">
        <div><div className="card-title" style={{ marginBottom: 6 }}>Top inflow parties</div>
          <Table rows={(exporting ? b.parties.inflow : b.parties.inflow.slice(0, 15))} cols={[{ key: 'party', label: 'Party', wrap: true }, { key: 'amount', label: 'Amount', num: true, render: (r) => fmtINR(r.amount) }, { key: 'share', label: '% of inflow', num: true, render: (r) => fmtPct(r.share) }, { key: 'cls', label: 'Class', render: (r) => <span className="small">{r.cls}</span> }]} /></div>
        <div><div className="card-title" style={{ marginBottom: 6 }}>Top outflow parties</div>
          <Table rows={(exporting ? b.parties.outflow : b.parties.outflow.slice(0, 15))} cols={[{ key: 'party', label: 'Party', wrap: true }, { key: 'amount', label: 'Amount', num: true, render: (r) => fmtINR(r.amount) }, { key: 'share', label: '% of outflow', num: true, render: (r) => fmtPct(r.share) }, { key: 'cls', label: 'Class', render: (r) => <span className="small">{r.cls}</span> }]} /></div>
      </div>
      <div className="note small">Party concentration: top 5 inflow parties = {fmtPct(b.parties.inflow.slice(0, 5).reduce((s, p) => s + p.share, 0))} of inflow; top 5 outflow parties = {fmtPct(b.parties.outflow.slice(0, 5).reduce((s, p) => s + p.share, 0))} of outflow.</div>
      <details style={{ marginTop: 8 }} open>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Party classification (edit to correct — dashboard recalculates instantly)</summary>
        <input placeholder="Search party…" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} style={{ margin: '8px 0', padding: '5px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, width: 260, background: 'var(--surface)' }} />
        <Table rows={b.partyClasses.filter((p) => p.party.toLowerCase().includes(partyFilter.toLowerCase())).slice(0, exporting ? undefined : 200)} maxHeight={360} cols={[
          { key: 'party', label: 'Party', wrap: true, sort: (r) => r.party },
          { key: 'credit', label: 'Credits', num: true, render: (r) => fmtINR(r.credit), sort: (r) => r.credit },
          { key: 'debit', label: 'Debits', num: true, render: (r) => fmtINR(r.debit), sort: (r) => r.debit },
          { key: 'count', label: 'Txns', num: true, sort: (r) => r.count },
          { key: 'cls', label: 'Classification', render: (r) => <select value={inp.partyClassOverrides[r.party] || r.cls} onChange={(e) => setClass(r.party, e.target.value as TxnClass)}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select> },
          { key: 'reason', label: 'Why', render: (r) => <span className="small muted">{inp.partyClassOverrides[r.party] ? 'Manual' : r.reason}</span>, wrap: true },
        ]} />
      </details>

      <Section num="23" title="Loan disbursement analysis" />
      <div className="note small">Loan disbursements and promoter infusion are not treated as operating receipts.</div>
      <Table rows={b.loans} cols={[
        { key: 'date', label: 'Date', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</span> }, { key: 'type', label: 'Classification', render: (r) => <Chip s={r.type} tone="info" /> },
        { key: 'description', label: 'Narration', wrap: true, render: (r) => <span className="small">{r.description}</span> },
        { key: 'amount', label: 'Amount', num: true, render: (r) => fmtINR(r.amount) },
      ]} />
      <div className="small muted" style={{ marginTop: 6 }}>{['Term Loan', 'Working Capital Loan', 'Unsecured / NBFC Loan', 'Promoter Infusion', 'Other Borrowing'].map((t) => `${t}: ${fmtINR(b.loans.filter((l) => l.type === t).reduce((s, l) => s + l.amount, 0))}`).join(' · ')}</div>

      <Section num="24" title="Cash deposit analysis" />
      <div className="grid g2">
        <div className="grid g3" style={{ alignContent: 'start' }}>
          <Kpi label="Total cash deposits" value={fmtCr(b.cash.total)} />
          <Kpi label="Number of deposits" value={b.cash.count} />
          <Kpi label="Cash as % of credits" value={fmtPct(b.cash.pctOfCredits)} deltaGood={(b.cash.pctOfCredits ?? 0) < 0.1} delta={(b.cash.pctOfCredits ?? 0) < 0.1 ? 'Within 10%' : 'Heavy'} />
        </div>
        <ChartCard title="Cash deposits by month" themeKey={themeKey} height={200} spec={{ categories: b.months.map(monthLabel), unit: 'inr', type: 'bar', series: [{ name: 'Cash deposits', data: b.months.map((m) => b.cash.monthly[m] || 0), slot: 3 }] }} />
      </div>
      {b.cash.large.length > 0 && <><div className="card-title" style={{ margin: '8px 0 6px' }}>Unusually large cash credits (≥ ₹2 lakh)</div><Table rows={b.cash.large} cols={txnCols} /></>}

      <Section num="25" title="CC / OD utilisation" />
      {b.utilisation.length === 0 && <div className="note">No CC/OD account identified in the statements.</div>}
      {b.utilisation.map((u) => (
        <div key={u.account} style={{ marginBottom: 12 }}>
          <div className="grid g6">
            <Kpi label="Account" value={u.account} delta={<Chip s={u.classification} />} />
            <Kpi label="Sanctioned limit" value={fmtCr(u.limit)} delta={<span className="small">{u.limitSource || 'Enter in Settings'}</span>} />
            <Kpi label="Average utilisation" value={fmtPct(u.avgUtil)} />
            <Kpi label="Peak / minimum" value={fmtPct(u.peakUtil)} delta={`Min ${fmtPct(u.minUtil)}`} />
            <Kpi label="Days above 90%" value={u.daysAbove90} delta={`of ${u.days} days`} />
            <Kpi label="Overdrawn days" value={u.overdrawnDays} deltaGood={!u.overdrawnDays} delta={u.overdrawnDays ? 'Above sanctioned limit' : 'None'} />
          </div>
          <div style={{ marginTop: 10 }}>
            <ChartCard title={`Daily utilisation — ${u.account}`} sub="End-of-day drawn balance ÷ sanctioned limit" themeKey={themeKey} height={240}
              spec={{ categories: u.daily.map((d) => fmtDate(d.date)), unit: u.limit ? 'pct' : 'inr', type: 'area', allowed: ['area', 'line', 'table'], series: [{ name: u.limit ? 'Utilisation' : 'Drawn balance', data: u.daily.map((d) => (u.limit ? Math.max(0, -d.balance) / u.limit : Math.max(0, -d.balance))) }] }} />
          </div>
          <div className="small muted">Interest servicing: {b.interest.filter((i) => i.amount).map((i) => `${monthLabel(i.month)} ${fmtINR(i.amount)}`).join(' · ') || 'no interest debits identified'}</div>
        </div>
      ))}
      <BankVisuals {...ctx} />
      <Disclaimer />
    </>
  );
}
