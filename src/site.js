/**
 * shushu.fan 数据抓取 —— 只读公开 SSR 页（robots.txt: Allow: /）。
 *
 * 不解析 DOM：Next.js 的 flight 载荷里已经放好了结构化 JSON，
 * 从 `self.__next_f.push([1,"…"])` 的片段里拼回来再取数组，比刮 HTML 稳得多。
 *
 * 只用两个公开页：
 *   /guns                  → officialFirstPage：20 条方案，**含 solutionCode**（改枪码）
 *   /guns/official/<id>    → slots：槽位 → 配件名（列表页没有配件名）
 *   /kzb                   → 战备档位（11W/18W/55W/60W/78W + 对应地图）
 *
 * 明确不碰 /api/（站方 robots 禁止），也不做翻页（翻页走 /api/）。
 */

export const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 带超时的纯文本请求。 */
export async function fetchText(url, { timeoutMs = 12000, userAgent = DEFAULT_UA } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 把 flight 数据的所有片段拼成一段完整的载荷文本。 */
export function flightPayload(html) {
  const parts = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { parts.push(JSON.parse(m[1])); } catch { /* 截断的片段直接丢 */ }
  }
  return parts.join('');
}

/**
 * 从载荷里取 `"<key>":` 之后第一个括号块并 JSON.parse。
 * 用括号配平扫描，字符串内的括号会被跳过——否则嵌套 JSON 会切歪。
 */
