/* 这单接不接 · 核心测试。node --test tests/core.test.cjs
 * 锚点来自 evidence/手算锚点.py（Python Fraction；最远接驾用两点线性求根，不是 core.js 的闭式）。
 * 最后一组把错误注入源码再跑同一批锚点，确认锚点够尖。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
const RAND = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'evidence', '随机对拍.json'), 'utf8'));
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
const S = (p) => Object.assign(C.defaultState(), p || {});
const ord = (p) => Object.assign({ name: 'a', price: '30', pk: '1', tk: '10', tm: '20', rk: '0' }, p || {});
function load(src) { const sb = { module: { exports: {} } }; sb.globalThis = sb; vm.runInNewContext(src, sb); return sb.module.exports; }

function anchors(M) {
  const o = M.compute(M.defaultState());
  if (!o.ok) return '默认算不出来 ' + JSON.stringify(o.errors);
  const exp = [
    [14.4, 5.625, 8.775, 31, 20.666666666666668, -11.891666666666667, 32.864583333333336, -3.1682242990654204, 'low'],
    [76, 27, 49, 109, 72.66666666666667, -23.666666666666668, 124.58333333333333, -11.271028037383177, 'low'],
    [28, 5.625, 22.375, 29, 19.333333333333332, 3.0416666666666665, 31.197916666666668, 3.205607476635514, 'take'],
    [20, 6.75, 13.25, 34, 22.666666666666668, -9.416666666666666, 36.770833333333336, 2.7196261682242993, 'low']
  ];
  for (let i = 0; i < 4; i++) {
    const r = o.rows[i], e = exp[i];
    const got = [r.take, r.carCost, r.net, r.mins, r.need, r.gap, r.minPrice, r.pkMax];
    for (let k = 0; k < 8; k++) if (!near(got[k], e[k])) return r.name + ' 第 ' + k + ' 项 ' + got[k] + ' ≠ ' + e[k];
    if (r.verdict !== e[8]) return r.name + ' 结论 ' + r.verdict;
  }
  if (!near(o.rows[2].perHour, 46.293103448275865)) return '普通单每小时 ' + o.rows[2].perHour;
  if (o.T.takeN !== 1 || !near(o.T.net, 22.375) || !near(o.T.mins, 29)) return '合计 ' + JSON.stringify(o.T);
  const K = (k) => o.actions.filter((a) => a.kind === k)[0];
  if (o.actions.map((a) => a.kind).join() !== 'ret_1,pick_3') return '改法 ' + o.actions.map((a) => a.kind).join();
  const rt = K('ret_1'); if (!near(rt.after.gap, 12) || !near(rt.after.perHour, 50.43478260869565)) return '回空 ' + rt.after.gap;
  const pk = K('pick_3'); if (pk.to !== '2.7' || !near(pk.after.gap, 0.035) || pk.after.verdict !== 'take') return '接驾 ' + pk.to + ' ' + pk.after.gap;
  /* 门槛另一侧：2.8 km 就不够（Python 差 −0.1433） */
  const o28 = M.evalOrder(o.v, Object.assign({}, o.v.orders[3], { pk: 2.8 }));
  if (o28.verdict !== 'low' || !near(o28.gap, -0.14333333333333)) return '2.8 km ' + o28.gap;
  /* 倒贴：抽成 30%、1.2 元/km、10 元跑 8 km → 净 −2.6 */
  const ls = M.compute(S({ cut: '30', cpk: '1.2', orders: [ord({ price: '10', pk: '1', tk: '7', tm: '15' })] }));
  if (!near(ls.rows[0].net, -2.6) || ls.rows[0].verdict !== 'loss') return '倒贴 ' + ls.rows[0].net + ' ' + ls.rows[0].verdict;
  /* 正好等于目标算「值」 */
  const eq = M.compute(S({ cut: '0', cpk: '0', v: '60', goal: '60', orders: [ord({ price: '30', pk: '0', tk: '5', tm: '30' })] }));
  if (eq.rows[0].gap !== 0 || eq.rows[0].verdict !== 'take') return '正好等于目标 ' + eq.rows[0].gap + ' ' + eq.rows[0].verdict;
  /* 只有「回空改 0 也救不回来就不给」在起作用的锚点（Python：回空 5→0 后差额仍 < 0） */
  const nr = M.compute(S({ orders: [ord({ price: '25', pk: '1', tk: '30', tm: '60', rk: '5' })] }));
  if (nr.rows[0].verdict !== 'low' || nr.actions.length !== 0) return '救不回来的回空 ' + nr.actions.map((a) => a.kind).join();
  /* 已经值、但回空 > 0 的单：不该再给「回空改 0」（Python：差 +19.47） */
  const tk = M.compute(S({ orders: [ord({ price: '60', pk: '1', tk: '10', tm: '20', rk: '5' })] }));
  if (tk.rows[0].verdict !== 'take' || !near(tk.rows[0].gap, 19.466666666666665) || tk.actions.length !== 0) return '已经值的单 ' + tk.actions.map((a) => a.kind).join();
  for (let k = 0; k < 120; k++) {
    const R = RAND[k], q = M.compute(R.st);
    if (!q.ok) return '随机 ' + k + ' 算不出来 ' + JSON.stringify(q.errors);
    for (let i = 0; i < R.rows.length; i++) {
      const a = q.rows[i], b = R.rows[i];
      if (!near(a.net, b.net, 1e-8) || !near(a.mins, b.mins, 1e-8) || !near(a.gap, b.gap, 1e-8) || a.verdict !== b.verdict) return '随机 ' + k + '/' + i + ' ' + a.gap + ' vs ' + b.gap;
    }
  }
  return null;
}

