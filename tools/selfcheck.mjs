#!/usr/bin/env node
/**
 * 离线自检：不联网、不碰真实剪贴板、不碰真实数据目录。
 *
 *   node tools/selfcheck.mjs         离线
 *   node tools/selfcheck.mjs --net   额外抓一次真实公开页（验证站点没改版）
 *
 * 覆盖：包契约、flight 载荷解析（含字符串内括号）、列表/详情/战备档解析、
 *       本地库去重与口味学习、剪贴板收码的接受与拒绝、工具端到端。
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import GUNSMITH from '../src/index.js';
import { GunsmithWorld, nameHints } from '../src/world.js';
import { GunStore } from '../src/store.js';
import { extractJsonAfter, flightPayload, parseGunDetail, parseGunsList, parseTiers } from '../src/site.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const eq = (name, actual, expected) => ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);

/* ── 夹具：真实字段结构，自己造一份 flight 载荷 ───────────── */
const GUN_A = 'AN94突击步枪-烽火地带-6LR24DK02CGRPJ9ITGHGB';
const GUN_B = 'PKM通用机枪-烽火地带-6LR0SO004MAO1U0IM6U4R';
const records = [
  {
    id: 13785,
    solutionCode: GUN_A,
    name: '超高性价比AN94',
    price: 267279,
    authorNickname: '林树',
    // 故意在字符串里放方括号和花括号，考的是括号配平扫描
    authorComment: '<p>超高的甲伤 [test] {x} 好用</p>',
    mapDetail: [{ mapID: 10002, mapName: '零号大坝' }, { mapID: 10013, mapName: '潮汐监狱' }],
    tagDetail: [{ tagName: '新武器' }, { tagName: '后坐力稳' }],
    likeNum: 699,
    applyNum: 1583237,
    propertiesDetail: JSON.stringify({ delta: { recoil: 25, control: -2, stable: -4 } }),
    armsDetail: { objectName: 'AN94突击步枪' },
    updated_at: '2026-11-09 11:42:45',
  },
  {
    id: 13777,
    solutionCode: GUN_B,
    name: '纯腰射PKM',
    price: 440000,
    authorNickname: 'Key725',
    authorComment: '',
    mapDetail: [{ mapName: '潮汐监狱' }],
    tagDetail: [{ tagName: '腰射专用' }, { tagName: '高性价比' }],
    likeNum: 12,
    applyNum: 300,
    propertiesDetail: JSON.stringify({ delta: { recoil: 5 } }),
    armsDetail: { objectName: 'PKM通用机枪' },
    updated_at: '2026-11-01 10:00:00',
  },
];