export function extractJsonAfter(payload, key, open = '[') {
  const close = open === '[' ? ']' : '}';
  const at = payload.indexOf(`"${key}":`);
  if (at < 0) return null;
  const start = payload.indexOf(open, at + key.length + 3);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < payload.length; i++) {
    const c = payload[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(payload.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** `propertiesDetail` 有时是字符串、有时是对象。 */
function asJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function stripHtml(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 站点一条原始记录 → 我方记录。字段名只在这里写一次。 */
export function normalizeRecord(raw, { siteBase = 'https://shushu.fan' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const code = String(raw.solutionCode ?? '').trim();
  if (!code) return null;
  const props = asJson(raw.propertiesDetail) ?? {};
  const delta = props.delta ?? props.change ?? {};
  return {
    id: String(raw.id ?? code),
    code,
    name: String(raw.name ?? '').trim(),
    gun: String(raw.armsDetail?.objectName ?? '').trim(),
    price: Number(raw.price) || 0,
    author: String(raw.authorNickname ?? '').trim(),
    comment: stripHtml(raw.authorComment).slice(0, 240),
    maps: (raw.mapDetail ?? []).map((m) => String(m?.mapName ?? '').trim()).filter(Boolean),
    tags: (raw.tagDetail ?? []).map((t) => String(t?.tagName ?? '').trim()).filter(Boolean),
    likes: Number(raw.likeNum) || 0,
    applies: Number(raw.applyNum) || 0,
    props: {
      recoil: delta.recoil ?? null,
      control: delta.control ?? null,
      stable: delta.stable ?? null,
      hipShot: delta.hipShot ?? null,
      armorHarm: delta.armorHarm ?? null,
      fireSpeed: delta.fireSpeed ?? null,
      shootDistance: delta.shootDistance ?? null,
      meatHarm: delta.meatHarm ?? null,
    },
    updatedAt: String(raw.updated_at ?? ''),
    url: `${siteBase}/guns/official/${raw.id ?? ''}?tab=official`,
    source: 'shushu.fan',
  };
}

/** `/guns` 公开页 → 方案数组（当前站点给第一页 20 条）。 */
export function parseGunsList(html, opts = {}) {
  const payload = flightPayload(html);
  const raw = extractJsonAfter(payload, 'officialFirstPage', '[');
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => normalizeRecord(r, opts)).filter(Boolean);
}

/** `/guns/official/<id>` → 槽位配件表 + 武器属性。 */
export function parseGunDetail(html) {
  const payload = flightPayload(html);
  const slots = extractJsonAfter(payload, 'slots', '[') ?? [];
  const accessories = slots
    .map((s) => ({
      slot: String(s?.name ?? '').trim(),
      name: String(s?.accessory?.name ?? '').trim(),
      grade: Number(s?.accessory?.grade) || 0,
    }))
    .filter((s) => s.name);
  const props = extractJsonAfter(payload, 'propertiesDetail', '{')?.delta
    ?? extractJsonAfter(payload, 'propertiesDetail', '{')?.change
    ?? null;
  return { accessories, props };
}

/** `/kzb` → 战备档位 [{ wan, label }]。 */
export function parseTiers(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const out = [];
  const re = /(\d{1,3})W\s*([\u4e00-\u9fa5]{2,6}(?:[、][\u4e00-\u9fa5]{2,6})*\s*[—–-]\s*[\u4e00-\u9fa5]{2,4})/g;
  let m;
  while ((m = re.exec(text))) {
    const label = m[2].replace(/\s+/g, '');
    if (!out.some((t) => t.wan === Number(m[1]) && t.label === label)) {
      out.push({ wan: Number(m[1]), label });
    }
  }
  return out.sort((a, b) => a.wan - b.wan);
}

/**
 * 地图简称 → 全称。`/kzb` 用简称（大坝、长弓、航天），改枪码页用全称。
 */
export const MAP_ALIASES = {
  大坝: '零号大坝',
  长弓: '长弓溪谷',
  航天: '航天基地',
  巴克什: '巴克什',
  潮汐监狱: '潮汐监狱',
  AZ3: 'AZ3',
};

/** 把用户/站点嘴里的图名收敛成全称。认不出就原样返回。 */
export function canonicalMap(name) {
  const n = String(name ?? '').replace(/\s+/g, '').trim();
  if (!n) return '';
  if (MAP_ALIASES[n]) return MAP_ALIASES[n];
  for (const [short, full] of Object.entries(MAP_ALIASES)) {
    if (n === full) return full;
    if (n.includes(short) || full.includes(n)) return full;
  }
  return n;
}

/**
 * `/kzb` → 图 × 难度 → 战备要求。
 * 页面上是 `11W 大坝、长弓—机密` 这样的纯文本；普通难度站上不列，按「无门槛 0」处理。
 */
export function parseRequirements(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const out = [];
  const re = /(\d{1,3})\s*W\s*([\u4e00-\u9fa5A-Za-z0-9、]{2,24}?)\s*[—–-]\s*(普通|机密|绝密)/g;
  let m;
  while ((m = re.exec(text))) {
    const label = m[2].replace(/\s+/g, '');
    const maps = label.split(/[、,，]/).map((s) => canonicalMap(s)).filter(Boolean);
    const tier = { wan: Number(m[1]), label, maps, difficulty: m[3] };
    if (!out.some((t) => t.wan === tier.wan && t.difficulty === tier.difficulty && t.label === tier.label)) out.push(tier);
  }
  return out.sort((a, b) => a.wan - b.wan);
}

/**
 * `/kzb` → 卡战备套装（结构化）。
 *
 * 载荷形状：`"allData":[[{"cz":-15439,"data":[{"name":"AKS-74U突击步枪","price":12068,"jz":197,"type":"枪1"},…]},…],…]`
 *   - `price` 是售价，`cz` 是这套的假账（负值表示战备高于售价）
 *   - 合计售价 = Σprice，合计战备 = Σprice − cz
 *   - `type` 分 枪1/枪1-枪口/头盔/护甲/背包/胸挂/手枪 …
 *
 * 用途：门槛按**总战备**算，头甲胸挂背包也占战备，所以这里把「不带枪那部分要花多少钱」算出来，
 * 推荐时才能说「这套枪 ΔW + 头甲参考 ΔW = 够门槛」。
 */
export function parseLoadoutSets(html) {
  const payload = flightPayload(html);
  const all = extractJsonAfter(payload, 'allData', '[');
  if (!Array.isArray(all)) return { sets: [], accessoryCost: null };

  const isGun = (type) => /^枪|^手枪|^枪械|^近战/.test(String(type ?? ''));
  const sets = [];
  for (const group of all) {
    const rows = Array.isArray(group) ? group : [group];
    for (const row of rows) {
      const items = Array.isArray(row?.data) ? row.data : [];
      if (!items.length) continue;
      const priced = items
        .map((it) => ({
          name: String(it?.name ?? '').trim(),
          price: Number(it?.price) || 0,
          jz: Number(it?.jz) || 0,
          type: String(it?.type ?? '').trim(),
        }))
        .filter((it) => it.name && it.price > 0);
      if (!priced.length) continue;
      const price = priced.reduce((s, it) => s + it.price, 0);
      const fake = Number(row?.cz) || 0;
      const accessory = priced.filter((it) => !isGun(it.type));
      sets.push({
        price,
        fake,
        zhanbei: price - fake,
        accessoryCost: accessory.reduce((s, it) => s + it.price, 0),
        accessory: accessory.map((it) => `${it.name} ${(it.price / 10000).toFixed(1)}W`),
        guns: priced.filter((it) => isGun(it.type)).map((it) => it.name),
      });
    }
  }
  if (!sets.length) return { sets: [], accessoryCost: null, byTier: {} };

  // 头甲参考成本：取这套里「不带枪部分」的中位数，避免被极端套装带偏
  const costs = sets.map((s) => s.accessoryCost).filter((n) => n > 0).sort((a, b) => a - b);
  const accessoryCost = costs.length
    ? { min: costs[0], median: costs[Math.floor(costs.length / 2)], max: costs[costs.length - 1] }
    : null;

  // 按档位分开算：套装的「战备」落在哪一档，就归到哪一档
  const byTier = {};
  const buckets = new Map();
  for (const s of sets) {
    if (s.accessoryCost <= 0) continue;
    const tier = Math.floor(s.zhanbei / 10000);
    if (!buckets.has(tier)) buckets.set(tier, []);
    buckets.get(tier).push(s);
    const r = s.price > 0 ? s.zhanbei / s.price : 0;
    if (!buckets.get(`${tier}:ratio`)) buckets.set(`${tier}:ratio`, []);
    if (r > 0) buckets.get(`${tier}:ratio`).push(r);
  }
  for (const [tier, list] of buckets) {
    if (typeof tier === 'string') continue;
    const costs = list.map((s) => s.accessoryCost).sort((a, b) => a - b);
    const ratios = (buckets.get(`${tier}:ratio`) ?? []).sort((a, b) => a - b);
    byTier[tier] = {
      count: costs.length,
      min: costs[0],
      median: costs[Math.floor(costs.length / 2)],
      max: costs[costs.length - 1],
      // 站上的「假账」让战备≠售价：同一档里 战备/售价 的中位倍率（≥1）
      ratio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1,
    };
  }
  return { sets, accessoryCost, byTier };
}

/* ── URL ─────────────────────────────────────── */

export const urls = {
  guns: (base) => `${trimBase(base)}/guns`,
  detail: (base, id) => `${trimBase(base)}/guns/official/${id}?tab=official`,
  kzb: (base) => `${trimBase(base)}/kzb`,
};

function trimBase(base) {
  return String(base ?? 'https://shushu.fan').trim().replace(/\/+$/, '') || 'https://shushu.fan';
}