test('A1 默认四单、两条改法、门槛两侧、倒贴、正好等于目标，与 Python Fraction 一致', () => { assert.equal(anchors(C), null); });

test('A2 随机 300 组与 Python 对拍（净赚、用时、差额、每小时、至少要多少、最远接驾、结论、合计）', () => {
  assert.equal(RAND.length, 300);
  let rows = 0;
  RAND.forEach((R, k) => {
    const q = C.compute(R.st);
    assert.ok(q.ok, '随机 ' + k);
    R.rows.forEach((b, i) => {
      const a = q.rows[i]; rows++;
      for (const [x, y] of [[a.net, b.net], [a.mins, b.mins], [a.gap, b.gap], [a.perHour, b.per_hour], [a.minPrice, b.min_price], [a.pkMax, b.pk_max]]) {
        if (y === null) assert.equal(x, null, k + '/' + i); else assert.ok(near(x, y, 1e-8), k + '/' + i + ' ' + x + ' vs ' + y);
      }
      assert.equal(a.verdict, b.verdict, k + '/' + i);
    });
    assert.equal(q.T.takeN, R.T.takeN, '随机 ' + k + ' 值得接单数');
    assert.ok(near(q.T.net, R.T.net, 1e-8) && near(q.T.mins, R.T.mins, 1e-8), '随机 ' + k + ' 合计');
  });
  assert.ok(rows > 900, '行数 ' + rows);
  const dist = { take: 0, low: 0, loss: 0 }; RAND.forEach((R) => R.rows.forEach((r) => dist[r.verdict]++));
  assert.ok(dist.take > 50 && dist.low > 50 && dist.loss > 20, '三种结论都覆盖到 ' + JSON.stringify(dist));
});

test('A3 恒等式：至少要多少钱代回去差额 = 0；最远接驾代回去差额 = 0；每小时净赚与目标的比较和差额同号', () => {
  RAND.slice(0, 200).forEach((R, k) => {
    const q = C.compute(R.st);
    q.rows.forEach((r, i) => {
      const o = q.v.orders[i];
      const atMin = C.evalOrder(q.v, Object.assign({}, o, { price: r.minPrice }));
      assert.ok(Math.abs(atMin.gap) < 1e-7, k + '/' + i + ' 至少要 ' + atMin.gap);
      if (r.pkMax >= 0) { const atPk = C.evalOrder(q.v, Object.assign({}, o, { pk: r.pkMax })); assert.ok(Math.abs(atPk.gap) < 1e-7, k + '/' + i + ' 最远接驾 ' + atPk.gap); }
      if (Math.abs(r.gap) > 1e-6) assert.equal(r.gap > 0, r.perHour > q.v.goal, k + '/' + i + ' 同号');
    });
  });
});

