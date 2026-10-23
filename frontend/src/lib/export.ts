import { formatPredecessors } from '@/components/gantt/predecessors';
import { addDays, diffDays, fmtDate, monthLabel, parseISO, todayISO } from './dates';
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

function rowsFor(project: Project, tasks: Task[], resourceNames: Map<string, string>) {
  const byId = new Map(tasks.map((t) => [t._id, t]));
  return tasks.map((t) => ({
    id: t.number ? `${project.key}-${t.number}` : String(t.rowNumber),
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
  for (const r of rowsFor(project, tasks, resourceNames)) {
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

  const rows = rowsFor(project, tasks, resourceNames);
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

/**
 * Graphical Gantt chart PDF (A3 landscape): task list on the left, bars, milestones,
 * summary brackets, baseline and today line on the right. Paginates by rows.
 */
export async function exportGanttPdf(project: Project, tasks: Task[], options: { showCritical: boolean; showBaseline: boolean }) {
  const { jsPDF } = await import('jspdf');
  const NAVY: [number, number, number] = [26, 54, 93];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageW = 420;
  const pageH = 297;
  const margin = 10;
  const listW = 120;
  const rowH = 6;
  const headerH = 12;
  const top = 30;
  const chartX = margin + listW;
  const chartW = pageW - margin - chartX;

  const dated = tasks.filter((t) => t.start);
  let min = project.startDate;
  let max = project.finishDate || project.startDate;
  for (const t of dated) {
    if (t.start < min) min = t.start;
    if (t.finish > max) max = t.finish;
    if (options.showBaseline && t.baselineStart && t.baselineStart < min) min = t.baselineStart;
    if (options.showBaseline && t.baselineFinish && t.baselineFinish > max) max = t.baselineFinish;
  }
  const start = addDays(min, -2);
  const days = Math.max(14, diffDays(start, addDays(max, 3)) + 1);
  const dayW = chartW / days;
  const xOf = (iso: string) => chartX + diffDays(start, iso) * dayW;
  const rowsPerPage = Math.floor((pageH - top - headerH - 12) / rowH);
  const pages = Math.max(1, Math.ceil(tasks.length / rowsPerPage));
  const today = todayISO();

  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.addPage();
    // Title bar
    doc.setFillColor(...NAVY);
    doc.rect(margin, margin, pageW - 2 * margin, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(`${project.name} – Gantt chart`, margin + 4, margin + 7.5);
    doc.setFontSize(9);
    doc.text(`${fmtDate(project.startDate)} to ${fmtDate(project.finishDate)}  ·  ${project.stats.percentComplete}% complete  ·  Page ${page + 1} of ${pages}`, pageW - margin - 4, margin + 7.5, { align: 'right' });

    // Timeline header: months on top, day/week ticks below
    const hy = top;
    doc.setDrawColor(220, 224, 230);
    doc.setFillColor(245, 247, 250);
    doc.rect(margin, hy, pageW - 2 * margin, headerH, 'FD');
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('ID', margin + 2, hy + 8);
    doc.text('Task', margin + 16, hy + 8);
    doc.text('Start', margin + 82, hy + 8);
    doc.text('Finish', margin + 101, hy + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const weekly = dayW < 2.5;
    for (let i = 0; i < days; i++) {
      const iso = addDays(start, i);
      const d = new Date(parseISO(iso));
      const x = chartX + i * dayW;
      if (d.getUTCDate() === 1 || i === 0) {
        doc.setDrawColor(200, 205, 212);
        doc.line(x, hy, x, hy + 6);
        doc.text(monthLabel(iso), x + 1, hy + 4.3);
      }
      if (weekly ? d.getUTCDay() === 1 : true) {
        doc.setDrawColor(225, 228, 233);
        doc.line(x, hy + 6, x, hy + headerH);
        if (!weekly || dayW * 7 > 6) doc.text(String(d.getUTCDate()), x + (weekly ? 0.8 : dayW / 2), hy + 10.3, { align: weekly ? 'left' : 'center' });
      }
    }
    doc.setDrawColor(220, 224, 230);
    doc.line(chartX, hy + 6, pageW - margin, hy + 6);
    doc.line(chartX, hy, chartX, hy + headerH);

    // Rows
    const slice = tasks.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    const bodyTop = hy + headerH;
    const bodyH = slice.length * rowH;
    // weekend shading
    if (!weekly) {
      doc.setFillColor(248, 249, 251);
      for (let i = 0; i < days; i++) {
        const iso = addDays(start, i);
        if (!project.workingDays.includes(new Date(parseISO(iso)).getUTCDay()) || project.holidays.includes(iso)) doc.rect(chartX + i * dayW, bodyTop, dayW, bodyH, 'F');
      }
    }
    slice.forEach((t, i) => {
      const y = bodyTop + i * rowH;
      doc.setDrawColor(236, 238, 241);
      doc.line(margin, y + rowH, pageW - margin, y + rowH);
      doc.setTextColor(40, 40, 40);
      doc.setFont('helvetica', t.isSummary ? 'bold' : 'normal');
      doc.setFontSize(7.5);
      doc.text(t.number ? `${project.key}-${t.number}` : String(t.rowNumber), margin + 2, y + 4.2);
      const name = `${' '.repeat(t.outlineLevel * 3)}${t.name}`;
      doc.text(doc.splitTextToSize(name, 63)[0] as string, margin + 16, y + 4.2);
      doc.setFont('helvetica', 'normal');
      doc.text(fmtDate(t.start), margin + 82, y + 4.2);
      doc.text(fmtDate(t.finish), margin + 101, y + 4.2);
      if (!t.start) return;

      const x = xOf(t.start);
      const w = Math.max(dayW, (diffDays(t.start, t.finish) + 1) * dayW);
      const critical = options.showCritical && t.isCritical;
      if (options.showBaseline && t.baselineStart && t.baselineFinish) {
        doc.setFillColor(170, 175, 185);
        doc.rect(xOf(t.baselineStart), y + 4.6, (diffDays(t.baselineStart, t.baselineFinish) + 1) * dayW, 0.9, 'F');
      }
      if (t.isSummary) {
        doc.setFillColor(...(critical ? ([220, 38, 38] as [number, number, number]) : ([55, 65, 81] as [number, number, number])));
        doc.rect(x, y + 1.6, w, 1.8, 'F');
        doc.triangle(x, y + 3.4, x + 1.6, y + 3.4, x, y + 5, 'F');
        doc.triangle(x + w, y + 3.4, x + w - 1.6, y + 3.4, x + w, y + 5, 'F');
      } else if (t.isMilestone) {
        const cx = x + dayW / 2;
        const cy = y + rowH / 2;
        doc.setFillColor(...(critical ? ([220, 38, 38] as [number, number, number]) : ([55, 65, 81] as [number, number, number])));
        doc.triangle(cx - 1.8, cy, cx, cy - 1.8, cx + 1.8, cy, 'F');
        doc.triangle(cx - 1.8, cy, cx, cy + 1.8, cx + 1.8, cy, 'F');
        doc.setFontSize(6.5);
        doc.setTextColor(90, 90, 90);
        doc.text(fmtDate(t.start), cx + 2.6, cy + 1);
      } else {
        const [r, g, b] = critical ? [239, 68, 68] : [249, 115, 22];
        doc.setFillColor(Math.round(r + (255 - r) * 0.6), Math.round(g + (255 - g) * 0.6), Math.round(b + (255 - b) * 0.6));
        doc.roundedRect(x, y + 1.3, w, 3.4, 0.7, 0.7, 'F');
        if (t.percentComplete > 0) {
          doc.setFillColor(r, g, b);
          doc.roundedRect(x, y + 1.3, (w * t.percentComplete) / 100, 3.4, 0.7, 0.7, 'F');
        }
      }
    });

    // Today line
    if (today >= start && diffDays(start, today) < days) {
      doc.setDrawColor(220, 38, 38);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(xOf(today) + dayW / 2, bodyTop, xOf(today) + dayW / 2, bodyTop + bodyH);
      doc.setLineDashPattern([], 0);
    }
    doc.setDrawColor(220, 224, 230);
    doc.rect(margin, hy, pageW - 2 * margin, headerH + bodyH);
    doc.line(chartX, bodyTop, chartX, bodyTop + bodyH);

    // Legend
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const legendY = pageH - 6;
    doc.text(
      `Generated ${fmtDate(today)}  ·  Bars: planned dates (dark part = % complete)${options.showCritical ? '  ·  Red: critical path' : ''}${options.showBaseline ? '  ·  Grey line: baseline' : ''}  ·  Dashed red line: today`,
      margin,
      legendY,
    );
  }
  doc.save(fileName(project, 'gantt.pdf'));
}
