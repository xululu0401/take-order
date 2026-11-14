/* 这单接不接 · 计算核心（core.js）
 * 跑网约车 / 代驾 / 跑腿的人，一单弹出来要在几秒里决定接不接。本页把一单拆开算：
 *   到手 = 订单价 × (1 − 平台抽成%)
 *   这单要跑的公里 = 接驾 + 行程 + 回空（送到偏的地方、要空车开回来的那段）
 *   车的成本 = 公里 × 每公里成本（油/电 + 折旧保养，自己填）
 *   净赚 = 到手 − 车的成本
 *   用时（分钟）= 接驾公里 ÷ 空车车速 × 60 + 行程分钟 + 回空公里 ÷ 空车车速 × 60
 *   每小时净赚 = 净赚 ÷ 用时 × 60
 *   该挣的 = 目标时薪 × 用时 ÷ 60；差额 = 净赚 − 该挣的；差额 ≥ 0 就算「值」
 *   这单要值，订单价至少 = (该挣的 + 车的成本) ÷ (1 − 抽成%)
 *   最远接驾 = 让差额正好为 0 的接驾公里（其他都不变）
 * 抽成比例、每公里成本、空车车速、目标时薪都是用户自己的数；默认场景是虚构的，不代表任何平台的真实规则。
 * 纯计算，不碰 DOM。浏览器里挂 window.AppCore，Node 里 module.exports。 */