test('A4 单调性：订单价↑差额↑；接驾、回空、每公里成本、抽成、目标时薪↑差额↓；空车车速↑差额不降', () => {
  const base = C.compute(C.defaultState()), o = base.v.orders[1], v = base.v, g0 = base.rows[1].gap;
  const up = (vv, oo) => C.evalOrder(Object.assign({}, v, vv || {}), Object.assign({}, o, oo || {})).gap;
  assert.ok(up(null, { price: 96 }) > g0);
  assert.ok(up(null, { pk: 2.5 }) < g0 && up(null, { rk: 21 }) < g0);
  assert.ok(up({ cpk: 0.5 }) < g0 && up({ cut: 21 }) < g0 && up({ goal: 41 }) < g0);
  assert.ok(up({ v: 31 }) > g0);
  assert.equal(up(null, { tk: 39 }) < g0, true, '行程多 1 km（同样分钟）只多油费');
});

test('A5 改法：只给能变成「值」的；接驾取到 0.1 km 向下；最远接驾 < 0 不给；已经值的单不给；订单价不做成按钮', () => {
  const o = C.compute(C.defaultState());
  o.actions.forEach((a) => {
    assert.equal(a.after.verdict, 'take', a.kind);
    const s2 = C.applyAction(C.defaultState(), a), o2 = C.compute(s2);
    assert.ok(near(o2.rows[a.i].gap, a.after.gap), a.kind + ' 回填后就是 after');
    Object.keys(s2).forEach((k) => { if (k !== 'orders') assert.equal(s2[k], C.defaultState()[k]); });
    s2.orders.forEach((x, j) => { if (j !== a.i) assert.deepEqual(x, C.defaultState().orders[j]); else OK(x, a); });
  });
  function OK(x, a) { Object.keys(x).forEach((k) => { if (k !== a.field) assert.equal(x[k], C.defaultState().orders[a.i][k]); }); }
  assert.ok(!o.actions.some((a) => a.i === 0), '特惠单最远接驾 < 0，没有能救它的单项改法');
  assert.ok(!o.actions.some((a) => a.i === 2), '普通单已经值');
  assert.ok(!o.actions.some((a) => a.field === 'price'));
  /* 回空改 0 也救不回来就不给 */
  const n = C.compute(S({ orders: [ord({ price: '25', pk: '1', tk: '30', tm: '60', rk: '5' })] }));
  assert.equal(n.rows[0].verdict, 'low'); assert.equal(n.actions.length, 0);
  /* 向下取整：最远接驾 2.7196 → 2.7，不能是 2.8 */
  assert.equal(C.floor1(2.7196), 2.7); assert.equal(C.floor1(2.8), 2.8); assert.equal(C.floor1(0.04), 0);
});

test('A6 结论的三档：倒贴（净赚 < 0）/ 不够目标 / 值；目标时薪 0 时不倒贴就值', () => {
  const z = C.compute(S({ goal: '0' }));
  z.rows.forEach((r) => assert.equal(r.verdict, r.net < 0 ? 'loss' : 'take'));
  const ls = C.compute(S({ cut: '30', cpk: '1.2', orders: [ord({ price: '10', pk: '1', tk: '7', tm: '15' })] }));
  assert.equal(ls.rows[0].verdict, 'loss');
  assert.equal(ls.T.takeN, 0); assert.equal(ls.T.perHour, null, '一单都不值时合计每小时没有意义');
  assert.ok(ls.actions.every((a) => a.after.verdict === 'take'));
});

