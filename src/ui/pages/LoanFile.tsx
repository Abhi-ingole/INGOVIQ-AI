import type { PageCtx } from '../ctx';
import { ChartCard } from '../Chart';
import { Section, Chip, Disclaimer, Table, Kpi, NoData } from '../common';
import { fmtINR, fmtPct, fmtCr, fmtDate } from '../../engine/format';
import { monthLabel } from '../../engine/utils';
import type { DocEntry } from '../../engine/types';

const STATUS_TONE: Record<DocEntry['status'], 'good' | 'warn' | 'serious' | 'neutral' | 'info'> = {
  used: 'good', duplicate: 'neutral', skipped: 'neutral', 'not used': 'neutral', scanned: 'warn', 'needs password': 'serious', error: 'serious',
};

/** Everything that came from the loan-file folder / zip: inventory, coverage, returns, loans, bureau, KYC facts. */
export function LoanFile({ ds, themeKey, exporting }: PageCtx) {
  const x = ds.extra;
  const docs = ds.docs || [];
  if (!docs.length || !x) return <><NoData what="Loan-file folder / zip" hint="Use Get data → Upload folder or Upload zip to load a complete loan file (bank statements, GSTR-3B, CIBIL, ledgers, ageing, KYC)." /><Disclaimer /></>;
  const count = (s: DocEntry['status']) => docs.filter((d) => d.status === s).length;
  const types = [...new Set(docs.map((d) => d.type))].map((t) => ({ type: t, n: docs.filter((d) => d.type === t).length, used: docs.filter((d) => d.type === t && d.status === 'used').length })).sort((a, b) => b.n - a.n);
  const totalEmi = x.loans.reduce((s, l) => s + (l.emi || 0), 0);
  const r3 = [...x.gstr3b].sort((a, b) => a.gstin.localeCompare(b.gstin) || a.period.localeCompare(b.period));
  const periods = [...new Set(r3.map((r) => r.period))].sort();
  const gstins = [...new Set(r3.map((r) => r.gstin))];
  const recv = x.ageing.find((a) => a.side === 'receivable'), pay = x.ageing.find((a) => a.side === 'payable');
  const tallyRows = x.ledgerParties.map((p) => ({ name: p.name, sales: Object.values(p.sales).reduce((a, b) => a + b, 0), purchases: Object.values(p.purchases).reduce((a, b) => a + b, 0), receipts: p.receipts, payments: p.payments, closing: p.closing }))
    .sort((a, b) => b.sales + b.purchases - (a.sales + a.purchases));
  return (
    <>
      <div className="grid g5">
        <Kpi label="Files in the loan file" value={docs.length} delta={`${count('used')} used for analysis`} />
        <Kpi label="Scanned (no text)" value={count('scanned')} delta="enter figures manually" deltaGood={!count('scanned')} />
        <Kpi label="Need a password" value={count('needs password')} deltaGood={!count('needs password')} delta={count('needs password') ? 'Get data → PDF passwords' : 'all opened'} />
        <Kpi label="Duplicates skipped" value={count('duplicate')} />
        <Kpi label="Errors" value={count('error')} deltaGood={!count('error')} />
      </div>

      <Section num="A" title="Documents received" />
      <div className="grid g2">
        <Table rows={types} cols={[{ key: 'type', label: 'Document type', wrap: true }, { key: 'n', label: 'Files', num: true }, { key: 'used', label: 'Used in analysis', num: true }]} />
        <ChartCard title="Files by status" themeKey={themeKey} spec={{ categories: ['Used', 'Listed only', 'Scanned', 'Duplicate', 'Needs password', 'Skipped', 'Error'], unit: 'num', type: 'donut', allowed: ['donut', 'pie', 'hbar', 'table'], series: [{ name: 'Files', data: [count('used'), count('not used'), count('scanned'), count('duplicate'), count('needs password'), count('skipped'), count('error')] }] }} />
      </div>
      <div style={{ marginTop: 10 }}>
        <Table rows={docs} maxHeight={exporting ? undefined : 420} cols={[
          { key: 'path', label: 'File', wrap: true, sort: (r) => r.path, render: (r) => <><b>{r.path.split('/').pop()}</b><div className="small muted">{r.path.split('/').slice(0, -1).join(' / ')}</div></> },
          { key: 'type', label: 'Type', sort: (r) => r.type },
          { key: 'status', label: 'Status', sort: (r) => r.status, render: (r) => <Chip s={r.status} tone={STATUS_TONE[r.status]} /> },
          { key: 'note', label: 'What INGOVIQ found', wrap: true },
          { key: 'size', label: 'Size', num: true, sort: (r) => r.size, render: (r) => `${(r.size / 1024).toFixed(0)} KB` },
        ]} />
      </div>

      {Object.keys(x.profile).length > 0 && (
        <>
          <Section num="B" title="Company master data (MCA)" />
          <div className="grid g2">
            <Table rows={Object.entries(x.profile).map(([k, v]) => ({ k, v }))} cols={[{ key: 'k', label: 'Field' }, { key: 'v', label: 'Value', wrap: true }]} />
            <div>
              <Table rows={x.directors} cols={[{ key: 'name', label: 'Director' }, { key: 'designation', label: 'Designation' }, { key: 'appointed', label: 'Appointed' }]} empty="No directors listed" />
              {x.gstCerts.length > 0 && <div style={{ marginTop: 10 }}><Table rows={x.gstCerts} cols={[{ key: 'gstin', label: 'GSTIN', render: (r) => <span className="code">{r.gstin}</span> }, { key: 'state', label: 'State' }, { key: 'legalName', label: 'Legal name', wrap: true }, { key: 'regDate', label: 'Liability from' }]} /></div>}
            </div>
          </div>
        </>
      )}

      {x.statements.length > 0 && (
        <>
          <Section num="C" title="Bank statements received — coverage" />
          <Table rows={x.statements} cols={[
            { key: 'file', label: 'Statement file', wrap: true, render: (r) => r.file.split('/').pop() },
            { key: 'bank', label: 'Bank' }, { key: 'account', label: 'Account', render: (r) => <span className="code">{r.account}</span> },
            { key: 'from', label: 'From', render: (r) => fmtDate(r.from) }, { key: 'to', label: 'To', render: (r) => fmtDate(r.to) },
            { key: 'txns', label: 'Transactions', num: true },
            { key: 'mismatches', label: 'Balance check', render: (r) => (r.mismatches ? <Chip s={`${r.mismatches} breaks`} tone="warn" /> : <Chip s="Running balance OK" tone="good" />) },
          ]} />
          <div className="note small">Overlapping statements of the same account are merged and duplicate entries removed (same date, amount and running balance). Gaps longer than 20 days are listed in the cleaning log.</div>
        </>
      )}

      {r3.length > 0 && (
        <>
          <Section num="D" title="GSTR-3B returns (month-wise, every GSTIN)" />
          <ChartCard title="Outward supplies declared in GSTR-3B" themeKey={themeKey} spec={{ categories: periods.map(monthLabel), unit: 'inr', type: 'stacked', series: gstins.map((g, i) => ({ name: g, data: periods.map((p) => { const r = r3.find((y) => y.gstin === g && y.period === p); return r ? r.taxable + r.zeroRated + r.nilExempt + r.nonGst : null; }), slot: i })) }} />
          <div style={{ marginTop: 10 }}>
            <Table rows={r3} maxHeight={exporting ? undefined : 420} cols={[
              { key: 'gstin', label: 'GSTIN', render: (r) => <span className="code">{r.gstin}</span> },
              { key: 'period', label: 'Period', render: (r) => monthLabel(r.period) },
              { key: 'taxable', label: 'Taxable (3.1a)', num: true, render: (r) => fmtINR(r.taxable) },
              { key: 'zeroRated', label: 'Zero-rated (3.1b)', num: true, render: (r) => fmtINR(r.zeroRated) },
              { key: 'nilExempt', label: 'Nil / exempt (3.1c)', num: true, render: (r) => fmtINR(r.nilExempt) },
              { key: 'outputTax', label: 'Output tax', num: true, render: (r) => fmtINR(r.outputTax) },
              { key: 'itc', label: 'ITC available', num: true, render: (r) => fmtINR(r.itc) },
              { key: 'rate', label: 'Tax ÷ taxable', num: true, render: (r) => fmtPct(r.taxable + r.zeroRated ? r.outputTax / (r.taxable + r.zeroRated) : null, 2) },
              { key: 'filedOn', label: 'Filed on', render: (r) => fmtDate(r.filedOn) },
            ]} />
          </div>
        </>
      )}

      {x.loans.length > 0 && (
        <>
          <Section num="E" title="Existing loans & obligations" />
          <div className="grid g4" style={{ marginBottom: 10 }}>
            <Kpi label="Facilities" value={x.loans.length} />
            <Kpi label="Total sanctioned" value={fmtCr(x.loans.reduce((s, l) => s + (l.sanction || 0), 0))} />
            <Kpi label="Total outstanding" value={fmtCr(x.loans.reduce((s, l) => s + (l.outstanding || 0), 0))} />
            <Kpi label="Monthly EMI / obligation" value={fmtINR(totalEmi)} delta={`${fmtINR(totalEmi * 12)} a year`} />
          </div>
          <Table rows={x.loans} cols={[
            { key: 'lender', label: 'Lender', wrap: true }, { key: 'facility', label: 'Facility' },
            { key: 'sanction', label: 'Sanctioned', num: true, render: (r) => fmtINR(r.sanction) }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => fmtINR(r.outstanding) },
            { key: 'emi', label: 'EMI', num: true, render: (r) => fmtINR(r.emi) }, { key: 'roi', label: 'ROI', num: true, render: (r) => fmtPct(r.roi, 2) },
            { key: 'start', label: 'Start', render: (r) => fmtDate(r.start) }, { key: 'end', label: 'End', render: (r) => fmtDate(r.end) }, { key: 'tenure', label: 'Tenure' }, { key: 'paidFrom', label: 'Paid from' },
          ]} />
        </>
      )}

      {(x.cibil.length > 0 || x.networth.length > 0) && (
        <>
          <Section num="F" title="Bureau reports & promoter net worth" />
          <div>
            <Table rows={x.cibil} cols={[
              { key: 'name', label: 'Name', wrap: true }, { key: 'kind', label: 'Report', render: (r) => (r.kind === 'commercial' ? 'Commercial (CMR)' : 'Consumer (CIBIL)') },
              { key: 'score', label: 'Score / rank', render: (r) => (r.kind === 'commercial' ? `CMR-${r.cmr ?? '?'}` : String(r.score ?? '?')) },
              { key: 'detail', label: 'Accounts / facilities', wrap: true, render: (r) => (r.kind === 'commercial' ? `${r.facilities ?? '?'} facilities · outstanding ${fmtINR(r.outstanding)} · overdue ${fmtINR(r.overdue)}` : `${r.accounts ?? '?'} accounts · sanctioned ${fmtINR(r.sanctioned)} · current ${fmtINR(r.current)} · overdue ${fmtINR(r.overdue)}`) },
              { key: 'flag', label: 'Bureau remark', render: (r) => (r.kind === 'consumer' && r.delinquencyFlag ? <Chip s="Delinquency in history" tone="warn" /> : <Chip s="No adverse remark" tone="good" />) },
              { key: 'reportDate', label: 'Report date', render: (r) => fmtDate(r.reportDate) },
            ]} />
            <div style={{ height: 10 }} />
            <Table rows={x.networth} cols={[{ key: 'name', label: 'Promoter' }, { key: 'pan', label: 'PAN' }, { key: 'total', label: 'Net worth', num: true, render: (r) => fmtINR(r.total) }, { key: 'date', label: 'Certificate date', render: (r) => fmtDate(r.date) }]} empty="No net-worth certificate" />
          </div>
        </>
      )}

      {(recv || pay) && (
        <>
          <Section num="G" title="Debtor & creditor ageing — party-wise" />
          <div className="grid g4" style={{ marginBottom: 10 }}>
            <Kpi label="Receivables outstanding" value={fmtCr(recv?.outstanding)} delta={recv ? `as on ${fmtDate(recv.asOf)} · ${recv.invoices} invoices` : ''} />
            <Kpi label="Average collection (days)" value={recv?.avgDays != null ? recv.avgDays.toFixed(0) : '—'} />
            <Kpi label="Payables outstanding" value={fmtCr(pay?.outstanding)} delta={pay ? `as on ${fmtDate(pay.asOf)} · ${pay.invoices} invoices` : ''} />
            <Kpi label="Average payment (days)" value={pay?.avgDays != null ? pay.avgDays.toFixed(0) : '—'} />
          </div>
          <div className="grid g2">
            {[recv, pay].filter(Boolean).map((ag) => (
              <div key={ag!.side}><div className="card-title" style={{ marginBottom: 6 }}>{ag!.side === 'receivable' ? 'Debtors' : 'Creditors'}</div>
                <Table rows={ag!.parties} maxHeight={exporting ? undefined : 360} cols={[{ key: 'name', label: 'Party', wrap: true }, { key: 'invoiced', label: 'Billed', num: true, render: (r) => fmtINR(r.invoiced) }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => fmtINR(r.outstanding) }, { key: 'avgDays', label: 'Avg days', num: true, render: (r) => (r.avgDays == null ? '—' : r.avgDays.toFixed(0)) }]} /></div>
            ))}
          </div>
          <div className="note small">Receipts / payments are set off against the oldest open bill of the same party first; the remaining bills are aged from bill date to the latest date in the file.</div>
        </>
      )}

      {tallyRows.length > 0 && (
        <>
          <Section num="H" title="Tally ledgers — party-wise sales, purchases, receipts & payments" />
          <div className="note small">From the Tally "Ledger Vouchers" export ({x.ledgerPeriod}). Amounts are voucher values (incl. GST); GST buyer / supplier analysis uses them net of GST.</div>
          <Table rows={tallyRows} maxHeight={exporting ? undefined : 420} initialSort={{ key: 'sales', dir: -1 }} cols={[
            { key: 'name', label: 'Party ledger', wrap: true, sort: (r) => r.name },
            { key: 'sales', label: 'Sales', num: true, sort: (r) => r.sales, render: (r) => fmtINR(r.sales) },
            { key: 'purchases', label: 'Purchases', num: true, sort: (r) => r.purchases, render: (r) => fmtINR(r.purchases) },
            { key: 'receipts', label: 'Receipts', num: true, sort: (r) => r.receipts, render: (r) => fmtINR(r.receipts) },
            { key: 'payments', label: 'Payments', num: true, sort: (r) => r.payments, render: (r) => fmtINR(r.payments) },
            { key: 'closing', label: 'Closing balance', num: true, sort: (r) => r.closing ?? 0, render: (r) => (r.closing === null ? '—' : `${fmtINR(Math.abs(r.closing))} ${r.closing >= 0 ? 'Dr' : 'Cr'}`) },
          ]} />
        </>
      )}

      {(x.momSales.length > 0 || x.momPurchase.length > 0) && (
        <>
          <Section num="I" title="Month-on-month bills — top parties" />
          <div className="grid g2">
            {[{ t: 'Sales bills', l: x.momSales }, { t: 'Purchase bills', l: x.momPurchase }].filter((z) => z.l.length).map((z) => {
              const ms = [...new Set(z.l.flatMap((p) => Object.keys(p.monthly)))].sort();
              return <ChartCard key={z.t} title={`MOM ${z.t.toLowerCase()}`} themeKey={themeKey} spec={{ categories: ms.map(monthLabel), unit: 'inr', type: 'stacked', series: z.l.map((p, i) => ({ name: p.name.slice(0, 26), data: ms.map((m) => p.monthly[m] ?? null), slot: i })) }} />;
            })}
          </div>
        </>
      )}
      <Disclaimer />
    </>
  );
}