const payload = `{"initialTab":"official","officialFirstPage":${JSON.stringify(records)},"tail":"done"}`;
const listHtml = `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;

const detailPayload = JSON.stringify({
  slots: [
    { slotID: '6', name: '枪口', accessory: { objectID: 13130000175, name: 'AK实用补偿器', grade: 3 } },
    { slotID: '2', name: '枪管', accessory: { objectID: 13020000628, name: 'AN94长枪管', grade: 4 } },
    { slotID: '19', name: '左导轨', accessory: null },
    { slotID: '11', name: '瞄准镜', accessory: { objectID: 13110000085, name: 'AP5000反射式瞄准镜', grade: 2 } },
  ],
  propertiesDetail: { delta: { recoil: 25, control: -2 } },
});
const detailHtml = `<html><script>self.__next_f.push([1,${JSON.stringify(detailPayload)}])</script></html>`;

const tiersHtml = `<div>11W 大坝、长弓—机密</div><div>18W 航天、巴克什—机密</div><div>55W 巴克什—绝密</div><div>78W 潮汐监狱—绝密</div>`;

/** 卡战备套装夹具：11W 档头甲 2W，78W 档头甲 15W（让「头甲也算战备」可测） */
const setsPayload = JSON.stringify({
  allData: [[
    {
      cz: -3000,
      data: [
        { name: 'AKS-74U突击步枪', price: 90000, jz: 0, type: '枪1' },
        { name: '复古摩托头盔', price: 12000, jz: 0, type: '头盔' },
        { name: '安保防弹衣', price: 8000, jz: 0, type: '护甲' },
      ],
    },
    {
      cz: 0,
      data: [
        { name: '满改步枪', price: 635000, jz: 0, type: '枪1' },
        { name: 'DRO 战术头盔', price: 90000, jz: 0, type: '头盔' },
        { name: '制式防弹背心', price: 60000, jz: 0, type: '护甲' },
      ],
    },
  ]],
});
const tiersHtmlWithSets = `${tiersHtml}<script>self.__next_f.push([1,${JSON.stringify(setsPayload)}])</script>`;

/* ── 1. 包契约 ─────────────────────────────────────── */
console.log('\n[1] 包契约');
eq('id', GUNSMITH.id, 'gunsmith');
ok('label 有值', typeof GUNSMITH.label === 'string' && GUNSMITH.label.length > 3);
const d1 = GUNSMITH.defaults(), d2 = GUNSMITH.defaults();
eq('defaults 默认 enabled:false', d1.enabled, false);
ok('defaults 每次返回新对象', d1 !== d2);
d1.enabled = true;
eq('改一份不影响另一份', d2.enabled, false);
ok('create 是函数', typeof GUNSMITH.create === 'function');
ok('窗口 key 与包名一致', GUNSMITH.id === 'gunsmith');
const decls = GUNSMITH.describe.tools.map((t) => t.name);
eq('工具数量', decls.length, 8);
ok('每个工具都有 summary', GUNSMITH.describe.tools.every((t) => t.summary?.zh && t.summary?.en));
ok('每个工具都有 parameters', GUNSMITH.describe.tools.every((t) => t.parameters?.type === 'object'));
eq('不推事件', GUNSMITH.describe.events.length, 0);

/* ── 2. 解析器 ─────────────────────────────────────── */
console.log('\n[2] 解析器（flight 载荷）');
ok('flightPayload 能拼回载荷', flightPayload(listHtml).includes('officialFirstPage'));
const arr = extractJsonAfter(payload, 'officialFirstPage', '[');
ok('extractJsonAfter 取到 2 条', Array.isArray(arr) && arr.length === 2);
const list = parseGunsList(listHtml, { siteBase: 'https://shushu.fan' });
eq('parseGunsList 条数', list.length, 2);
eq('第一条的码', list[0].code, GUN_A);
eq('枪名来自 armsDetail.objectName', list[0].gun, 'AN94突击步枪');
eq('价格', list[0].price, 267279);
ok('地图解析', list[0].maps.includes('潮汐监狱') && list[0].maps.includes('零号大坝'));
ok('标签解析', list[0].tags.includes('后坐力稳'));
ok('作者点评去了 HTML 且保住了方括号内容', list[0].comment === '超高的甲伤 [test] {x} 好用', list[0].comment);
eq('属性变化 recoil', list[0].props.recoil, 25);
ok('详情 URL 拼对', list[0].url.includes('/guns/official/13785'));

const det = parseGunDetail(detailHtml);
eq('配件条数（null 的被滤掉）', det.accessories.length, 3);
eq('槽位→配件名', det.accessories[0].slot + det.accessories[0].name, '枪口AK实用补偿器');
eq('详情属性 delta', det.props?.recoil, 25);

const tiers = parseTiers(tiersHtml);
eq('战备档条数', tiers.length, 4);
eq('第一档', `${tiers[0].wan}|${tiers[0].label}`, '11|大坝、长弓—机密');
eq('最后一档', `${tiers[3].wan}|${tiers[3].label}`, '78|潮汐监狱—绝密');

/* ── 3. 本地库与口味 ───────────────────────────────── */
console.log('\n[3] 本地库与口味学习');
const dir = await mkdtemp(join(tmpdir(), 'gunsmith-selfcheck-'));
try {
  const store = new GunStore({ dataDir: dir, log: console });
  await store.load();
  eq('空库', store.entries().length, 0);
  await store.upsert({ id: '13785', code: GUN_A, gun: 'AN94突击步枪', name: '超高性价比AN94', tags: ['新武器', '后坐力稳'], maps: ['潮汐监狱'], price: 267279 });
  eq('存一条', store.entries().length, 1);
  const again = await store.upsert({ code: GUN_A, price: 250000 });
  ok('同码再存 = 更新', again.updated === true);
  eq('同码不会变两条', store.entries().length, 1);
  eq('更新覆盖价格', store.entries()[0].price, 250000);
  eq('更新保留原有枪名', store.entries()[0].gun, 'AN94突击步枪');

  const reloaded = new GunStore({ dataDir: dir, log: console });
  await reloaded.load();
  eq('重启后还在', reloaded.entries().length, 1);

  const r = await reloaded.rate('13785', 2, '太抖');
  ok('低分学到 avoidTags', reloaded.avoidTags().includes('后坐力稳'), JSON.stringify(reloaded.avoidTags()));
  ok('「新武器」不进 avoidTags', !reloaded.avoidTags().includes('新武器'));
  eq('打星记进 rated', reloaded.taste.rated['13785'].stars, 2);

  const removed = await reloaded.remove('13785');
  ok('能删掉', removed && reloaded.entries().length === 0);
} finally {
  await rm(dir, { recursive: true, force: true });
}

/* ── 4. 工具端到端（假网络 + 假剪贴板） ─────────────── */
console.log('\n[4] 工具端到端');
const dir2 = await mkdtemp(join(tmpdir(), 'gunsmith-tools-'));
try {
  let written = '';
  let clipText = '随便一句不是码的话';
  const clip = { ok: true, read: () => ({ ok: true, text: clipText }), write: (t) => { written = t; return { ok: true, bytes: t.length }; } };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('/kzb')) return tiersHtml;
    if (url.includes('/guns/official/')) return detailHtml;
    return listHtml;
  };
  const world = new GunsmithWorld({
    cfg: { ...GUNSMITH.defaults(), enabled: true, readPublicPages: true, bundledCatalog: false },
    dataDir: dir2,
    log: console,
    deps: { fetchText: fakeFetch, clipboard: clip },
  });
  await world.start({ pushEvent: async () => true });
  const tools = Object.fromEntries(world.tools().map((t) => [t.name, t.handler]));
  eq('工具数', Object.keys(tools).length, 8);

  const s1 = await tools.gun_suggest({ scene: '潮汐监狱', limit: 3 });
  ok('按图筛出候选', s1.includes('超高性价比AN94') || s1.includes('纯腰射PKM'), s1);
  ok('候选带 id', s1.includes('id=13785'));
  ok('价格为万', s1.includes('26.7W'), s1);

  const s2 = await tools.gun_suggest({ budgetMax: 300000, limit: 5 });
  ok('预算过滤掉 44W 那套', !s2.includes('纯腰射PKM'), s2);

  const s3 = await tools.gun_suggest({ style: '腰射', limit: 5 });
  ok('风格过滤只剩腰射专用', s3.includes('纯腰射PKM') && !s3.includes('超高性价比AN94'), s3);

  const c1 = await tools.gun_code({ id: '13785' });
  eq('码写进剪贴板', written, GUN_A);
  ok('回执让主人 Ctrl+V', c1.includes('Ctrl+V'), c1);

  const d1r = await tools.gun_detail({ id: '13785' });
  ok('详情按槽位念配件', d1r.includes('枪口 → AK实用补偿器'), d1r);
  ok('详情带合计变化', d1r.includes('后坐力+25'), d1r);

  const bad = await tools.gun_save({});
  ok('剪贴板不是码 → 拒绝', bad.failed === true && bad.text.includes('不像改枪码'), JSON.stringify(bad));
  // 三种真实码形态都得认：带横杠 / 短枪名 / 中间段带 ASCII / 完全不带横杠
  const patterns = new RegExp(GUNSMITH.defaults().codePattern);
  for (const code of [
    'AN94突击步枪-烽火地带-6LR24DK02CGRPJ9ITGHGB',
    '复合弓-烽火地带-6LHSU580B0PR1ICILKSLV',
    '超稳2倍KC17-六式zy-6LGJQ6O04PC56TM4QFHON',
    '6L79CCC0BK4JN1CPUVQAH',
  ]) {
    ok(`码校验放行「${code.slice(0, 14)}…」`, patterns.test(code), code);
  }
  for (const junk of ['随便一句话', 'https://shushu.fan/guns', '2026-11-15 18:17:04']) {
    ok(`码校验拒绝「${junk.slice(0, 10)}」`, !patterns.test(junk), junk);
  }
  clipText = `  ${GUN_B}  `;
  const goodSave = await tools.gun_save({ note: '站上收的' });
  ok('剪贴板是码 → 收下', !goodSave.failed && world.store.entries().length === 1, JSON.stringify(goodSave));
  eq('收码时去了空白', world.store.entries()[0].code, GUN_B);
  eq('从码里猜出枪名', world.store.entries()[0].gun, 'PKM通用机枪');

  const listed = await tools.gun_list({ query: 'PKM' });
  ok('库能搜到', listed.includes('PKM通用机枪'), listed);

  const rated = await tools.gun_rate({ id: world.store.entries()[0].id, stars: 1, note: '太抖' });
  ok('打星后学到避雷标签', world.store.avoidTags().includes('腰射专用') || world.store.avoidTags().includes('高性价比'), JSON.stringify(world.store.avoidTags()));
  ok('打星回执提到不再推', rated.includes('不推'), rated);

  const s4 = await tools.gun_suggest({ style: '腰射', limit: 5 });
  ok('被嫌弃的风格不再出现', !s4.includes('纯腰射PKM'), s4);

  const lo = await tools.gun_loadout_check({ id: '13785', scene: '潮汐监狱', difficulty: '绝密' });
  ok('战备对照带枪价', lo.includes('26.7W'), lo);
  ok('战备对照列出各图门槛', lo.includes('78W'), lo);
  ok('说清这套够得着哪些图', lo.includes('够得着'), lo);
  ok('说清潮汐监狱绝密差多少', lo.includes('不够'), lo);
  ok('标注是估算不是结论', lo.includes('估算') && lo.includes('核一下'), lo);

  const forg = await tools.gun_forget({ id: world.store.entries()[0].id });
  ok('能删', !forg.failed && world.store.entries().length === 0, JSON.stringify(forg));

  ok('只请求了公开页，没碰 /api/', calls.every((u) => !u.includes('/api/')), calls.join(','));

  // 关掉联网但磁盘有缓存 → 照旧能用（缓存是资产，不是负担）
  const offlineCached = new GunsmithWorld({
    cfg: { ...GUNSMITH.defaults(), enabled: true, readPublicPages: false, bundledCatalog: false },
    dataDir: dir2, log: console, deps: { fetchText: fakeFetch, clipboard: clip },
  });
  await offlineCached.start({});
  const oc = await offlineCached.tools().find((t) => t.name === 'gun_suggest').handler({ scene: '潮汐监狱' });
  ok('关掉联网仍吃磁盘缓存', !oc.failed && oc.includes('id='), JSON.stringify(oc));

  // 关掉联网 + 没有缓存 + 空库 → 必须给出可读的说明，不能编方案
  const dir3 = await mkdtemp(join(tmpdir(), 'gunsmith-offline-'));
  try {
    const callsBefore = calls.length;
    const offline = new GunsmithWorld({
      cfg: { ...GUNSMITH.defaults(), enabled: true, readPublicPages: false, bundledCatalog: false },
      dataDir: dir3, log: console, deps: { fetchText: fakeFetch, clipboard: clip },
    });
    await offline.start({});
    const off = await offline.tools().find((t) => t.name === 'gun_suggest').handler({});
    ok('无缓存无本地库时给可读说明', off.failed === true && String(off.text).includes('收一下'), JSON.stringify(off));
    eq('关掉联网时零次网络请求', calls.length, callsBefore);
  } finally {
    await rm(dir3, { recursive: true, force: true });
  }
} finally {
  await rm(dir2, { recursive: true, force: true });
}

/* ── 5. 全库目录：长尾（列表页 20 条之外） ─────────── */
console.log('\n[5] 全库目录');
const dir4 = await mkdtemp(join(tmpdir(), 'gunsmith-catalog-'));
try {
  const TENG_LONG = '腾龙突击步枪-烽火地带-6K0D1680FUSS37J6Q9CUL';
  await writeFile(join(dir4, 'gunsmith-catalog.json'), JSON.stringify({
    version: 1,
    syncedAt: new Date().toISOString(),
    items: [{
      id: '90001',
      code: TENG_LONG,
      name: '20W性价比腾龙',
      gun: '腾龙突击步枪',
      accessories: [
        { slot: '枪口', name: '钢制膛口制退器', grade: 3 },
        { slot: '枪管', name: '新式雪豹短枪管', grade: 4 },
      ],
      stats: { recoil: 12, control: -3 },
      url: 'https://shushu.fan/guns/official/90001',
      source: 'sitemap',
    }],
  }), 'utf8');

  const fetched = [];
  const fakeClip = { ok: true, read: () => ({ ok: true, text: '' }), write: () => ({ ok: true, bytes: 0 }) };
  const world2 = new GunsmithWorld({
    cfg: { ...GUNSMITH.defaults(), enabled: true, bundledCatalog: false },
    dataDir: dir4,
    log: console,
    deps: { fetchText: async (u) => { fetched.push(u); return listHtml; }, clipboard: fakeClip },
  });
  await world2.start({});
  const t2 = Object.fromEntries(world2.tools().map((t) => [t.name, t.handler]));
  eq('目录载入', world2.catalogCache.items.length, 1);

  const s = await t2.gun_suggest({ gun: '腾龙' });
  ok('长尾枪能从全库目录搜到', s.includes('腾龙'), s);
  ok('价格从方案名推断出 20W', s.includes('20.0W'), s);

  const hint = nameHints('20W性价比腾龙');
  eq('nameHints 价格', hint.price, 200000);
  ok('nameHints 推断风格', hint.tags.includes('高性价比'), JSON.stringify(hint.tags));
  eq('nameHints 无 W 时价格 0', nameHints('满改K437').price, 0);

  const before = fetched.length;
  const d = await t2.gun_detail({ id: '90001' });
  ok('全库条目的配件不用联网', d.includes('枪口 → 钢制膛口制退器') && fetched.length === before, d);
  ok('配件带合计变化', d.includes('后坐力+12'), d);

  const s2 = await t2.gun_suggest({ gun: '腾龙', budgetMax: 150000 });
  ok('超预算的长尾被筛掉（候选为空）', s2.includes('没找到'), s2);

  const rich = await t2.gun_suggest({ scene: '潮汐监狱' });
  ok('富元数据条目仍然排在长尾前面', rich.indexOf('AN94') < rich.indexOf('腾龙') || !rich.includes('腾龙'), rich);
} finally {
  await rm(dir4, { recursive: true, force: true });
}

/* ── 6. 图 × 难度 → 战备门槛（含「用户价优先」） ───── */
console.log('\n[6] 战备门槛与价格优先级');
const dir5 = await mkdtemp(join(tmpdir(), 'gunsmith-req-'));
try {
  // 自造三条同图不同价的方案，专测「按价排序」与门槛筛选
  const mk = (i, price) => ({
    id: 5000 + i,
    solutionCode: `测试枪-烽火地带-TESTCODE${i}00`,
    name: `测试方案${i}`,
    price,
    authorNickname: '测试',
    authorComment: '',
    mapDetail: [{ mapName: '零号大坝' }, { mapName: '潮汐监狱' }],
    tagDetail: [],
    likeNum: 1,
    applyNum: 100,
    propertiesDetail: '{}',
    armsDetail: { objectName: '测试枪' },
    updated_at: '',
  });
  const payload3 = JSON.stringify({ officialFirstPage: [mk(1, 120000), mk(2, 267279), mk(3, 440000)] });
  const listHtml3 = `<script>self.__next_f.push([1,${JSON.stringify(payload3)}])</script>`;

  const fakeClip2 = { ok: true, read: () => ({ ok: true, text: '' }), write: () => ({ ok: true, bytes: 0 }) };
  const w3 = new GunsmithWorld({
    cfg: { ...GUNSMITH.defaults(), enabled: true, bundledCatalog: false },
    dataDir: dir5,
    log: console,
    deps: { fetchText: async (u) => (u.includes('/kzb') ? tiersHtmlWithSets : listHtml3), clipboard: fakeClip2 },
  });
  await w3.start({});
  const t3 = Object.fromEntries(w3.tools().map((t) => [t.name, t.handler]));

  ok('启动时就把门槛记住了', w3.envPromptVars()['gunsmith.requirements'].includes('78W'),
    w3.envPromptVars()['gunsmith.requirements']);

  const table = await w3.requirementTable();
  eq('长弓简称归一到全称', table['长弓溪谷']?.['机密'], 11);
  eq('巴克什有两档', `${table['巴克什']['机密']}/${table['巴克什']['绝密']}`, '18/55');
  eq('普通无门槛', table['零号大坝']['普通'], 0);

  // 头甲也算战备：11W 档头甲 2W（× 罚账倍率）→ 枪要求被压低
  const acc11 = w3.accessoryRef(11);
  ok('11W 档头甲参考已折算倍率', acc11 >= 20000 && acc11 <= 22000, String(acc11));
  eq('78W 档头甲参考', w3.accessoryRef(78), 150000);

  // 白盒验证「绝密用最贵那套、机密用中位」
  w3.reqCache.byTier = {
    18: { count: 3, min: 30000, median: 40000, max: 60000, ratio: 1 },
    78: { count: 3, min: 100000, median: 120000, max: 150000, ratio: 1 },
  };
  w3.reqCache.items = [{ wan: 18, difficulty: '机密' }, { wan: 78, difficulty: '绝密' }];
  eq('机密取中位', w3.accessoryRef(18), 40000);
  eq('绝密取最贵那套', w3.accessoryRef(78), 150000);
  w3.cfg = { ...w3.cfg, accessoryMode: 'median' };
  eq('mode=median 时绝密也取中位', w3.accessoryRef(78), 120000);
  w3.cfg = { ...w3.cfg, accessoryMode: 'max' };
  eq('mode=max 时机密也取最贵', w3.accessoryRef(18), 60000);
  w3.cfg = { ...w3.cfg, accessoryMode: 'tiered', accessoryBudget: 99999 };
  eq('accessoryBudget 硬覆盖优先', w3.accessoryRef(18), 99999);
  // 还原真实缓存，后面的端到端测试要靠它（必须先清掉 fetchedAt，否则 requirements() 直接吃缓存）
  w3.cfg = { ...w3.cfg, accessoryBudget: 0 };
  w3.reqCache = { fetchedAt: 0, items: [], byTier: {}, accGlobal: null };
  await w3.requirements();

  // 没给价格 → 用门槛筛，并按枪价从低到高
  const r1 = await t3.gun_suggest({ scene: '零号大坝', difficulty: '机密', limit: 10 });
  ok('头甲把枪价要求压低了（11W 门槛 − 头甲 2.1W）', r1.includes('8.9W'), r1);
  ok('回执说清头甲占多少', r1.includes('2.1W'), r1);
  ok('三套都过门槛', (r1.match(/id=/g) || []).length === 3, r1);
  ok('按枪价从低到高排', r1.indexOf('12.0W') < r1.indexOf('26.7W') && r1.indexOf('26.7W') < r1.indexOf('44.0W'), r1);

  const r2 = await t3.gun_suggest({ scene: '潮汐监狱', difficulty: '绝密' });
  ok('头甲 15W 后枪价门槛降到 63W，三套仍不够 → 明说没找到', r2.includes('没找到') && r2.includes('63.0W'), r2);

  // 用户给了枪价 → 用户说了算，门槛只提示
  const r3 = await t3.gun_suggest({ scene: '潮汐监狱', difficulty: '绝密', budgetMax: 300000, limit: 10 });
  ok('用户给了枪价就按用户的来', r3.includes('12.0W') && r3.includes('26.7W'), r3);
  ok('排除超预算那套', !r3.includes('44.0W'), r3);
  ok('但仍提示低于门槛', r3.includes('⚠') && r3.includes('78W'), r3);

  // 普通难度
  const r4 = await t3.gun_suggest({ scene: '零号大坝', difficulty: '普通' });
  ok('普通无门槛照常推荐', r4.includes('id=') && r4.includes('没有战备门槛'), r4);

  // 这张图没有该难度
  const r5 = await t3.gun_suggest({ scene: '长弓溪谷', difficulty: '绝密' });
  ok('没有该难度时说清有什么', r5.failed === true && r5.text.includes('长弓溪谷'), JSON.stringify(r5));

  // 认不出的图
  const r6 = await t3.gun_suggest({ scene: '火星基地', difficulty: '机密' });
  ok('认不出的图不乱编', r6.failed === true && r6.text.includes('没有'), JSON.stringify(r6));
} finally {
  await rm(dir5, { recursive: true, force: true });
}

/* ── 7. 随包快照：开箱即全库 ───────────────────────── */
console.log('\n[7] 随包快照');
const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const bundledFile = join(pkgRoot, 'data', 'gunsmith-catalog.json');
if (!existsSync(bundledFile)) {
  console.log('  （包里没有 data/gunsmith-catalog.json，跳过——发布版会带）');
} else {
  const dir6 = await mkdtemp(join(tmpdir(), 'gunsmith-bundled-'));
  try {
    const w4 = new GunsmithWorld({
      cfg: { ...GUNSMITH.defaults(), enabled: true, readPublicPages: false },
      dataDir: dir6, log: console,
      deps: { fetchText: async () => listHtml, clipboard: { ok: true, read: () => ({ ok: true, text: '' }), write: () => ({ ok: true }) } },
    });
    await w4.start({});
    ok('空数据目录也能用随包快照', w4.catalogCache.items.length > 100, `${w4.catalogCache.items.length} 条`);
    eq('数据源标成 bundled', w4.catalogCache.source, 'bundled');
    ok('系统提示词里说明了来源与新鲜度', w4.envPromptVars()['gunsmith.catalogSize'].includes('随包快照'),
      w4.envPromptVars()['gunsmith.catalogSize']);

    // 本机同步出来的必须优先于随包快照
    const localFile = join(dir6, 'gunsmith-catalog.json');
    await writeFile(localFile, JSON.stringify({
      version: 1, syncedAt: new Date().toISOString(),
      items: [{ id: '0', code: '本地枪-烽火地带-LOCALONLY01', name: '本地同步的一条', gun: '本地枪', accessories: [], stats: null, url: '' }],
    }), 'utf8');
    const w5 = new GunsmithWorld({
      cfg: { ...GUNSMITH.defaults(), enabled: true, readPublicPages: false },
      dataDir: dir6, log: console,
      deps: { fetchText: async () => listHtml, clipboard: { ok: true, read: () => ({ ok: true, text: '' }), write: () => ({ ok: true }) } },
    });
    await w5.start({});
    eq('本机同步优先于随包快照', w5.catalogCache.items.length, 1);
    eq('数据源标成 local', w5.catalogCache.source, 'local');
  } finally {
    await rm(dir6, { recursive: true, force: true });
  }
}

/* ── 8. 0.1.3 修复项 ─────────────────────────────── */
console.log('\n[8] 0.1.3 修复项');
{
  const { parseLoadoutSets } = await import('../src/site.js');

  // A2：配件不该被算成「枪」
  const inner = JSON.stringify({
    allData: [[{
      cz: 0,
      data: [
        { name: 'AKS-74U突击步枪', price: 12000, jz: 0, type: '枪1' },
        { name: 'AK镂空握把', price: 5000, jz: 0, type: '枪1-后握把' },
        { name: 'PSO狙击8倍瞄准镜', price: 9000, jz: 0, type: '枪1-瞄具' },
        { name: 'AKS-74U突击步枪', price: 12000, jz: 0, type: '枪2' },
        { name: 'DRO 战术头盔', price: 8000, jz: 0, type: '头盔' },
        { name: '安保防弹衣', price: 2000, jz: 0, type: '护甲' },
      ],
    }]],
  });
  const setsHtml = `<script>self.__next_f.push([1,${JSON.stringify(inner)}])</script>`;
  const parsed = parseLoadoutSets(setsHtml);
  const set = parsed.sets?.[0] ?? { guns: [], accessoryCost: -1 };
  ok('A2 配件不算枪', set.guns.every((g) => !/(握把|瞄准镜)/.test(g)), JSON.stringify(set.guns));
  ok('A2 主副武器同名去重', set.guns.length === 1 && set.guns[0] === 'AKS-74U突击步枪', JSON.stringify(set.guns));
  eq('A2 头甲成本只算头盔+护甲', set.accessoryCost, 10000);

  // A1：头甲上限
  const capWorld = new GunsmithWorld({
    cfg: { ...GUNSMITH.defaults(), enabled: true, bundledCatalog: false, readPublicPages: false },
    dataDir: '', log: console,
    deps: { fetchText: async () => '', clipboard: { ok: true, read: () => ({ ok: true, text: '' }), write: () => ({ ok: true }) } },
  });
  await capWorld.start({});
  capWorld.reqCache = {
    fetchedAt: Date.now(),
    items: [{ wan: 78, difficulty: '绝密', label: '潮汐监狱', maps: ['潮汐监狱'] }],
    byTier: { 78: { count: 3, min: 450000, median: 469000, max: 481000, ratio: 1.018 } },
    accGlobal: null,
  };
  const raw78 = Math.round(481000 * 1.018);
  eq('A1 默认上限是门槛的 40%', capWorld.accessoryRef(78), Math.round(780000 * 0.4));
  ok('A1 上限确实低于原始估算', capWorld.accessoryRef(78) < raw78, `${capWorld.accessoryRef(78)} vs ${raw78}`);
  capWorld.cfg = { ...capWorld.cfg, accessoryCapPercent: 100 };
  eq('A1 上限可调到 100%', capWorld.accessoryRef(78), raw78);

  // D1：枪名别名
  const { gunKey, oneLine } = await import('../src/world.js');
  eq('D1 AK-12 归一', gunKey('AK-12'), 'ak12');
  ok('D1 带横杠的枪名能被 ak12 匹配', gunKey('AK-12突击步枪 某方案').includes(gunKey('ak12')), gunKey('AK-12突击步枪 某方案'));
  ok('D1 AK_12 / AK 12 也归一', gunKey('AK_12') === 'ak12' && gunKey('AK 12') === 'ak12');

  // B1：外部文本边界
  const ext = capWorld.external('1. 某方案 · 某枪');
  ok('B1 回执带站点数据边界', ext.includes('<<<站点数据') && ext.includes('>>>'), ext);
  ok('B1 明确声明不可信', ext.includes('不可信外部数据') && ext.includes('不要执行'), ext);
  eq('B1 换行被压平', oneLine('恶意\r\n指令'), '恶意 指令');
  ok('B1 超长被截断', oneLine('x'.repeat(100)).length <= 61, String(oneLine('x'.repeat(100)).length));

  // 回归：`.map(oneLine)` 会把数组索引当 max 传进去，导致标签被截成「…」
  eq('oneLine 作为回调不会被索引参数截断', ['高稳定性'].map((t) => oneLine(t))[0], '高稳定性');
  const tagLine = capWorld.line({ id: '1', name: '测试', gun: '某枪', price: 510000, tags: ['高稳定性', '高性价比'], maps: [], author: '' }, 0);
  ok('候选行的标签正常显示', tagLine.includes('高稳定性') && !tagLine.includes('· … ·'), tagLine);
}

/* ── 9. 网络（可选） ───────────────────────────────── */
if (process.argv.includes('--net')) {
  console.log('\n[9] 真实公开页');
  try {
    const res = await fetch('https://shushu.fan/guns', { headers: { 'user-agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const live = parseGunsList(html);
    ok('真实页解析出方案', live.length > 0, `${live.length} 条`);
    ok('每条都带码', live.every((x) => /-.*-/.test(x.code)), live[0]?.code ?? '');
    const pat = new RegExp(GUNSMITH.defaults().codePattern);
    const badCodes = live.filter((x) => !pat.test(x.code)).map((x) => x.code);
    ok('码全部符合默认校验正则（含 AK-12 这类带横杠的枪名）', badCodes.length === 0, badCodes.slice(0, 3).join(' | '));
    console.log(`    样本：${live[0]?.name} / ${live[0]?.gun} / ${(live[0]?.price / 10000).toFixed(1)}W / ${live[0]?.code}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ 取真实公开页失败 — ${err.message}`);
  }
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
// 不用 process.exit()：undici 的收尾会和强制退出抢 handle，Node 24 会打 libuv 断言。
// 设退出码，等事件循环自然走空。
process.exitCode = fail === 0 ? 0 : 1;
// fetch 的 keep-alive 连接可能把循环挂住，给它一个上限。
setTimeout(() => process.exit(process.exitCode ?? 1), 3000).unref();