test('A7 非法输入：空、非数字、越界、名字、单数', () => {
  const bad = (p) => C.compute(S(p)).errors.map((e) => e.field + ':' + e.code);
  assert.deepEqual(bad({ cut: '' }), ['cut:empty']);
  assert.deepEqual(bad({ cpk: 'abc' }), ['cpk:nan']);
  assert.deepEqual(bad({ cut: '61' }), ['cut:range']);
  assert.deepEqual(bad({ v: '4' }), ['v:range']);
  assert.deepEqual(bad({ goal: '-1' }), ['goal:range']);
  assert.deepEqual(bad({ orders: [] }), ['orders:noorder']);
  assert.deepEqual(bad({ orders: Array.from({ length: 9 }, () => ord()) }), ['orders:many']);
  assert.deepEqual(bad({ orders: [ord({ name: ' ' })] }), ['o0_name:name']);
  assert.deepEqual(bad({ orders: [ord({ name: '一二三四五六七八九十一二三' })] }), ['o0_name:namelen']);
  assert.deepEqual(bad({ orders: [ord({ tk: '0' })] }), ['o0_tk:range']);
  assert.deepEqual(bad({ orders: [ord({ tm: '0.5' })] }), ['o0_tm:range']);
  assert.deepEqual(bad({ orders: [ord({ price: '1e3' })] }), ['o0_price:nan']);
  assert.deepEqual(bad({ orders: [ord({ pk: '1.5.2' })] }), ['o0_pk:nan']);
  assert.ok(C.compute(S({ cut: '60', cpk: '5', v: '5', goal: '300', orders: [ord({ price: '5000', pk: '50', tk: '500', tm: '720', rk: '300' })] })).ok, '上限都能算');
  assert.ok(C.compute(S({ cut: '0', cpk: '0', v: '80', goal: '0', orders: [ord({ price: '1', pk: '0', tk: '0.1', tm: '1', rk: '0' })] })).ok, '下限都能算');
});

test('A8 提醒：空跑比载客久、抽成 ≥ 50%、每公里成本 0', () => {
  const n = C.compute(C.stateFromPreset('night'));
  assert.ok(n.warnings.some((w) => w.code === 'emptylong' && w.message.indexOf('57.3 分钟') > 0));
  assert.ok(C.compute(S({ cut: '50' })).warnings.some((w) => w.code === 'cuthigh'));
  assert.ok(!C.compute(S({ cut: '49' })).warnings.some((w) => w.code === 'cuthigh'));
  assert.ok(C.compute(S({ cpk: '0' })).warnings.some((w) => w.code === 'cpk0'));
  assert.equal(C.compute(C.defaultState()).warnings.length, 0);
});

test('A9 舍入与显示：四舍五入到分、负号用 −、−0 不出现', () => {
  assert.equal(C.money(5.625), '5.63'); assert.equal(C.money(8.775), '8.78'); assert.equal(C.money(-0.004), '0.00');
  assert.equal(C.signed(-11.891666), '−11.89'); assert.equal(C.signed(3.0416), '+3.04'); assert.equal(C.signed(0), '+0.00');
  assert.equal(C.fmtV(NaN, 2), '—');
});

test('A10 导出：CSV/MD 用同一次 out；CSV 名字带逗号会加引号；MD 表格转义竖线', () => {
  const o = C.compute(C.defaultState());
  const csv = C.toCSV(o, 'T'), md = C.toMD(o, 'T');
  assert.ok(csv.indexOf('普通单,35,1.5,11,26,0,28.00,5.63,22.38,29.0,46.29,19.33,3.04,值，接,31.20,3.2,63.9') > 0, csv);
  assert.ok(csv.indexOf('特惠单,18,3.5,9,24,0,14.40,5.63,8.78,31.0,16.98,20.67,-11.89,不够目标,32.86,0 km 也不够,48.8') > 0);
  assert.ok(csv.indexOf('值得接,1 / 4 单,合计净赚,22.38') > 0);
  assert.ok(md.indexOf('值得接 **1 / 4 单**，合计净赚 **22.38 元**') > 0);
  assert.ok(md.indexOf('「远处接驾」接驾在 2.7 km 以内才值（现在 8 km）：差额 +0.04 元') > 0, md);
  const q = C.compute(S({ orders: [ord({ name: 'a,b|c' })] }));
  assert.ok(C.toCSV(q, 'T').indexOf('"a,b|c"') > 0); assert.ok(C.toMD(q, 'T').indexOf('| a,b/c |') > 0);
  assert.ok(C.toCSV(C.compute(S({ cpk: '1.5' })), 'T').indexOf(',倒贴\n') > 0, '倒贴单的留下比例写成「倒贴」，不写负百分比');
  const e = C.compute(S({ cut: 'x' })); assert.ok(C.toCSV(e, 'T').indexOf('还算不出来') > 0 && C.toMD(e, 'T').indexOf('还算不出来') > 0);
});