(function (root) {
  'use strict';

  var EPS = 1e-9;
  var FIELDS = {
    cut: { min: 0, max: 60, label: '平台抽成 %' },
    cpk: { min: 0, max: 5, label: '每公里成本 元' },
    v: { min: 5, max: 80, label: '空车车速 km/h' },
    goal: { min: 0, max: 300, label: '目标时薪 元/小时' }
  };
  var KEYS = ['cut', 'cpk', 'v', 'goal'];
  var OFIELDS = {
    price: { min: 1, max: 5000, label: '订单价 元' },
    pk: { min: 0, max: 50, label: '接驾 km' },
    tk: { min: 0.1, max: 500, label: '行程 km' },
    tm: { min: 1, max: 720, label: '行程 分钟' },
    rk: { min: 0, max: 300, label: '回空 km' }
  };
  var OKEYS = ['price', 'pk', 'tk', 'tm', 'rk'];
  var MAX_ORDER = 8, NAME_MAX = 12;

  var BASE = {
    cut: '20', cpk: '0.45', v: '30', goal: '40',
    orders: [
      { name: '特惠单', price: '18', pk: '3.5', tk: '9', tm: '24', rk: '0' },
      { name: '一口价去远郊', price: '95', pk: '2', tk: '38', tm: '65', rk: '20' },
      { name: '普通单', price: '35', pk: '1.5', tk: '11', tm: '26', rk: '0' },
      { name: '远处接驾', price: '25', pk: '8', tk: '7', tm: '18', rk: '0' }
    ]
  };
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function patch(o, p) { var s = clone(o); Object.keys(p).forEach(function (k) { s[k] = clone(p[k]); }); return s; }
  var PRESETS = [
    { key: 'default', name: '油车跑四单（虚构）', note: '虚构场景：油车每公里成本 0.45 元（油费加折旧保养的示例值），平台抽成按 20% 填，空车平均 30 km/h，想每小时净赚 40 元。四单的价格和里程都是编的，换成你手机上弹出来的那一单。', state: BASE },
    { key: 'ev', name: '电车同样四单（虚构）', note: '虚构场景：同样四单，换成电车，每公里成本按 0.20 元填。每公里成本降下来，每单离目标差多少会缩小，但这几单里能不能变成「值」还要看价格和里程。', state: patch(BASE, { cpk: '0.2' }) },
    { key: 'night', name: '夜里长途（虚构）', note: '虚构场景：夜里路空，空车 45 km/h，目标时薪 50 元。一单去机场 52 km、回来要空跑 40 km，另一单市内短途。', state: patch(BASE, { v: '45', goal: '50', orders: [{ name: '去机场', price: '150', pk: '3', tk: '52', tm: '55', rk: '40' }, { name: '市内短途', price: '22', pk: '1', tk: '6', tm: '14', rk: '0' }] }) }
  ];
  function defaultState() { return clone(BASE); }
  function stateFromPreset(key) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) return clone(PRESETS[i].state); return defaultState(); }
  function presetKey(state) { var t = JSON.stringify(state); for (var i = 0; i < PRESETS.length; i++) if (JSON.stringify(PRESETS[i].state) === t) return PRESETS[i].key; return null; }

  function fmtV(x, d) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    var p = Math.pow(10, d), r = Math.round(x * p + (x >= 0 ? EPS : -EPS)) / p;
    if (Object.is(r, -0)) r = 0;
    return r.toFixed(d);
  }
  function money(x) { return fmtV(x, 2); }
  function signed(x) { var t = fmtV(x, 2); return (t.charAt(0) === '-' ? '−' + t.slice(1) : '+' + t); }
  function num(x) { return String(+(+x).toFixed(6)); }
  function parseNum(raw) {
    var t = String(raw == null ? '' : raw).trim();
    if (t === '') return { empty: true };
    if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return { nan: true };
    return { v: parseFloat(t) };
  }
  function chk(spec, field, raw, errors, prefix) {
    var p = parseNum(raw), lab = (prefix || '') + spec.label;
    if (p.empty) { errors.push({ code: 'empty', field: field, message: lab + '没填' }); return null; }
    if (p.nan) { errors.push({ code: 'nan', field: field, message: lab + '「' + raw + '」不是数字' }); return null; }
    if (p.v < spec.min || p.v > spec.max) { errors.push({ code: 'range', field: field, message: lab + '要在 ' + spec.min + '–' + spec.max + ' 之间，现在是 ' + p.v }); return null; }
    return p.v;
  }

  function validate(state) {
    var errors = [], v = {};
    state = state || {};
    KEYS.forEach(function (k) { var x = chk(FIELDS[k], k, state[k], errors); if (x != null) v[k] = x; });
    var os = Array.isArray(state.orders) ? state.orders : [];
    if (!os.length) errors.push({ code: 'noorder', field: 'orders', message: '一单都没有' });
    if (os.length > MAX_ORDER) errors.push({ code: 'many', field: 'orders', message: '最多 ' + MAX_ORDER + ' 单，现在是 ' + os.length });
    v.orders = [];
    os.slice(0, MAX_ORDER).forEach(function (o, i) {
      o = o || {};
      var w = {}, pre = '第 ' + (i + 1) + ' 单', nm = String(o.name == null ? '' : o.name).trim();
      if (!nm) errors.push({ code: 'name', field: 'o' + i + '_name', message: pre + '没起名字' });
      else if (nm.length > NAME_MAX) errors.push({ code: 'namelen', field: 'o' + i + '_name', message: pre + '的名字超过 ' + NAME_MAX + ' 个字' });
      w.name = nm || pre;
      OKEYS.forEach(function (k) { var x = chk(OFIELDS[k], 'o' + i + '_' + k, o[k], errors, '「' + w.name + '」'); if (x != null) w[k] = x; });
      v.orders.push(w);
    });
    return { errors: errors, v: v };
  }

  /* 一单的账。v 是全局设置（已校验成数字），o 是这一单 */
  function evalOrder(v, o) {
    var keep = 1 - v.cut / 100;
    var take = o.price * keep;
    var km = o.pk + o.tk + o.rk;
    var carCost = km * v.cpk;
    var net = take - carCost;
    var emptyMin = (o.pk + o.rk) / v.v * 60;
    var mins = emptyMin + o.tm;
    var perHour = net / mins * 60;
    var need = v.goal * mins / 60;
    var gap = net - need;
    var minPrice = keep > EPS ? (need + carCost) / keep : null;
    /* 最远接驾：gap(pk) = take − cpk·(pk+tk+rk) − goal/60·((pk+rk)/v·60 + tm) = 0 */
    var slope = v.cpk + v.goal / v.v;
    var pkMax = slope > EPS ? (take - v.cpk * (o.tk + o.rk) - v.goal / 60 * (o.rk / v.v * 60 + o.tm)) / slope : null;
    var kept = net / o.price;            /* 订单价里，扣完抽成和车的成本，自己留下的比例 */
    var verdict = net < -EPS ? 'loss' : gap >= -EPS ? 'take' : 'low';
    return {
      name: o.name, price: o.price, pk: o.pk, tk: o.tk, tm: o.tm, rk: o.rk,
      take: take, cutAmt: o.price - take, km: km, carCost: carCost, net: net,
      emptyMin: emptyMin, mins: mins, perHour: perHour, need: need, gap: gap,
      minPrice: minPrice, pkMax: pkMax, kept: kept, verdict: verdict
    };
  }

  function totals(rows) {
    var T = { n: rows.length, takeN: 0, net: 0, mins: 0, perHour: null, allNet: 0, allMins: 0, allPerHour: null };
    rows.forEach(function (r) {
      T.allNet += r.net; T.allMins += r.mins;
      if (r.verdict === 'take') { T.takeN++; T.net += r.net; T.mins += r.mins; }
    });
    if (T.mins > EPS) T.perHour = T.net / T.mins * 60;
    if (T.allMins > EPS) T.allPerHour = T.allNet / T.allMins * 60;
    return T;
  }

  /* 每单最多两条「改一项看看」：都是只改这一单的一个输入，点进去回填重算。
   *   ret_i ：回空改成 0（回程顺路接到单 / 不用空跑回来）——只有改完能变成「值」才给
   *   pick_i：接驾降到最远接驾（向下取到 0.1 km）——只有当前接驾比它远、且它 ≥ 0 才给
   * 订单价不是司机能改的，所以「至少要多少钱」只显示、不做成按钮。 */
  function floor1(x) { return Math.floor(x * 10 + EPS) / 10; }
  function buildActions(state, v, rows) {
    var acts = [];
    rows.forEach(function (r, i) {
      if (r.verdict === 'take') return;
      if (r.rk > EPS) {
        var o2 = Object.assign({}, v.orders[i], { rk: 0 });
        var a = evalOrder(v, o2);
        if (a.verdict === 'take') acts.push({ kind: 'ret_' + i, i: i, field: 'rk', to: '0', text: '「' + r.name + '」如果回程顺路能接到单（回空 ' + num(r.rk) + ' → 0 km）', after: a });
      }
      /* 最远接驾 < 0 时取到 0 仍然不够，下面「改完要变成值」的过滤会挡住，不另设分支 */
      if (r.pkMax != null) {
        var to = Math.max(0, floor1(r.pkMax));
        if (r.pk > to + EPS) {
          var b = evalOrder(v, Object.assign({}, v.orders[i], { pk: to }));
          if (b.verdict === 'take') acts.push({ kind: 'pick_' + i, i: i, field: 'pk', to: num(to), text: '「' + r.name + '」接驾在 ' + num(to) + ' km 以内才值（现在 ' + num(r.pk) + ' km）', after: b });
        }
      }
    });
    return acts;
  }
  function applyAction(state, a) {
    var s = clone(state);
    if (a && s.orders && s.orders[a.i]) s.orders[a.i][a.field] = a.to;
    return s;
  }

  function compute(state) {
    var c = validate(state);
    if (c.errors.length) return { ok: false, errors: c.errors };
    var v = c.v;
    var rows = v.orders.map(function (o) { return evalOrder(v, o); });
    var T = totals(rows);
    var warnings = [];
    rows.forEach(function (r) {
      if (r.emptyMin > r.tm + EPS) warnings.push({ code: 'emptylong', message: '「' + r.name + '」空车跑的时间（' + fmtV(r.emptyMin, 1) + ' 分钟）比载客还长' });
    });
    if (v.cut >= 50 - EPS) warnings.push({ code: 'cuthigh', message: '抽成填了 ' + num(v.cut) + '%，确认是不是把「平台抽成」和「到手比例」填反了' });
    if (v.cpk < EPS) warnings.push({ code: 'cpk0', message: '每公里成本填了 0：油电、折旧、保养都没算，净赚会偏高' });
    return { ok: true, v: v, rows: rows, T: T, actions: buildActions(state, v, rows), warnings: warnings };
  }

  var VERDICT = { take: '值，接', low: '不够目标', loss: '倒贴' };

  function csvCell(x) { var t = String(x); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function toCSV(out, stamp) {
    var L = ['这单接不接,导出 ' + stamp + ',默认场景为虚构示例'];
    if (!out.ok) { L.push('还算不出来'); out.errors.forEach(function (e) { L.push(csvCell(e.message)); }); return L.join('\n') + '\n'; }
    var v = out.v;
    L.push('平台抽成 %,' + num(v.cut) + ',每公里成本 元,' + num(v.cpk) + ',空车车速 km/h,' + num(v.v) + ',目标时薪 元/小时,' + num(v.goal));
    L.push('单,订单价,接驾km,行程km,行程分钟,回空km,到手,车的成本,净赚,用时分钟,每小时净赚,按目标该挣,差额,结论,至少要多少钱,最远接驾km,自己留下%');
    out.rows.forEach(function (r) {
      L.push([csvCell(r.name), num(r.price), num(r.pk), num(r.tk), num(r.tm), num(r.rk), money(r.take), money(r.carCost), money(r.net), fmtV(r.mins, 1), money(r.perHour), money(r.need), money(r.gap), VERDICT[r.verdict],
        r.minPrice == null ? '' : money(r.minPrice), r.pkMax == null ? '' : (r.pkMax < 0 ? '0 km 也不够' : fmtV(Math.max(0, floor1(r.pkMax)), 1)), r.net < 0 ? '倒贴' : fmtV(r.kept * 100, 1)].join(','));
    });
    var T = out.T;
    L.push('值得接,' + T.takeN + ' / ' + T.n + ' 单,合计净赚,' + money(T.net) + ',合计用时分钟,' + fmtV(T.mins, 1) + ',每小时净赚,' + (T.perHour == null ? '' : money(T.perHour)));
    return L.join('\n') + '\n';
  }
  function toMD(out, stamp) {
    var L = ['# 这单接不接', '', '导出 ' + stamp + ' · 默认场景为虚构示例', ''];
    if (!out.ok) { L.push('**还算不出来**', ''); out.errors.forEach(function (e) { L.push('- ' + e.message); }); return L.join('\n') + '\n'; }
    var v = out.v, T = out.T;
    L.push('抽成 ' + num(v.cut) + '% · 每公里成本 ' + num(v.cpk) + ' 元 · 空车 ' + num(v.v) + ' km/h · 目标每小时净赚 ' + num(v.goal) + ' 元', '');
    L.push('| 单 | 订单价 | 到手 | 车的成本 | 净赚 | 用时 | 每小时 | 结论 | 至少要 |', '|---|---:|---:|---:|---:|---:|---:|---|---:|');
    out.rows.forEach(function (r) {
      L.push('| ' + r.name.replace(/\|/g, '/') + ' | ' + money(r.price) + ' | ' + money(r.take) + ' | ' + money(r.carCost) + ' | ' + money(r.net) + ' | ' + fmtV(r.mins, 1) + ' 分 | ' + money(r.perHour) + ' | ' + VERDICT[r.verdict] + ' | ' + (r.minPrice == null ? '—' : money(r.minPrice)) + ' |');
    });
    L.push('', '值得接 **' + T.takeN + ' / ' + T.n + ' 单**，合计净赚 **' + money(T.net) + ' 元**、用时 ' + fmtV(T.mins, 1) + ' 分钟' + (T.perHour == null ? '' : '，每小时净赚 ' + money(T.perHour) + ' 元') + '。');
    if (out.actions.length) { L.push('', '## 改一项看看', ''); out.actions.forEach(function (a) { L.push('- ' + a.text + '：差额 ' + signed(a.after.gap) + ' 元，每小时 ' + money(a.after.perHour) + ' 元'); }); }
    L.push('', '抽成、每公里成本、车速、目标时薪都是你填的数；本页不知道任何平台的真实计价规则，结果是估算。');
    return L.join('\n') + '\n';
  }

  var api = {
    FIELDS: FIELDS, KEYS: KEYS, OFIELDS: OFIELDS, OKEYS: OKEYS, MAX_ORDER: MAX_ORDER, NAME_MAX: NAME_MAX, PRESETS: PRESETS, VERDICT: VERDICT,
    defaultState: defaultState, stateFromPreset: stateFromPreset, presetKey: presetKey,
    validate: validate, evalOrder: evalOrder, compute: compute, applyAction: applyAction,
    fmtV: fmtV, money: money, signed: signed, num: num, floor1: floor1, toCSV: toCSV, toMD: toMD
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AppCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
