import { formatPredecessors } from '@/components/gantt/predecessors';
import { fmtDate, todayISO } from './dates';
import type { Project, Task } from './types';

function fileName(project: Project, ext: string) {
  return `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'project'} - ${todayISO()}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rowsFor(tasks: Task[], resourceNames: Map<string, string>) {
  const byId = new Map(tasks.map((t) => [t._id, t]));
  return tasks.map((t) => ({
    id: t.rowNumber,
    wbs: t.wbs,
    level: t.outlineLevel,
    name: t.name,
    duration: `${t.duration} day${t.duration === 1 ? '' : 's'}`,
    start: t.start,
    finish: t.finish,
    predecessors: formatPredecessors(t.predecessors, byId),
    resources: t.resources.map((r) => resourceNames.get(r)).filter(Boolean).join(', '),
    percent: t.percentComplete,
    baselineStart: t.baselineStart ?? '',
    baselineFinish: t.baselineFinish ?? '',
    critical: t.isCritical ? 'Yes' : 'No',
    summary: t.isSummary,
  }));
}

/** Excel-compatible CSV (UTF-8 with BOM so Excel opens it correctly). */
export function exportCsv(project: Project, tasks: Task[], resourceNames: Map<string, string>) {
  const header = ['ID', 'WBS', 'Task Name', 'Duration', 'Start', 'Finish', 'Predecessors', 'Resources', '% Complete', 'Baseline Start', 'Baseline Finish', 'Critical'];
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rowsFor(tasks, resourceNames)) {
    lines.push(
      [r.id, r.wbs, `${'  '.repeat(r.level)}${r.name}`, r.duration, r.start, r.finish, r.predecessors, r.resources, r.percent, r.baselineStart, r.baselineFinish, r.critical]
        .map(esc)
        .join(','),
    );
  }
  download(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), fileName(project, 'csv'));
}

/** PDF report — fixed corporate navy header (Nexora PDF rule). */
export async function exportPdf(project: Project, tasks: Task[], resourceNames: Map<string, string>) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const NAVY: [number, number, number] = [26, 54, 93];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFillColor(...NAVY);
  doc.rect(10, 10, 277, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(project.name, 14, 18);
  doc.setFontSize(9);
  doc.text(`Generated ${fmtDate(todayISO())}`, 283, 18, { align: 'right' });

  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const info = [
    `Start: ${fmtDate(project.startDate)}`,
    `Finish: ${fmtDate(project.finishDate)}`,
    `Progress: ${project.stats.percentComplete}%`,
    `Tasks: ${project.stats.taskCount}`,
    `Owner: ${project.owner?.name ?? ''}`,
  ];
  doc.text(info.join('     '), 14, 29);

  const rows = rowsFor(tasks, resourceNames);
  autoTable(doc, {
    startY: 33,
    head: [['ID', 'WBS', 'Task', 'Duration', 'Start', 'Finish', 'Pred.', 'Resources', '%', 'Critical']],
    body: rows.map((r) => [r.id, r.wbs, `${'   '.repeat(r.level)}${r.name}`, r.duration, fmtDate(r.start), fmtDate(r.finish), r.predecessors, r.resources, `${r.percent}%`, r.critical]),
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 14 }, 2: { cellWidth: 70 }, 8: { cellWidth: 12 }, 9: { cellWidth: 14 } },
    didParseCell: (data) => {
      if (data.section === 'body' && rows[data.row.index]?.summary) data.cell.styles.fontStyle = 'bold';
      if (data.section === 'body' && data.column.index === 9 && data.cell.raw === 'Yes') data.cell.styles.textColor = [220, 38, 38];
    },
    margin: { left: 10, right: 10 },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`Page ${i} of ${pages}`, 283, 203, { align: 'right' });
  }
  doc.save(fileName(project, 'pdf'));
}
