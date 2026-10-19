import type { PageCtx } from '../ctx';
import { ReconVisuals } from './ExtraVisuals';
import { ChartCard } from '../Chart';
import { Section, Chip, Disclaimer, Table, Kpi } from '../common';
import { fmtINR, fmtPct, fmtCr } from '../../engine/format';
import { monthLabel } from '../../engine/utils';

export function Recon(ctx: PageCtx) {
  const { a, inp, themeKey, exporting } = ctx;
  const r = a.recon;
  const o = r.overlap;
  return (
    <>
      <div className="grid g4">
        <Kpi label="Reconciliation status" value={<Chip s={r.overallStatus} />} />
        <Kpi label="GST vs banking (same months)" value={fmtPct(o?.variance)} delta={o?.label || 'No overlapping months'} />
        <Kpi label="Buyers traced in bank" value={fmtPct(r.buyers.matchedShare)} delta="of GST sales value (overlap months)" />
        <Kpi label="Suppliers traced in bank" value={fmtPct(r.suppliers.matchedShare)} delta="of GST purchase value (overlap months)" />
      </div>
      {r.coverageNote && <div className="note warn" style={{ marginTop: 10 }}>{r.coverageNote}</div>}

      <Section num="26" title="Financial vs GST vs Banking — year-wise" />
      <Table rows={r.fyRows} cols={[
        { key: 'fy', label: 'Financial year', render: (x) => <b>{x.fy}</b> },
        { key: 'financial', label: 'Financial turnover', num: true, render: (x) => fmtINR(x.financial) },
        { key: 'gst', label: 'GST turnover', num: true, render: (x) => <>{fmtINR(x.gst)}{x.gst !== null && <div className="small muted">{x.gstMonths} month(s)</div>}</> },
        { key: 'varGst', label: 'Variance (GST vs books)', num: true, render: (x) => fmtPct(x.varGst) },
        { key: 'bankGross', label: 'Gross banking inflow', num: true, render: (x) => <>{fmtINR(x.bankGross)}{x.bankGross !== null && <div className="small muted">{x.bankMonths} month(s)</div>}</> },
        { key: 'bankAdjusted', label: 'Adjusted business inflow', num: true, render: (x) => fmtINR(x.bankAdjusted) },
        { key: 'status', label: 'AI reconciliation status', render: (x) => <Chip s={x.status} /> },
        { key: 'remarks', label: 'AI remarks', wrap: true, render: (x) => <span className="small">{x.remarks.join('. ') || '—'}</span> },
      ]} />

      <Section num="26" title={`Cross-validation on the same months${o ? ` — ${o.label}` : ''}`} right={o && <Chip s={o.status} />} />
      {!o && <div className="note">GST and banking data do not cover any common month, so a month-matched comparison is not possible.</div>}
      {o && (
        <div className="grid g2">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Source</th><th className="num">Reported amount</th><th className="num">Variance</th></tr></thead>
              <tbody>
                <tr><td>GST turnover (taxable value)</td><td className="num">{fmtINR(o.gstTaxable)}</td><td></td></tr>
                <tr><td>GST turnover incl. GST @ {inp.gstGrossUpPct}% (comparable to bank receipts)</td><td className="num">{fmtINR(o.gstGross)}</td><td></td></tr>
                <tr><td>Gross banking inflow</td><td className="num">{fmtINR(o.bankGross)}</td><td className="num">{fmtPct((o.bankGross - o.gstGross) / o.gstGross)}</td></tr>
                <tr><td>Less: internal transfers</td><td className="num">−{fmtINR(o.internal)}</td><td></td></tr>
                <tr><td>Less: loan / non-business credits</td><td className="num">−{fmtINR(o.loans)}</td><td></td></tr>
                <tr><td>Less: returns & reversals</td><td className="num">−{fmtINR(o.returns)}</td><td></td></tr>
                <tr><td>Less: promoter / director credits</td><td className="num">−{fmtINR(o.promoter)}</td><td></td></tr>
                <tr><td>Less: group / related credits</td><td className="num">−{fmtINR(o.group)}</td><td></td></tr>
                <tr className="sub"><td>Adjusted business inflow</td><td className="num">{fmtINR(o.bankAdjusted)}</td><td className="num">{fmtPct(o.variance)}</td></tr>
              </tbody>
            </table>
          </div>
          <ChartCard title="GST sales (incl. tax) vs adjusted bank inflow" themeKey={themeKey} spec={{ categories: o.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'bar', series: [{ name: 'GST sales incl. tax', data: o.monthly.map((m) => m.gstGross) }, { name: 'Adjusted bank inflow', data: o.monthly.map((m) => m.bankAdjusted), slot: 2 }] }} />
        </div>
      )}
      {o && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="card-title">AI explanation of the difference</div>
          <ul className="clean">
            <li>Adjusted banking inflow is {fmtCr(Math.abs(o.bankAdjusted - o.gstGross))} {o.bankAdjusted < o.gstGross ? 'lower' : 'higher'} than GST sales including tax ({fmtPct(o.variance)}).</li>
            {o.lagNote && <li>{o.lagNote}</li>}
            {o.promoter > 0 && <li>Promoter / director credits of {fmtCr(o.promoter)} are excluded — they fund operations but are not sales receipts.</li>}
            {o.internal > 0 && <li>Internal transfers of {fmtCr(o.internal)} (own accounts / FD) are excluded.</li>}
            {r.coverageNote && <li>{r.coverageNote}</li>}
            <li>Receipts may also come into bank accounts not provided for analysis.</li>
          </ul>
        </div>
      )}

      <Section num="27" title="Buyer vs banking reconciliation (party-wise, triangular)" />
      <div className="note small">Each GST buyer's sales in the overlap months (grossed up for GST) are matched against credits received from the same party in the bank statements. Matching uses name similarity on bank narrations, so it is subject to narration quality.</div>
      <Table rows={r.buyers.rows} maxHeight={420} initialSort={{ key: 'gstAmount', dir: -1 }} cols={[
        { key: 'gstParty', label: 'GST buyer', wrap: true, sort: (x) => x.gstParty, render: (x) => <><b>{x.gstParty}</b><div className="small muted">{x.gstin}</div></> },
        { key: 'gstAmount', label: 'GST sales', num: true, sort: (x) => x.gstAmount, render: (x) => fmtINR(x.gstAmount) },
        { key: 'gstGross', label: 'Incl. GST', num: true, render: (x) => fmtINR(x.gstGross) },
        { key: 'bankParty', label: 'Matched bank party', wrap: true, render: (x) => <span className="small">{x.bankParty}</span> },
        { key: 'bankAmount', label: 'Bank receipts', num: true, sort: (x) => x.bankAmount, render: (x) => fmtINR(x.bankAmount) },
        { key: 'variance', label: 'Variance', num: true, render: (x) => fmtPct(x.variance) },
        { key: 'status', label: 'Status', render: (x) => <Chip s={x.status} tone={x.status === 'Matched' ? 'good' : x.status === 'Partially matched' ? 'warn' : 'serious'} /> },
      ]} />
      <div className="card-title" style={{ margin: '12px 0 6px' }}>Large banking credits from parties not found among GST buyers</div>
      <Table rows={(exporting ? r.buyers.unmatchedBankCredits : r.buyers.unmatchedBankCredits.slice(0, 15))} cols={[{ key: 'party', label: 'Bank party', wrap: true }, { key: 'amount', label: 'Credits', num: true, render: (x) => fmtINR(x.amount) }]} />

      <Section num="28" title="Supplier vs banking reconciliation" />
      <Table rows={r.suppliers.rows} maxHeight={420} initialSort={{ key: 'gstAmount', dir: -1 }} cols={[
        { key: 'gstParty', label: 'GST supplier', wrap: true, sort: (x) => x.gstParty, render: (x) => <><b>{x.gstParty}</b><div className="small muted">{x.gstin}</div></> },
        { key: 'gstAmount', label: 'GST purchases', num: true, sort: (x) => x.gstAmount, render: (x) => fmtINR(x.gstAmount) },
        { key: 'gstGross', label: 'Incl. GST', num: true, render: (x) => fmtINR(x.gstGross) },
        { key: 'bankParty', label: 'Matched bank party', wrap: true, render: (x) => <span className="small">{x.bankParty}</span> },
        { key: 'bankAmount', label: 'Bank payments', num: true, sort: (x) => x.bankAmount, render: (x) => fmtINR(x.bankAmount) },
        { key: 'status', label: 'Status', render: (x) => <Chip s={x.status} tone={x.status === 'Matched' ? 'good' : x.status === 'Partially matched' ? 'warn' : 'serious'} /> },
      ]} />
      <div className="card-title" style={{ margin: '12px 0 6px' }}>Large payments to parties not found among GST suppliers</div>
      <Table rows={(exporting ? r.suppliers.unmatchedBankDebits : r.suppliers.unmatchedBankDebits.slice(0, 15))} cols={[{ key: 'party', label: 'Bank party', wrap: true }, { key: 'amount', label: 'Payments', num: true, render: (x) => fmtINR(x.amount) }]} />
      <ReconVisuals {...ctx} />
      <Disclaimer />
    </>
  );
}
