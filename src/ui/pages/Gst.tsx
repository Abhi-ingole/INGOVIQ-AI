import { useState } from 'react';
import type { PageCtx } from '../ctx';
import { pickFYs } from '../ctx';
import { ChartCard } from '../Chart';
import { Section, Chip, Disclaimer, NoData, Kpi, Table, Arrow } from '../common';
import { fmtCr, fmtINR, fmtPct, fmtX } from '../../engine/format';
import { monthLabel } from '../../engine/utils';

export function Gst({ a, fySel, themeKey }: PageCtx) {
  const g = a.gst;
  const [fyTab, setFyTab] = useState<string | null>(null);
  if (!g) return <><NoData what="GST analysis report" /><Disclaimer /></>;
  const fys = pickFYs(g.fys, fySel.filter((f) => g.fys.includes(f)));
  const fy = fyTab && g.fys.includes(fyTab) ? fyTab : fys[fys.length - 1] || g.fys[g.fys.length - 1];
  const monthsIn = (f: string) => g.monthly.filter((m) => m.fy === f && (m.revenue || m.purchase)).length;
  const buyers = g.buyers[fy] || [];
  const suppliers = g.suppliers[fy] || [];
  const cb = g.concentration.buyers.find((c) => c.fy === fy);
  const cs = g.concentration.suppliers.find((c) => c.fy === fy);
  const st = g.states.find((s) => s.fy === fy);
  const monthly = g.monthly.filter((m) => fys.includes(m.fy));
  const ex = g.exports.find((e) => e.fy === fy);
  const fyTabs = <div style={{ display: 'flex', gap: 4 }}>{g.fys.map((f) => <button key={f} className={`btn small ${f === fy ? 'primary' : ''}`} onClick={() => setFyTab(f)}>{f}</button>)}</div>;

  return (
    <>
      <div className="grid g5">
        <Kpi label={`GST Sales ${fy}`} value={fmtCr(g.revenueFY[fy])} delta={<>{monthsIn(fy)} months {g.revenueYoY[fy] != null && monthsIn(fy) >= 12 && <Arrow v={g.revenueYoY[fy]} />}</>} />
        <Kpi label="GST Purchases & Expenses" value={fmtCr(g.purchaseFY[fy])} delta={`Sales ÷ Purchases ${fmtX(g.salesPurchaseFY.find((x) => x.fy === fy)?.ratio)}`} />
        <Kpi label="Top-5 Buyer Share" value={fmtPct(cb?.top5)} delta={<Chip s={`${cb?.risk || 'N/A'} concentration`} tone={cb?.risk === 'High' ? 'serious' : cb?.risk === 'Moderate' ? 'warn' : 'good'} />} />
        <Kpi label="Export Ratio" value={fmtPct(ex?.ratio)} delta={`Exports ${fmtCr(ex?.export)}`} />
        <Kpi label="Filing Compliance" value={g.filing.compliance} delta={`${g.filing.summary.lateReturns}/${g.filing.summary.totalReturns} late · max ${g.filing.summary.maxDelay}d`} />
      </div>

      <Section num="6" title="GST sales & purchase analysis" />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Financial year</th><th className="num">Months with data</th><th className="num">Sales (taxable)</th><th className="num">Purchases & expenses</th><th className="num">Margin</th><th className="num">Sales-to-Purchase</th><th className="num">Sales YoY</th></tr></thead>
          <tbody>{g.salesPurchaseFY.map((r) => <tr key={r.fy}><td>{r.fy}</td><td className="num">{monthsIn(r.fy)}</td><td className="num">{fmtINR(r.sales)}</td><td className="num">{fmtINR(r.purchase)}</td><td className="num">{fmtINR(r.sales - r.purchase)}</td><td className="num">{fmtX(r.ratio)}</td><td className="num">{monthsIn(r.fy) >= 12 ? <Arrow v={g.revenueYoY[r.fy]} /> : <span className="muted small">partial year</span>}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <ChartCard title="Monthly sales vs purchases" themeKey={themeKey} spec={{ categories: monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'bar', series: [{ name: 'Sales', data: monthly.map((m) => m.revenue) }, { name: 'Purchases', data: monthly.map((m) => m.purchase), slot: 1 }] }} />
        <ChartCard title="Sales-to-purchase ratio (monthly)" sub="Above 1x = sales exceed purchases" themeKey={themeKey} spec={{ categories: monthly.map((m) => monthLabel(m.month)), unit: 'x', type: 'line', series: [{ name: 'Sales ÷ Purchases', data: monthly.map((m) => m.ratio) }] }} />
      </div>
      {g.unusualMonths.length > 0 && <div className="note warn"><b>Unusual movement between sales and purchases:</b> {g.unusualMonths.map((u) => `${monthLabel(u.month)} — ${u.note}`).join(' · ')}</div>}

      <Section num="6.1" title="Buyer analysis" right={fyTabs} />
      <div className="grid g4" style={{ marginBottom: 10 }}>
        <Kpi label="Top 5 buyer concentration" value={fmtPct(cb?.top5)} />
        <Kpi label="Top 10 buyer concentration" value={fmtPct(cb?.top10)} />
        <Kpi label="Largest buyer contribution" value={fmtPct(cb?.top1)} delta={cb?.largestName} />
        <Kpi label="Customer diversification" value={`${cb?.count ?? 0} buyers`} delta={<>HHI {cb?.hhi != null ? (cb.hhi * 10000).toFixed(0) : '—'} · Risk <Chip s={cb?.risk || 'N/A'} tone={cb?.risk === 'High' ? 'serious' : cb?.risk === 'Moderate' ? 'warn' : 'good'} /></>} />
      </div>
      <div className="grid g2">
        <Table rows={buyers} maxHeight={380} initialSort={{ key: 'total', dir: -1 }} cols={[
          { key: 'name', label: 'Buyer', sort: (r) => r.name, wrap: true, render: (r) => <><b>{r.name}</b><div className="small muted">{r.gstin}</div></> },
          { key: 'total', label: 'Total Sales', num: true, sort: (r) => r.total, render: (r) => fmtINR(r.total) },
          { key: 'share', label: '% of Sales', num: true, sort: (r) => r.share, render: (r) => fmtPct(r.share) },
          { key: 'state', label: 'State', sort: (r) => r.state },
          { key: 'months', label: 'Months', num: true, sort: (r) => r.months },
          { key: 'trend', label: 'Transaction Trend', render: (r) => <Chip s={r.trend} tone={r.trend === 'Growing' ? 'good' : r.trend === 'Declining' ? 'serious' : 'neutral'} /> },
        ]} />
        <ChartCard title={`Top 10 buyers — ${fy}`} themeKey={themeKey} height={380} spec={{ categories: buyers.slice(0, 10).map((b) => b.name.slice(0, 28)), unit: 'inr', type: 'hbar', series: [{ name: 'Sales', data: buyers.slice(0, 10).map((b) => b.total) }] }} />
      </div>

      <Section num="7" title="Supplier analysis" right={fyTabs} />
      <div className="grid g4" style={{ marginBottom: 10 }}>
        <Kpi label="Top 5 supplier concentration" value={fmtPct(cs?.top5)} />
        <Kpi label="Top 10 supplier concentration" value={fmtPct(cs?.top10)} />
        <Kpi label="Largest supplier contribution" value={fmtPct(cs?.top1)} delta={cs?.largestName} />
        <Kpi label="Supplier dependency" value={`${cs?.count ?? 0} suppliers`} delta={<>Risk <Chip s={cs?.risk || 'N/A'} tone={cs?.risk === 'High' ? 'serious' : cs?.risk === 'Moderate' ? 'warn' : 'good'} /></>} />
      </div>
      <div className="grid g2">
        <Table rows={suppliers} maxHeight={380} initialSort={{ key: 'total', dir: -1 }} cols={[
          { key: 'name', label: 'Supplier', sort: (r) => r.name, wrap: true, render: (r) => <><b>{r.name}</b><div className="small muted">{r.gstin}</div></> },
          { key: 'total', label: 'Total Purchase', num: true, sort: (r) => r.total, render: (r) => fmtINR(r.total) },
          { key: 'share', label: '% of Purchase', num: true, sort: (r) => r.share, render: (r) => fmtPct(r.share) },
          { key: 'state', label: 'State', sort: (r) => r.state },
          { key: 'trend', label: 'Transaction Trend', render: (r) => <Chip s={r.trend} tone={r.trend === 'Growing' ? 'good' : r.trend === 'Declining' ? 'serious' : 'neutral'} /> },
        ]} />
        <ChartCard title={`Top 10 suppliers — ${fy}`} themeKey={themeKey} height={380} spec={{ categories: suppliers.slice(0, 10).map((b) => b.name.slice(0, 28)), unit: 'inr', type: 'hbar', series: [{ name: 'Purchases', data: suppliers.slice(0, 10).map((b) => b.total), slot: 1 }] }} />
      </div>

      <Section num="8" title="Sales-to-purchase ratio" />
      <div className="note small">Month-wise trend is charted in section 6. Annual: {g.salesPurchaseFY.map((r) => `${r.fy} ${fmtX(r.ratio)}`).join(' · ')}</div>

      <Section num="9" title="Export analysis" />
      <div className="grid g2">
        <Table rows={g.exports} cols={[
          { key: 'fy', label: 'Financial year' },
          { key: 'domestic', label: 'Domestic sales', num: true, render: (r) => fmtINR(r.domestic) },
          { key: 'export', label: 'Export sales', num: true, render: (r) => fmtINR(r.export) },
          { key: 'total', label: 'Total turnover', num: true, render: (r) => fmtINR(r.total) },
          { key: 'ratio', label: 'Export ratio', num: true, render: (r) => fmtPct(r.ratio) },
          { key: 'growth', label: 'Export growth', num: true, render: (r) => (r.growth === null ? '—' : <Arrow v={r.growth} />) },
        ]} />
        <div className="card"><div className="card-title">Export dependency</div><div style={{ marginTop: 8 }}><Chip s={g.exportDependency} /></div><div className="small muted" style={{ marginTop: 8 }}>Export Ratio = Export Turnover ÷ Annual Turnover × 100. Low ≤ 20%, Moderate 20–50%, High &gt; 50%.</div></div>
      </div>

      <Section num="10" title="GST filing analysis" right={<Chip s={g.filing.compliance} />} />
      <div className="grid g5" style={{ marginBottom: 10 }}>
        <Kpi label="Returns analysed" value={g.filing.summary.totalReturns} delta={`${g.filing.summary.establishments} GSTIN(s)`} />
        <Kpi label="Late filings" value={g.filing.summary.lateReturns} delta={fmtPct(g.filing.summary.latePct)} deltaGood={g.filing.summary.latePct < 0.1} />
        <Kpi label="Average delay (late returns)" value={`${g.filing.summary.avgDelay.toFixed(1)} days`} />
        <Kpi label="Maximum delay" value={`${g.filing.summary.maxDelay} days`} />
        <Kpi label="Estimated late fee" value={fmtINR(g.filing.summary.estLateFee)} title="₹50/day per return (CGST+SGST), capped at ₹10,000 per return — estimate" />
      </div>
      <Table rows={g.filing.byGstin} cols={[
        { key: 'gstin', label: 'GSTIN', render: (r) => <span className="code">{r.gstin}</span> },
        { key: 'state', label: 'State' }, { key: 'returnType', label: 'Return' },
        { key: 'total', label: 'Filed', num: true }, { key: 'late', label: 'Late', num: true },
        { key: 'avgDelay', label: 'Avg delay', num: true, render: (r) => `${r.avgDelay.toFixed(1)}d` },
        { key: 'maxDelay', label: 'Max delay', num: true, render: (r) => `${r.maxDelay}d` },
        { key: 'lateFee', label: 'Est. late fee', num: true, render: (r) => fmtINR(r.lateFee) },
        { key: 'missing', label: 'Missing periods', render: (r) => (r.missing.length ? r.missing.map(monthLabel).join(', ') : 'None'), wrap: true },
      ]} />
      <div style={{ marginTop: 12 }}>
        <ChartCard title="Filing delay by tax period (GSTR-3B, all GSTINs)" sub="Days filed after due date — 0 = on time" themeKey={themeKey}
          spec={(() => {
            const rows = g.filing.rows.filter((r) => /3B/.test(r.returnType));
            const periods = [...new Set(rows.map((r) => r.period))].sort();
            const gstins = [...new Set(rows.map((r) => r.gstin))].slice(0, 6);
            return { categories: periods.map(monthLabel), unit: 'num', type: 'bar', series: gstins.map((gs, i) => ({ name: `${gs.slice(0, 2)}-${rows.find((r) => r.gstin === gs)?.state || gs}`, data: periods.map((p) => rows.find((r) => r.gstin === gs && r.period === p)?.delayDays ?? null), slot: i })) };
          })()} />
      </div>
      <details style={{ marginTop: 8 }}><summary className="small" style={{ cursor: 'pointer' }}>Show every filing (filing date vs due date)</summary>
        <Table rows={g.filing.rows} maxHeight={360} cols={[
          { key: 'gstin', label: 'GSTIN', render: (r) => <span className="code">{r.gstin}</span>, sort: (r) => r.gstin }, { key: 'returnType', label: 'Return', sort: (r) => r.returnType },
          { key: 'period', label: 'Period', render: (r) => monthLabel(r.period), sort: (r) => r.period }, { key: 'due', label: 'Due date', sort: (r) => r.due }, { key: 'filed', label: 'Filed on', sort: (r) => r.filed },
          { key: 'delayDays', label: 'Delay', num: true, sort: (r) => r.delayDays, render: (r) => (r.delayDays > 0 ? <span className="down">{r.delayDays} days</span> : 'On time') },
        ]} />
      </details>

      <Section num="11" title="State-wise / location-wise revenue" right={fyTabs} />
      <div className="grid g2">
        <Table rows={st?.rows || []} cols={[
          { key: 'state', label: 'State' }, { key: 'sales', label: 'Sales', num: true, render: (r) => fmtINR(r.sales) }, { key: 'salesPct', label: '% Revenue', num: true, render: (r) => fmtPct(r.salesPct) },
          { key: 'purchase', label: 'Purchases', num: true, render: (r) => fmtINR(r.purchase) }, { key: 'purchasePct', label: '% Purchase', num: true, render: (r) => fmtPct(r.purchasePct) },
        ]} />
        <ChartCard title={`Sales by state — ${fy}`} sub={`Geographical concentration: ${g.geoConcentration.find((x) => x.fy === fy)?.topState} ${fmtPct(g.geoConcentration.find((x) => x.fy === fy)?.share)}`} themeKey={themeKey} spec={{ categories: (st?.rows || []).map((r) => r.state), unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'hbar', 'table'], series: [{ name: 'Sales', data: (st?.rows || []).map((r) => r.sales) }] }} />
      </div>

      <Section num="12" title="Intra-group transactions" right={<Chip s={`Related-party dependency: ${g.relatedPartyDependency}`} tone={g.relatedPartyDependency === 'Low' ? 'good' : 'warn'} />} />
      <Table rows={g.intraGroup} cols={[{ key: 'fy', label: 'Financial year' }, { key: 'amount', label: 'Intra-group sales', num: true, render: (r) => fmtINR(r.amount) }, { key: 'pct', label: '% of business', num: true, render: (r) => fmtPct(r.pct) }]} />

      <Section num="13" title="HSN / product-wise analysis" />
      {g.hsn.length ? (
        <Table rows={g.hsn} cols={[{ key: 'code', label: 'HSN Code' }, { key: 'product', label: 'Product', wrap: true }, ...g.fys.map((f) => ({ key: f, label: f, num: true, render: (r: (typeof g.hsn)[number]) => fmtINR(r.byFY[f]) }))]} />
      ) : <div className="note warn">HSN-wise data is not part of the uploaded GST report. Upload a GSTR-1 Table-12 (HSN summary) sheet to enable product concentration and product-wise growth.</div>}

      {g.gstr1vs3b.length > 0 && (
        <>
          <Section title="GSTR-1 vs GSTR-3B revenue" />
          <ChartCard title="Revenue declared: GSTR-1 vs GSTR-3B" sub={`${g.gstr1vs3b.filter((x) => Math.abs(x.diff) > Math.max(1, x.gstr1 * 0.05)).length} month(s) differ by more than 5%`} themeKey={themeKey}
            spec={{ categories: g.gstr1vs3b.filter((x) => x.gstr1 || x.gstr3b).map((x) => monthLabel(x.month)), unit: 'inr', type: 'bar', series: [{ name: 'GSTR-1', data: g.gstr1vs3b.filter((x) => x.gstr1 || x.gstr3b).map((x) => x.gstr1) }, { name: 'GSTR-3B', data: g.gstr1vs3b.filter((x) => x.gstr1 || x.gstr3b).map((x) => x.gstr3b), slot: 1 }] }} />
        </>
      )}
      <Disclaimer />
    </>
  );
}
