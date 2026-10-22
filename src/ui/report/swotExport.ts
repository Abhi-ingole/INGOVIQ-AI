/* SWOT report downloads (PDF / Excel) — every item with its evidence, severity and recommendation. */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { SwotResult, SwotType } from '../../engine/swot';
import type { EvidenceItem } from '../../engine/evidence';

const T = (v: unknown) => String(v ?? '').replace(/-?₹/g, (m) => (m.startsWith('-') ? '-Rs ' : 'Rs ')).replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/±/g, '+/-');
const TYPES: SwotType[] = ['Strength', 'Weakness', 'Opportunity', 'Threat'];
const COLORS: Record<SwotType, [number, number, number]> = { Strength: [22, 128, 61], Weakness: [180, 83, 9], Opportunity: [31, 79, 209], Threat: [185, 28, 28] };
const fileSafe = (s: string) => s.replace(/[^\w]+/g, '_').slice(0, 40);

export function swotPdf(company: string, swot: SwotResult, evidence: EvidenceItem[], withDisclaimer = false, disclaimer = '') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(11, 27, 63);
  doc.text('AI SWOT ANALYSIS — evidence based', M, 16);
  doc.setFontSize(11); doc.setTextColor(31, 79, 209); doc.text(T(company), M, 23);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text(T(`Generated ${new Date().toLocaleString('en-IN')} by INGOVIZ AI from: ${swot.generatedFrom.join(', ') || 'uploaded data'} · ${swot.counts.Strength} strengths · ${swot.counts.Weakness} weaknesses · ${swot.counts.Opportunity} opportunities · ${swot.counts.Threat} threats · ${swot.highRisks} high-severity risks`), M, 29);
  // summary grid
  let y = 34;
  autoTable(doc, {
    startY: y, margin: { left: M, right: M },
    head: [TYPES.map((t) => `${t.toUpperCase()}S (${swot.counts[t]})`)],
    body: Array.from({ length: Math.max(...TYPES.map((t) => swot.items.filter((i) => i.type === t).length), 1) }, (_, r) => TYPES.map((t) => { const it = swot.items.filter((i) => i.type === t)[r]; return it ? T(`${it.title}${it.type === 'Weakness' || it.type === 'Threat' ? ` [${it.severity}]` : ''}`) : ''; })),
    styles: { fontSize: 8, cellPadding: 1.6, valign: 'top' }, theme: 'grid',
    headStyles: { fillColor: [11, 27, 63], textColor: 255 },
    didParseCell: (d) => { if (d.section === 'head') d.cell.styles.fillColor = COLORS[TYPES[d.column.index]]; },
  });
  // detail tables
  for (const t of TYPES) {
    const rows = swot.items.filter((i) => i.type === t);
    if (!rows.length) continue;
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...COLORS[t]); doc.text(`${t}s`, M, 15);
    const risky = t === 'Weakness' || t === 'Threat';
    autoTable(doc, {
      startY: 19, margin: { left: M, right: M },
      head: [['#', 'Observation', 'Evidence (metric / value / benchmark)', 'Source', ...(risky ? ['Severity', 'AI recommendation'] : ['How to use it'])]],
      body: rows.map((r, i) => [String(i + 1), T(`${r.title}\n${r.detail}`), T(`${r.metric}: ${r.value}\nBenchmark: ${r.benchmark}\nSection ${r.section}`), T(r.source), ...(risky ? [r.severity, T(r.recommendation)] : [T(r.recommendation || '—')])]),
      styles: { fontSize: 7.8, cellPadding: 1.5, valign: 'top', overflow: 'linebreak' }, theme: 'grid',
      headStyles: { fillColor: COLORS[t], textColor: 255 },
      columnStyles: risky ? { 0: { cellWidth: 7 }, 1: { cellWidth: 70 }, 2: { cellWidth: 52 }, 3: { cellWidth: 38 }, 4: { cellWidth: 18 }, 5: { cellWidth: 'auto' } } : { 0: { cellWidth: 7 }, 1: { cellWidth: 90 }, 2: { cellWidth: 60 }, 3: { cellWidth: 45 } },
      didParseCell: (d) => { if (risky && d.section === 'body' && d.column.index === 4) { const s = String(d.cell.raw); d.cell.styles.textColor = s === 'High' ? [185, 28, 28] : s === 'Medium' ? [180, 83, 9] : [22, 128, 61]; d.cell.styles.fontStyle = 'bold'; } },
    });
  }
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(11, 27, 63); doc.text('Evidence register', M, 15);
  autoTable(doc, { startY: 19, margin: { left: M, right: M }, head: [['ID', 'File', 'Document type', 'What was read']], body: evidence.map((e) => [e.id, T(e.file), T(e.type), T(e.used)]), styles: { fontSize: 7.5, cellPadding: 1.2 }, theme: 'grid', headStyles: { fillColor: [236, 241, 252], textColor: [11, 27, 63] } });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
    if (withDisclaimer && disclaimer) { doc.setFontSize(5.8); doc.text(doc.splitTextToSize(disclaimer, W - 2 * M), M, H - 14); doc.setFontSize(7.5); }
    doc.text(T(`INGOVIZ AI · ${company} · SWOT`), M, H - 5); doc.text(`Page ${i} of ${n}`, W - M, H - 5, { align: 'right' });
  }
  doc.save(`INGOVIZ_SWOT_${fileSafe(company)}.pdf`);
}

export function swotExcel(company: string, swot: SwotResult, evidence: EvidenceItem[]) {
  const wb = XLSX.utils.book_new();
  const rows = [['Type', 'Observation', 'Detail', 'Metric', 'Value', 'Benchmark', 'Severity', 'Source (evidence)', 'Report section', 'AI recommendation'],
    ...swot.items.map((i) => [i.type, i.title, i.detail, i.metric, i.value, i.benchmark, i.type === 'Weakness' || i.type === 'Threat' ? i.severity : '', i.source, i.section, i.recommendation])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [12, 34, 60, 26, 16, 18, 10, 34, 12, 70].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: 9 } }) };
  XLSX.utils.book_append_sheet(wb, ws, 'SWOT');
  const sum = XLSX.utils.aoa_to_sheet([['Company', company], ['Generated', new Date().toLocaleString('en-IN')], ['Based on', swot.generatedFrom.join(', ')], [], ['Type', 'Count', 'High', 'Medium', 'Low'], ...TYPES.map((t) => [t, swot.counts[t], ...(['High', 'Medium', 'Low'] as const).map((s) => swot.items.filter((i) => i.type === t && i.severity === s).length)])]);
  sum['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, sum, 'Summary');
  const evs = XLSX.utils.aoa_to_sheet([['ID', 'File', 'Document type', 'What was read'], ...evidence.map((e) => [e.id, e.file, e.type, e.used])]);
  evs['!cols'] = [{ wch: 6 }, { wch: 80 }, { wch: 28 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, evs, 'Evidence');
  XLSX.writeFile(wb, `INGOVIZ_SWOT_${fileSafe(company)}.xlsx`);
}
