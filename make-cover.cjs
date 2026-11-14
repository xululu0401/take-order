/* 封面 cover.svg（1200×1200），所有数字来自 core.js 默认场景的同一次 compute；再用浏览器截成 cover.png。
 * 字体名用单引号（SVG 是 XML，裸双引号会让整张图变错误页，批次 64 踩过）。 */
const fs = require('node:fs');
const A = require('./core.js');
const o = A.compute(A.defaultState());
if (!o.ok) throw new Error('默认场景算不出来');
const F = "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif", M = 'ui-monospace,Menlo,Consolas,monospace';
const VC = { take: ['#1f7a4d', '#e3f2ea'], low: ['#a86a12', '#fbf0dc'], loss: ['#b13a2b', '#f8e1dc'] };
const L = 120, W = 960;
let rows = '';
o.rows.forEach((r, k) => {
  const y = 470 + k * 150, c = VC[r.verdict], tot = r.cutAmt + r.carCost + Math.max(0, r.net);
  const w1 = W * r.cutAmt / tot, w2 = W * r.carCost / tot, w3 = W * Math.max(0, r.net) / tot;
  rows += `<rect x="${L}" y="${y - 44}" width="10" height="120" fill="${c[0]}"/>` +
    `<text x="${L + 30}" y="${y}" font-family="${F}" font-size="40" font-weight="700" fill="#1d1f24">${r.name}</text>` +
    `<text x="${L + W}" y="${y}" text-anchor="end" font-family="${M}" font-size="40" font-weight="700" fill="${c[0]}">${A.money(r.perHour)}<tspan font-family="${F}" font-size="24" fill="#80858f"> 元/小时</tspan></text>` +
    `<rect x="${L + 30}" y="${y + 20}" width="${(w1 * (W - 30) / W).toFixed(1)}" height="22" fill="#9aa0ab"/>` +
    `<rect x="${(L + 30 + w1 * (W - 30) / W).toFixed(1)}" y="${y + 20}" width="${(w2 * (W - 30) / W).toFixed(1)}" height="22" fill="#c58b4a"/>` +
    `<rect x="${(L + 30 + (w1 + w2) * (W - 30) / W).toFixed(1)}" y="${y + 20}" width="${(w3 * (W - 30) / W).toFixed(1)}" height="22" fill="#1f7a4d"/>` +
    `<text x="${L + 30}" y="${y + 80}" font-family="${F}" font-size="27" fill="${c[0]}" font-weight="700">${A.VERDICT[r.verdict]}${r.verdict === 'take' ? ' · 比目标多挣 ' + A.money(r.gap) + ' 元' : ' · 至少要 ' + A.money(r.minPrice) + ' 元才值'}</text>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <rect width="1200" height="1200" fill="#f3f2ee"/>
  <rect x="60" y="60" width="1080" height="1080" rx="24" fill="#ffffff"/>
  <text x="${L}" y="210" font-family="${F}" font-size="112" font-weight="700" fill="#1d1f24">这单接不接</text>
  <text x="${L}" y="282" font-family="${F}" font-size="36" fill="#80858f">扣掉抽成和车钱，按时间算，够不够你的时薪</text>
  <text x="${L}" y="360" font-family="${F}" font-size="30" fill="#4d525c">虚构示例：抽成 ${A.num(o.v.cut)}% · 每公里 ${A.num(o.v.cpk)} 元 · 目标每小时 ${A.num(o.v.goal)} 元</text>
  ${rows}
  <text x="${L + 30}" y="1100" font-family="${F}" font-size="24" fill="#80858f">灰：平台抽成　棕：车钱　绿：净赚</text>
</svg>`;
fs.writeFileSync('cover.svg', svg);
console.log('cover.svg', svg.length);
