/* 这单接不接 · 界面（ui.js）
 * 把输入读成 state → 交给 AppCore.compute → 把同一次输出画出来。页面不自己算数。
 * 表单只在换预设 / 恢复 / 点改法 / 增删单时整体回填；打字时只刷新结果，不丢光标。 */
(function () {
  'use strict';
  var A = window.AppCore;
  var KEY = 'take-order:v1';
  var $ = function (id) { return document.getElementById(id); };
  var OK = ['name', 'price', 'pk', 'tk', 'tm', 'rk'];
  var state = load() || A.defaultState();
  var out = null;
  var m = A.money, n = A.num, f1 = function (x) { return A.fmtV(x, 1); };
  var VCLS = { take: 'take', low: 'low', loss: 'loss' };

  function str(v) { return String(v == null ? '' : v); }
  function sanitize(s) {
    if (!s || typeof s !== 'object') return null;
    var d = A.defaultState(), any = false;
    A.KEYS.forEach(function (k) { if (s[k] != null && typeof s[k] !== 'object') { d[k] = str(s[k]); any = true; } });
    if (Array.isArray(s.orders)) {
      d.orders = s.orders.slice(0, A.MAX_ORDER).filter(function (o) { return o && typeof o === 'object'; }).map(function (o) {
        var x = {}; OK.forEach(function (k) { x[k] = str(o[k]); }); return x;
      });
      any = true;
    }
    return any ? d : null;
  }
  function load() { try { var t = localStorage.getItem(KEY); if (!t) return null; var j = JSON.parse(t); return sanitize(j && j.state); } catch (e) { return null; } }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ state: state })); $('saveTag').textContent = '· 已存到本机'; }
    catch (e) { $('saveTag').textContent = '· 没能存到本机'; }
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function renderPresets() {
    var k = A.presetKey(state);
    $('presets').innerHTML = A.PRESETS.map(function (p) { return '<button type="button" class="chip" id="preset_' + p.key + '" data-p="' + p.key + '" aria-pressed="' + (k === p.key) + '">' + esc(p.name) + '</button>'; }).join('');
    var cur = A.PRESETS.filter(function (p) { return p.key === k; })[0];
    $('presetNote').textContent = cur ? cur.note : '已按你的输入计算（不是预设）。';
  }
  $('presets').addEventListener('click', function (e) { var b = e.target.closest('[data-p]'); if (!b) return; state = A.stateFromPreset(b.getAttribute('data-p')); fill(); update(); });

  function fieldHtml(i, k, label, val, cls) {
    var id = 'o' + i + '_' + k;
    return '<div class="f' + (cls ? ' ' + cls : '') + '" id="f_' + id + '"><label for="' + id + '">' + label + '</label><input id="' + id + '" data-o="' + i + '" data-ok="' + k + '"' + (k === 'name' ? ' maxlength="24"' : ' inputmode="decimal"') + ' value="' + esc(val) + '"></div>';
  }
  function orderRows() {
    $('orders').innerHTML = state.orders.map(function (o, i) {
      return '<div class="ord" id="ord_' + i + '">' + fieldHtml(i, 'name', '这单叫什么', o.name, 'txt') +
        fieldHtml(i, 'price', '订单价 元', o.price) + fieldHtml(i, 'pk', '接驾 km', o.pk) + fieldHtml(i, 'tk', '行程 km', o.tk) +
        fieldHtml(i, 'tm', '行程 分钟', o.tm) + fieldHtml(i, 'rk', '回空 km', o.rk) +
        '<button type="button" class="del" data-del="' + i + '" id="del_' + i + '"' + (state.orders.length <= 1 ? ' disabled' : '') + '>删掉</button></div>';
    }).join('');
    $('addOrder').disabled = state.orders.length >= A.MAX_ORDER;
    $('orderCount').textContent = state.orders.length + ' / ' + A.MAX_ORDER + ' 单';
  }
  $('orders').addEventListener('input', function (e) { var i = e.target.getAttribute('data-o'), k = e.target.getAttribute('data-ok'); if (i == null || !k) return; state.orders[+i][k] = e.target.value; update(); });
  $('orders').addEventListener('click', function (e) { var b = e.target.closest('[data-del]'); if (!b || state.orders.length <= 1) return; state.orders.splice(+b.getAttribute('data-del'), 1); fill(); update(); });
  $('addOrder').addEventListener('click', function () { if (state.orders.length >= A.MAX_ORDER) return; state.orders.push({ name: '新的一单', price: '30', pk: '2', tk: '10', tm: '25', rk: '0' }); fill(); update(); });

  function fill() { A.KEYS.forEach(function (k) { $(k).value = state[k]; }); orderRows(); }
  $('form').addEventListener('input', function (e) { var k = e.target.getAttribute('data-k'); if (!k) return; state[k] = e.target.value; update(); });

  function markErrors() {
    document.querySelectorAll('.f.bad').forEach(function (f) { f.classList.remove('bad'); });
    (out.errors || []).forEach(function (e) { if ($('f_' + e.field)) $('f_' + e.field).classList.add('bad'); });
  }

  /* 钱条：订单价 = 平台拿走 + 车钱 + 自己净赚（倒贴时净赚段为 0，条尾标红写明倒贴多少）
   * 时间条：空车分钟 + 载客分钟。两条各自按本单总量画比例。 */
  function pct(x, t) { return t > 0 ? Math.max(0, x / t * 100) : 0; }
  function moneyStrip(r) {
    var tot = r.cutAmt + r.carCost + Math.max(0, r.net);
    return '<div class="strip" aria-label="钱条"><span style="width:' + pct(r.cutAmt, tot).toFixed(2) + '%;background:var(--cut)"></span><span style="width:' + pct(r.carCost, tot).toFixed(2) + '%;background:var(--car)"></span><span style="width:' + pct(Math.max(0, r.net), tot).toFixed(2) + '%;background:var(--net)"></span></div>';
  }
  function timeStrip(r) {
    return '<div class="strip" aria-label="时间条"><span style="width:' + pct(r.emptyMin, r.mins).toFixed(2) + '%;background:var(--emp)"></span><span style="width:' + pct(r.tm, r.mins).toFixed(2) + '%;background:var(--ride)"></span></div>';
  }
  function verdictLine(r) {
    if (r.verdict === 'take') return '比目标多挣 <b>' + m(r.gap) + ' 元</b>（按目标这 ' + f1(r.mins) + ' 分钟该挣 ' + m(r.need) + ' 元）';
    var s = r.verdict === 'loss' ? '净赚是负的，<b>倒贴 ' + m(-r.net) + ' 元</b>；' : '离目标差 <b>' + m(-r.gap) + ' 元</b>；';
    s += '这单至少要 <b>' + m(r.minPrice) + ' 元</b>才值';
    s += r.pkMax < 0 ? '，接驾就算是 0 km 也不够' : '，或者接驾在 ' + n(A.floor1(r.pkMax)) + ' km 以内';
    return s;
  }

  function render() {
    var bad = !out.ok;
    $('errBox').classList.toggle('hide', !bad);
    $('resCard').classList.toggle('hide', bad);
    if (bad) { $('errBox').innerHTML = '<b>还算不出来</b>，先把这些改对（原文都保留着）：<ul>' + out.errors.map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') + '</ul>'; return; }
    var v = out.v, T = out.T;
    $('takeN').innerHTML = T.takeN + '<small>/ ' + T.n + ' 单</small>';
    $('perHourN').innerHTML = T.perHour == null ? '—<small>一单都不值</small>' : m(T.perHour) + '<small>元</small>';
    $('howN').textContent = '抽成 ' + n(v.cut) + '% · 每公里 ' + n(v.cpk) + ' 元 · 空车 ' + n(v.v) + ' km/h · 目标每小时 ' + n(v.goal) + ' 元' +
      (T.takeN ? ' · 值得接的合计净赚 ' + m(T.net) + ' 元、' + f1(T.mins) + ' 分钟' : '') + ' · 全部都接：每小时 ' + m(T.allPerHour) + ' 元';
    $('tickets').innerHTML = out.rows.map(function (r, i) {
      return '<div class="tk ' + VCLS[r.verdict] + '" id="tk_' + i + '"><div class="top"><span class="nm">' + esc(r.name) + '</span><span class="stamp">' + A.VERDICT[r.verdict] + '</span>' +
        '<span class="ph">' + m(r.perHour) + '<small>元/小时</small></span></div>' +
        '<div class="line">订单 ' + m(r.price) + ' 元 → 平台 ' + m(r.cutAmt) + ' · 车钱 ' + m(r.carCost) + '（' + n(r.km) + ' km）· <b>净赚 ' + m(r.net) + ' 元</b></div>' +
        moneyStrip(r) +
        '<div class="line">用时 ' + f1(r.mins) + ' 分钟：空车 ' + f1(r.emptyMin) + ' + 载客 ' + n(r.tm) + ' · ' + (r.net < 0 ? '这单是倒贴的，订单价里自己一分不留' : '订单价里自己留下 ' + A.fmtV(r.kept * 100, 1) + '%') + '</div>' +
        timeStrip(r) +
        '<div class="line">' + verdictLine(r) + '</div></div>';
    }).join('') + '<div class="lg"><span><i style="background:var(--cut)"></i>平台抽成</span><span><i style="background:var(--car)"></i>车钱</span><span><i style="background:var(--net)"></i>净赚</span><span><i style="background:var(--emp)"></i>空车分钟</span><span><i style="background:var(--ride)"></i>载客分钟</span></div>';
    $('actsBlock').classList.toggle('hide', !out.actions.length);
    $('acts').innerHTML = out.actions.map(function (a, i) {
      return '<button type="button" class="act" id="act_' + a.kind + '" data-a="' + i + '">→ ' + esc(a.text) + '<small>改完：这单差额 ' + A.signed(a.after.gap) + ' 元，每小时 ' + m(a.after.perHour) + ' 元，变成「' + A.VERDICT[a.after.verdict] + '」</small></button>';
    }).join('');
    $('warnBox').classList.toggle('hide', !out.warnings.length);
    $('warnBox').innerHTML = '<ul>' + out.warnings.map(function (x) { return '<li>' + esc(x.message) + '</li>'; }).join('') + '</ul>';
  }
  $('acts').addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (!b) return; state = A.applyAction(state, out.actions[+b.getAttribute('data-a')]); fill(); update(); });

  function update() { out = A.compute(state); markErrors(); render(); renderPresets(); save(); }

  /* ── 导出 ── */
  function stamp() { var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function download(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  $('dlCsv').addEventListener('click', function () { download('这单接不接.csv', new Blob(['\ufeff' + A.toCSV(out, stamp())], { type: 'text/csv;charset=utf-8' })); });
  $('dlMd').addEventListener('click', function () { download('这单接不接.md', new Blob([A.toMD(out, stamp())], { type: 'text/markdown;charset=utf-8' })); });
  $('dlJson').addEventListener('click', function () { download('这单接不接-备份.json', new Blob([JSON.stringify({ app: '这单接不接', slug: 'take-order', version: 1, exported_at: stamp(), state: state, out: out }, null, 2)], { type: 'application/json' })); });
  $('impJson').addEventListener('click', function () { $('impFile').click(); });
  $('impFile').addEventListener('change', function () { var f = this.files && this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { importText(String(r.result)); }; r.readAsText(f); this.value = ''; });
  function importText(t) {
    var s = null;
    try { var j = JSON.parse(t); s = sanitize(j && j.state ? j.state : j); } catch (e) { s = null; }
    if (!s) { $('saveTag').textContent = '· 这个文件读不出来，没改动'; return false; }
    state = s; fill(); update(); return true;
  }
  $('reset').addEventListener('click', function () { state = A.defaultState(); fill(); update(); });

  /* 结果卡 PNG 1080×1350：所有文字取自同一次 out */
  var VC = { take: ['#1f7a4d', '#e3f2ea'], low: ['#a86a12', '#fbf0dc'], loss: ['#b13a2b', '#f8e1dc'] };
  function drawCard() {
    var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    var F = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif', M = 'ui-monospace,Menlo,Consolas,monospace';
    g.fillStyle = '#f3f2ee'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(48, 48, W - 96, H - 96);
    var L = 96, R = W - 96, maxW = R - L, y = 132;
    function clip(t, w) { t = String(t); if (g.measureText(t).width <= w) return t; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
    function text(t, size, color, bold, font, x, w) { g.font = (bold ? '700 ' : '') + size + 'px ' + (font || F); g.fillStyle = color; g.fillText(clip(t, w || maxW), x == null ? L : x, y); }
    text('这单接不接', 52, '#1d1f24', true); y += 44;
    text('导出 ' + stamp() + ' · 默认场景为虚构示例', 22, '#80858f'); y += 50;
    if (!out.ok) {
      y += 20; text('还算不出来', 44, '#b13a2b', true); y += 60;
      out.errors.slice(0, 14).forEach(function (e) { text('· ' + e.message, 25, '#4d525c'); y += 40; });
      return cv;
    }
    var v = out.v, T = out.T;
    g.fillStyle = '#eceae3'; g.fillRect(L, y - 10, maxW, 140);
    g.font = '24px ' + F; g.fillStyle = '#4d525c'; g.fillText('值得接', L + 24, y + 26); g.fillText('只接这几单，每小时净赚', L + 380, y + 26);
    g.font = '700 76px ' + F; g.fillStyle = '#1d1f24'; var tn = String(T.takeN); g.fillText(tn, L + 24, y + 104);
    var bw = g.measureText(tn).width; g.font = '28px ' + F; g.fillText(' / ' + T.n + ' 单', L + 24 + bw, y + 104);
    g.font = '700 64px ' + F; g.fillText(T.perHour == null ? '—' : m(T.perHour) + ' 元', L + 380, y + 100);
    y += 170;
    text('抽成 ' + n(v.cut) + '% · 每公里 ' + n(v.cpk) + ' 元 · 空车 ' + n(v.v) + ' km/h · 目标 ' + n(v.goal) + ' 元/小时', 23, '#4d525c'); y += 54;
    var skipped = 0;
    out.rows.forEach(function (r) {
      if (y > H - 300) { skipped++; return; }
      var c = VC[r.verdict];
      g.fillStyle = c[0]; g.fillRect(L, y - 30, 8, 118);
      var ph = m(r.perHour) + ' 元/小时'; g.font = '700 28px ' + M; var pw = g.measureText(ph).width;
      var st = A.VERDICT[r.verdict]; g.font = '700 22px ' + F; var sw = g.measureText(st).width + 20;
      g.font = '700 30px ' + F; var nm = clip(r.name, maxW - pw - sw - 70); g.fillStyle = '#1d1f24'; g.fillText(nm, L + 24, y);
      var nw = g.measureText(nm).width;
      g.fillStyle = c[1]; g.fillRect(L + 36 + nw, y - 26, sw, 34); g.font = '700 22px ' + F; g.fillStyle = c[0]; g.fillText(st, L + 46 + nw, y - 2);
      g.font = '700 28px ' + M; g.fillStyle = '#1d1f24'; g.textAlign = 'right'; g.fillText(ph, R, y); g.textAlign = 'left';
      y += 40;
      text('订单 ' + m(r.price) + ' → 平台 ' + m(r.cutAmt) + ' · 车钱 ' + m(r.carCost) + ' · 净赚 ' + m(r.net) + ' 元 · ' + f1(r.mins) + ' 分钟', 22, '#4d525c', false, null, L + 24, maxW - 24); y += 36;
      var tail = r.verdict === 'take' ? '比目标多挣 ' + m(r.gap) + ' 元' : (r.verdict === 'loss' ? '倒贴 ' + m(-r.net) + ' 元，' : '差 ' + m(-r.gap) + ' 元，') + '至少要 ' + m(r.minPrice) + ' 元才值';
      text(tail, 22, c[0], true, null, L + 24, maxW - 24); y += 68;
    });
    if (skipped) { y -= 20; text('另有 ' + skipped + ' 单没画进来，见 CSV / MD', 21, '#80858f'); y += 44; }
    if (out.actions.length && y < H - 170) {
      text('改一项看看', 26, '#1d1f24', true); y += 40;
      out.actions.forEach(function (a) {
        if (y > H - 120) return;
        var tl = '  差额 ' + A.signed(a.after.gap) + ' 元'; g.font = '600 22px ' + F; var tw = g.measureText(tl).width;
        text(a.text, 21, '#174d33', false, null, L, maxW - tw - 8);
        g.font = '600 22px ' + F; g.fillStyle = '#1f7a4d'; g.textAlign = 'right'; g.fillText(tl, R, y); g.textAlign = 'left'; y += 36;
      });
    }
    g.font = '21px ' + F; g.fillStyle = '#80858f';
    g.fillText(clip('抽成、每公里成本、车速、目标时薪都是你填的数；本页不知道任何平台的计价规则', maxW), L, H - 72);
    return cv;
  }
  $('dlPng').addEventListener('click', function () { drawCard().toBlob(function (b) { if (b) download('这单接不接-1080x1350.png', b); }, 'image/png'); });

  window.__orderUi = { state: function () { return JSON.parse(JSON.stringify(state)); }, out: function () { return out; }, importText: importText, drawCard: drawCard, storageKey: KEY };

  fill(); update();
})();
