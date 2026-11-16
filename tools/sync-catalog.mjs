#!/usr/bin/env node
/**
 * 全库同步：把 shushu.fan 上**所有**改枪码方案抓进本地目录。
 *
 * 背景：列表页 `/guns` 服务端只渲染第一页 20 条（换 ?page=2 / tab / 关键词都回同一份，
 * 翻页走 /api/，而 robots 明确 Disallow: /api/）。但 **sitemap 里列了 1392 个明细页**
 * `/guns/official/<id>`，每页都带明文改枪码 + 槽位配件，且 robots 对方是 Allow: /。
 * 所以全库要靠 sitemap + 明细页，一次抓一遍，之后走本地目录，不再重复抓。
 *
 * 用法：
 *   node tools/sync-catalog.mjs --out <数据目录>/gunsmith-catalog.json
 *   node tools/sync-catalog.mjs --out ... --limit 30       # 试跑 30 个
 *   node tools/sync-catalog.mjs --out ... --delay 1500     # 放慢
 *   node tools/sync-catalog.mjs --out ... --refresh        # 已抓过的也重抓
 *
 * 礼貌约定：默认每个请求间隔 1100ms + 0~400ms 抖动；连续失败 6 次就停；
 * 每 25 条落一次盘，中断不丢进度；不并发。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SITE = 'https://shushu.fan';
/**
 * 改枪码字面（兜底用）。枪名可能自带横杠（`AK-12…`）、可能很短（`复合弓…` 3 字），
 * 中间段也不一定是「烽火地带」——还有 `六式zy` 这种带 ASCII 的。
 * 所以只要「非空格串-中段-字母数字尾」就认，别过度约束。
 */
const CODE_RE = /[\u4e00-\u9fa5A-Za-z0-9-]{1,48}-[\u4e00-\u9fa5A-Za-z0-9]{1,12}-[A-Za-z0-9]{6,40}/g;
/**
 * 明细页载荷里有结构化字段 `"code"`，以它为准：还可能是不带横杠的纯字母数字码
 * （如 `6L79CCC0BK4JN1CPUVQAH`）。
 */
