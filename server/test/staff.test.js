// Unit tests: attendance, leave, payroll and till takeovers (shared logic in compute.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const KC = require('../public/compute.js');

const ev = (t, hm, date = '2026-11-02') => ({ t, at: date + 'T' + hm + ':00' }); // local time
const S = { staffRules: { workWeek: [1, 2, 3, 4, 5, 6], workStart: '08:00', lateGraceMin: 10, hoursPerDay: 8, overtimeRate: 1.5, leavePerYear: 18 } };

test('day: worked time excludes breaks; lateness after the grace period', () => {
  const a = { date: '2026-11-02', events: [ev('in', '08:25'), ev('break', '12:00'), ev('back', '13:00'), ev('out', '18:25')] };
  const d = KC.dayState(a, '2026-11-03T09:00:00', S);
  assert.equal(d.state, 'done'); assert.equal(d.workedMin, 9 * 60); assert.equal(d.breakMin, 60);
  assert.equal(d.late, true); assert.equal(d.lateMin, 25);
  assert.equal(KC.dayState({ date: '2026-11-02', events: [ev('in', '08:09')] }, '2026-11-02T08:30:00', S).late, false, 'inside grace');
});
test('day: still working counts up to now; forgot to clock out is flagged', () => {
  const a = { date: '2026-11-02', events: [ev('in', '08:00'), ev('break', '10:00')] };
  const now = KC.dayState(a, '2026-11-02T10:30:00', S);
  assert.equal(now.state, 'break'); assert.equal(now.workedMin, 120); assert.equal(now.breakMin, 30);
  assert.deepEqual(KC.clockNext('break'), ['back', 'out']); assert.deepEqual(KC.clockNext('done'), ['in']);
  const later = KC.dayState({ date: '2026-11-02', events: [ev('in', '08:00')] }, '2026-11-04T08:00:00', S);
  assert.equal(later.open, true); assert.equal(later.workedMin, 0, 'an open day is not counted as 48 hours');
});
test('leave: only working days count; balance is pro rata in the first year', () => {
  assert.equal(KC.leaveDates({ from: '2026-11-06', to: '2026-11-09' }, S).length, 3, 'Fri, Sat, Mon — Sunday skipped');
  const staff = { id: 'u_a', startDate: '2026-07-01' };
  const raw = { leaves: [{ id: 'l1', staffId: 'u_a', type: 'vacation', from: '2026-11-02', to: '2026-11-04', status: 'approved' }, { id: 'l2', staffId: 'u_a', type: 'vacation', from: '2026-12-01', to: '2026-12-01', status: 'requested' }] };
  const b = KC.leaveBalance(raw, staff, 2026, S);
  assert.equal(b.entitled, 9); assert.equal(b.taken, 3); assert.equal(b.pending, 1); assert.equal(b.left, 5);
  assert.equal(KC.leaveOverlaps(raw, { id: 'x', staffId: 'u_a', from: '2026-11-04', to: '2026-11-05' }).length, 1);
});
test('payroll: monthly salary minus unpaid leave, advances and cash shortages', () => {
  const staff = { id: 'u_a', userId: 'a', name: 'Ama', startDate: '2026-01-01', pay: { type: 'monthly', rate: 125000 } };
  const raw = {
    attendance: [{ staffId: 'u_a', date: '2026-11-02', events: [ev('in', '08:00'), ev('out', '17:00')] }],
    leaves: [{ staffId: 'u_a', type: 'unpaid', from: '2026-11-03', to: '2026-11-04', status: 'approved' }],
    payroll: [{ type: 'advance', staffId: 'u_a', date: '2026-11-10', amount: 20000 }, { type: 'advance', staffId: 'u_a', date: '2026-10-10', amount: 9999 }],
    handovers: [{ userId: 'a', status: 'confirmed', date: '2026-11-05', diff: -1500 }, { userId: 'a', status: 'submitted', date: '2026-11-06', diff: -800 }],
  };
  const p = KC.payslipDraft(raw, staff, '2026-11', S, {}, '2026-12-01T09:00:00');
  assert.equal(p.stats.scheduled, 25); assert.equal(p.dayRate, 5000);
  assert.equal(p.gross, 125000);
  assert.deepEqual(p.deductions.map((d) => d.amount), [10000, 20000, 1500], 'unpaid 2 days, this month\'s advance, confirmed shortage only');
  assert.equal(p.net, 93500);
  assert.equal(p.stats.absent, 22, 'scheduled days with no clock-in and no leave');
  const strict = KC.payslipDraft(raw, staff, '2026-11', S, { deductAbsences: true, deductShortages: false, extra: { earnings: [{ label: 'Sales bonus', amount: 5000 }] } }, '2026-12-01T09:00:00');
  assert.equal(strict.gross, 130000); assert.equal(strict.deductions.find((d) => /Absent/.test(d.label)).amount, 110000);
  assert.ok(!strict.deductions.some((d) => /shortage/i.test(d.label)));
});
test('payroll: daily and hourly pay come from clocked time, with overtime', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04'].map((d, i) => ({ staffId: 'u_b', date: d, events: [ev('in', '08:00', d), ev('out', i === 2 ? '18:00' : '16:00', d)] }));
  const raw = { attendance: days, leaves: [{ staffId: 'u_b', type: 'sick', from: '2026-11-05', to: '2026-11-05', status: 'approved' }] };
  const daily = KC.payslipDraft(raw, { id: 'u_b', name: 'Bo', pay: { type: 'daily', rate: 4000, overtime: true } }, '2026-11', S, {}, '2026-12-01T09:00:00');
  assert.equal(daily.stats.worked, 3); assert.equal(daily.stats.overtimeH, 2);
  assert.deepEqual(daily.earnings.map((e) => e.amount), [12000, 4000, 1500], '3 days, 1 paid sick day, 2h overtime at 500/h × 1.5');
  const hourly = KC.payslipDraft(raw, { id: 'u_b', name: 'Bo', pay: { type: 'hourly', rate: 600, overtime: true } }, '2026-11', S, {}, '2026-12-01T09:00:00');
  assert.equal(hourly.stats.hours, 26);
  assert.deepEqual(hourly.earnings.map((e) => e.amount), [15600, 4800, 600], 'hours, paid sick day (8h), overtime premium only');
});
test('till takeover moves the expected cash from one cashier to the other', () => {
  const pay = (id, by, amount, method = 'Cash') => ({ id, byId: by, amount, method, date: '2026-11-02' });
  const raw = {
    sales: [{ id: 's1', payments: [pay('p1', 'a', 30000), pay('p2', 'a', 5000, 'MTN MoMo')] }, { id: 's2', payments: [pay('p3', 'b', 8000)] }],
    tills: [{ id: 't1', date: '2026-11-02', fromId: 'a', toId: 'b', status: 'accepted', counted: { Cash: 30000 }, received: { Cash: 29000 } },
      { id: 't2', date: '2026-11-02', fromId: 'b', toId: 'a', status: 'pending', received: {} }],
  };
  const a = KC.collectedBy(raw, 'a', '2026-11-02'), b = KC.collectedBy(raw, 'b', '2026-11-02');
  assert.equal(a.collected, 35000); assert.equal(a.by.Cash, 1000, 'A still answers for the 1,000 the next cashier did not find'); assert.equal(a.total, 6000);
  assert.equal(b.by.Cash, 37000, 'B answers for what they accepted + their own sales'); assert.equal(b.total, 37000);
  assert.equal(a.moves.length, 1, 'pending takeovers do not move money yet');
});
