import { describe, expect, it } from 'vitest';
import { schedule, ScheduleError, type SchedTaskInput } from '../src/scheduling/scheduler';
import { WorkCalendar } from '../src/scheduling/calendar';

// 2026-11-02 is a Monday.
const project = { startDate: '2026-11-02', workingDays: [1, 2, 3, 4, 5], holidays: [] as string[] };

let seq = 0;
function task(partial: Partial<SchedTaskInput> & { id: string }): SchedTaskInput {
  return {
    parent: null,
    order: seq++,
    name: partial.id,
    duration: 1,
    constraintStart: null,
    percentComplete: 0,
    predecessors: [],
    ...partial,
  };
}

describe('WorkCalendar', () => {
  it('skips weekends and holidays', () => {
    const cal = new WorkCalendar('2026-11-02', [1, 2, 3, 4, 5], ['2026-11-04']);
    expect(cal.dateAt(0)).toBe('2026-11-02');
    expect(cal.dateAt(2)).toBe('2026-11-05'); // Wed is a holiday
    expect(cal.dateAt(4)).toBe('2026-11-09'); // skips the weekend
    expect(cal.indexOf('2026-11-07')).toBe(4); // Saturday → next Monday
  });

  it('starts on the first working day when the project starts on a weekend', () => {
    const cal = new WorkCalendar('2026-11-01', [1, 2, 3, 4, 5]); // Sunday
    expect(cal.dateAt(0)).toBe('2026-11-02');
  });
});

describe('schedule', () => {
  it('chains Finish-to-Start links across a weekend', () => {
    const out = schedule(project, [
      task({ id: 'a', duration: 3 }),
      task({ id: 'b', duration: 3, predecessors: [{ task: 'a', type: 'FS', lag: 0 }] }),
    ]);
    expect(out.results.get('a')).toMatchObject({ start: '2026-11-02', finish: '2026-11-04' });
    expect(out.results.get('b')).toMatchObject({ start: '2026-11-05', finish: '2026-11-09' });
    expect(out.finishDate).toBe('2026-11-09');
  });

  it('supports SS, FF, SF and lag', () => {
    const out = schedule(project, [
      task({ id: 'a', duration: 5 }),
      task({ id: 'ss', duration: 2, predecessors: [{ task: 'a', type: 'SS', lag: 2 }] }),
      task({ id: 'ff', duration: 2, predecessors: [{ task: 'a', type: 'FF', lag: 0 }] }),
      task({ id: 'sf', duration: 2, predecessors: [{ task: 'a', type: 'SF', lag: 3 }] }),
      task({ id: 'lag', duration: 1, predecessors: [{ task: 'a', type: 'FS', lag: 1 }] }),
    ]);
    expect(out.results.get('ss')!.start).toBe('2026-11-04');
    expect(out.results.get('ff')!.finish).toBe('2026-11-06');
    expect(out.results.get('sf')!.finish).toBe('2026-11-04');
    expect(out.results.get('lag')!.start).toBe('2026-11-10');
  });

  it('treats duration 0 as a milestone on the predecessor finish day', () => {
    const out = schedule(project, [
      task({ id: 'a', duration: 2 }),
      task({ id: 'm', duration: 0, predecessors: [{ task: 'a', type: 'FS', lag: 0 }] }),
    ]);
    expect(out.results.get('m')).toMatchObject({ isMilestone: true, start: '2026-11-04', finish: '2026-11-04' });
  });

  it('honours Start No Earlier Than constraints', () => {
    const out = schedule(project, [task({ id: 'a', duration: 1, constraintStart: '2026-11-14' })]);
    expect(out.results.get('a')!.start).toBe('2026-11-16');
  });

  it('rolls up summary dates and weighted percent complete', () => {
    const out = schedule(project, [
      task({ id: 'p', duration: 99 }),
      task({ id: 'c1', parent: 'p', duration: 2, percentComplete: 100 }),
      task({ id: 'c2', parent: 'p', duration: 2, percentComplete: 0, predecessors: [{ task: 'c1', type: 'FS', lag: 0 }] }),
    ]);
    expect(out.results.get('p')).toMatchObject({
      isSummary: true,
      start: '2026-11-02',
      finish: '2026-11-05',
      duration: 4,
      percentComplete: 50,
      wbs: '1',
    });
    expect(out.results.get('c2')).toMatchObject({ wbs: '1.2', outlineLevel: 1, rowNumber: 3 });
    expect(out.percentComplete).toBe(50);
  });

  it('pushes the children of a summary that has a predecessor', () => {
    const out = schedule(project, [
      task({ id: 'a', duration: 3 }),
      task({ id: 'p', predecessors: [{ task: 'a', type: 'FS', lag: 0 }] }),
      task({ id: 'c', parent: 'p', duration: 1 }),
    ]);
    expect(out.results.get('c')!.start).toBe('2026-11-05');
    expect(out.results.get('p')!.start).toBe('2026-11-05');
  });

  it('marks the critical path', () => {
    const out = schedule(project, [
      task({ id: 'a', duration: 2 }),
      task({ id: 'long', duration: 5, predecessors: [{ task: 'a', type: 'FS', lag: 0 }] }),
      task({ id: 'short', duration: 1, predecessors: [{ task: 'a', type: 'FS', lag: 0 }] }),
      task({ id: 'end', duration: 1, predecessors: [{ task: 'long', type: 'FS', lag: 0 }, { task: 'short', type: 'FS', lag: 0 }] }),
    ]);
    expect(out.results.get('a')!.isCritical).toBe(true);
    expect(out.results.get('long')!.isCritical).toBe(true);
    expect(out.results.get('end')!.isCritical).toBe(true);
    expect(out.results.get('short')).toMatchObject({ isCritical: false, totalSlack: 4 });
  });

  it('rejects circular dependencies', () => {
    expect(() =>
      schedule(project, [
        task({ id: 'a', predecessors: [{ task: 'b', type: 'FS', lag: 0 }] }),
        task({ id: 'b', predecessors: [{ task: 'a', type: 'FS', lag: 0 }] }),
      ]),
    ).toThrow(ScheduleError);
  });

  it('rejects a child depending on its own summary finishing', () => {
    expect(() =>
      schedule(project, [
        task({ id: 'p' }),
        task({ id: 'c', parent: 'p', predecessors: [{ task: 'p', type: 'FS', lag: 0 }] }),
      ]),
    ).toThrow(ScheduleError);
  });

  it('rejects finish-based links into a summary task', () => {
    expect(() =>
      schedule(project, [
        task({ id: 'a' }),
        task({ id: 'p', predecessors: [{ task: 'a', type: 'FF', lag: 0 }] }),
        task({ id: 'c', parent: 'p' }),
      ]),
    ).toThrow(/summary task/);
  });

  it('handles an empty plan', () => {
    const out = schedule(project, []);
    expect(out.finishDate).toBe('2026-11-02');
    expect(out.percentComplete).toBe(0);
  });
});