test('A11 注入错误：每个错误都让锚点不通过（锚点够尖）', () => {
  const MUT = [
    ['抽成没除 100', 'var keep = 1 - v.cut / 100;', 'var keep = 1 - v.cut;'],
    ['到手用了抽成额', 'var take = o.price * keep;', 'var take = o.price * (1 - keep);'],
    ['公里漏了回空', 'var km = o.pk + o.tk + o.rk;', 'var km = o.pk + o.tk;'],
    ['公里漏了接驾', 'var km = o.pk + o.tk + o.rk;', 'var km = o.tk + o.rk;'],
    ['空车时间没乘 60', 'var emptyMin = (o.pk + o.rk) / v.v * 60;', 'var emptyMin = (o.pk + o.rk) / v.v;'],
    ['空车时间漏了回空', 'var emptyMin = (o.pk + o.rk) / v.v * 60;', 'var emptyMin = o.pk / v.v * 60;'],
    ['用时漏了空车', 'var mins = emptyMin + o.tm;', 'var mins = o.tm;'],
    ['该挣的没除 60', 'var need = v.goal * mins / 60;', 'var need = v.goal * mins;'],
    ['至少要多少没除到手比例', 'var minPrice = keep > EPS ? (need + carCost) / keep : null;', 'var minPrice = keep > EPS ? (need + carCost) : null;'],
    ['至少要多少漏了车的成本', 'var minPrice = keep > EPS ? (need + carCost) / keep : null;', 'var minPrice = keep > EPS ? need / keep : null;'],
    ['最远接驾斜率漏了时间成本', 'var slope = v.cpk + v.goal / v.v;', 'var slope = v.cpk;'],
    ['最远接驾漏了回空时间', "v.goal / 60 * (o.rk / v.v * 60 + o.tm)) / slope", 'v.goal / 60 * o.tm) / slope'],
    ['正好等于目标判成不够', "gap >= -EPS ? 'take'", "gap > EPS ? 'take'"],
    ['倒贴判成不够', "net < -EPS ? 'loss'", "net < -1e9 ? 'loss'"],
    ['合计算了所有单', "if (r.verdict === 'take') { T.takeN++;", "if (true) { T.takeN++;"],
    ['接驾向上取整', 'function floor1(x) { return Math.floor(x * 10 + EPS) / 10; }', 'function floor1(x) { return Math.ceil(x * 10 - EPS) / 10; }'],
    ['救不回来也给回空改法', "if (a.verdict === 'take') acts.push({ kind: 'ret_'", "if (true) acts.push({ kind: 'ret_'"],
    ['已经值的单也给改法', "if (r.verdict === 'take') return;", "if (false) return;"]
  ];
  const lines = [];
  MUT.forEach(([name, a, b]) => {
    assert.ok(SRC.indexOf(a) >= 0, '注入点没找到：' + name);
    const r = anchors(load(SRC.replace(a, b)));
    lines.push(name + ' → ' + r);
    assert.ok(r, '没抓到：' + name);
  });
  fs.writeFileSync(path.join(__dirname, '..', '..', 'evidence', '注入测试明细.txt'), lines.join('\n') + '\n');
});