const CODE_FIELD_RE = /"code":"([A-Za-z0-9\u4e00-\u9fa5-]{4,90})"/;

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const out = resolve(opt('out', 'gunsmith-catalog.json'));
const only = String(opt('only', '')).split(',').map((s) => s.trim()).filter(Boolean);
const limit = Number(opt('limit', 0)) || 0;
const delay = Number(opt('delay', 1100)) || 1100;
const refresh = flag('refresh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function flightPayload(html) {
  const parts = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { parts.push(JSON.parse(m[1])); } catch { /* 截断片段丢弃 */ } }
  return parts.join('');
}
function extractJsonAfter(payload, key, open = '[') {
  const close = open === '[' ? ']' : '}';
  const at = payload.indexOf(`"${key}":`);
  if (at < 0) return null;
  const start = payload.indexOf(open, at + key.length + 3);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i >= 0 && i < payload.length; i++) {
    const c = payload[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) { try { return JSON.parse(payload.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function getText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, error: err.cause?.code ?? err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** 明细页 → 一条记录。拿不到码就返回 null。 */
function parseDetail(id, html) {
  const payload = flightPayload(html);
  // 优先结构化字段 `"code":"…"`，退回去用字面正则
  const code = payload.match(CODE_FIELD_RE)?.[1]
    ?? [...new Set([...html.matchAll(CODE_RE)].map((m) => m[0]))][0];
  if (!code) return null;
  const slots = extractJsonAfter(payload, 'slots', '[') ?? [];
  const accessories = slots
    .map((s) => ({ slot: String(s?.name ?? '').trim(), name: String(s?.accessory?.name ?? '').trim(), grade: Number(s?.accessory?.grade) || 0 }))
    .filter((s) => s.name);
  const delta = extractJsonAfter(payload, 'propertiesDetail', '{')?.delta ?? null;
  const titleRaw = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
  const name = titleRaw.replace(/\s*-\s*改枪码\s*-\s*三角洲鼠鼠工具\s*$/, '').trim();
  // 只有带横杠的码才能从首段猜枪名；不带横杠的（`6L79CCC0…`）猜不出来，留空靠方案名匹配
  const segments = code.split('-');
  const gun = segments.length >= 3 && segments[0].length <= 24 ? segments[0] : '';
  return {
    id: String(id),
    code,
    name,
    gun,
    accessories,
    stats: delta ?? null,
    url: `${SITE}/guns/official/${id}`,
    source: 'sitemap',
  };
}

/* ── 跑 ─────────────────────────────────────── */

let catalog = { version: 1, syncedAt: '', items: [] };
try {
  const raw = await readFile(out, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed.items)) catalog = parsed;
} catch (err) {
  if (err.code !== 'ENOENT') log(`读已有目录失败（当作空）: ${err.message}`);
}
const have = new Set(catalog.items.map((x) => String(x.id)));
log(`已有 ${catalog.items.length} 条 → ${out}`);

const sm = await getText(`${SITE}/sitemap.xml`);
if (!sm.ok) { log(`sitemap 取不到（HTTP ${sm.status}），中止`); process.exit(1); }
const ids = [...sm.text.matchAll(/<loc>https:\/\/shushu\.fan\/guns\/official\/(\d+)<\/loc>/g)].map((m) => m[1]);
log(`sitemap 明细页 ${ids.length} 个，id ${ids[0]} … ${ids.at(-1)}`);

const todo = only.length
  ? only
  : (refresh ? ids : ids.filter((id) => !have.has(id)));
const queue = limit > 0 ? todo.slice(0, limit) : todo;
log(`待抓 ${queue.length} 个${limit ? `（试跑上限 ${limit}）` : ''}${only.length ? '（--only 定点）' : ''}，间隔 ${delay}ms + 抖动\n`);

const t0 = Date.now();
let added = 0, failed = 0, streak = 0, done = 0;
const failures = [];

for (const id of queue) {
  const res = await getText(`${SITE}/guns/official/${id}`);
  done++;
  if (!res.ok) {
    failed++; streak++;
    failures.push({ id, status: res.status, error: res.error });
    log(`  ✗ ${id} HTTP ${res.status}${res.error ? ` ${res.error}` : ''}（连续 ${streak}）`);
    if (streak >= 6) { log('\n连续失败 6 次，停下来（可能被限流或网络断了）。已完成部分已落盘。'); break; }
  } else {
    streak = 0;
    const rec = parseDetail(id, res.text);
    if (rec) {
      catalog.items.push(rec);
      have.add(String(id));
      added++;
    } else {
      failed++;
      failures.push({ id, reason: 'no code' });
      log(`  ✗ ${id} 解析不出码`);
    }
  }

  if (done % 25 === 0) {
    catalog.syncedAt = new Date().toISOString();
    catalog.failures = failures.slice(-50);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    const perSec = done / ((Date.now() - t0) / 1000);
    const left = queue.length - done;
    log(`  …${done}/${queue.length} | 新增 ${added} | 失败 ${failed} | ${perSec.toFixed(2)}/s | 预计还剩 ${Math.round(left / perSec / 60)} 分钟`);
  }
  await sleep(delay + Math.floor(Math.random() * 400));
}

catalog.syncedAt = new Date().toISOString();
catalog.failures = failures.slice(-50);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

const mins = ((Date.now() - t0) / 60000).toFixed(1);
log(`\n完成：新增 ${added}，失败 ${failed}，用时 ${mins} 分钟`);
log(`目录共 ${catalog.items.length} 条 → ${out}`);
if (failures.length) log(`失败样例: ${failures.slice(0, 5).map((f) => `${f.id}(${f.status ?? f.reason})`).join(', ')}`);
