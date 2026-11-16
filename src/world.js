/**
 * GunsmithWorld —— 桌宠改枪台。
 *
 * 三个数据来源，都有明确边界：
 *   1. 公开网页（/guns 列表、/guns/official/<id> 详情、/kzb 战备档）—— 只读，不碰 /api/
 *   2. 剪贴板（你说「收一下」时才读一次；选中方案时把码写进去，Ctrl+V 由主人按）
 *   3. 本地库 + 口味（你说过的「太抖」「太贵」记在这里）
 *
 * 不检测游戏、不读窗口、不读画面、不模拟键鼠——这个 World 跟游戏进程零接触。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUNSMITH_DEFAULTS, gunsmithConfigGroup, gunsmithText } from './config.js';
import { createClipboard } from './clipboard.js';
import { GunStore, normalizeCode, sameCode } from './store.js';
import {
  canonicalMap, fetchText, parseGunDetail, parseGunsList, parseLoadoutSets, parseRequirements, parseTiers, urls,
} from './site.js';

const WORLD_ID = 'gunsmith';
const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const CACHE_FILE = 'gunsmith-cache.json';
const TIERS_FILE = 'gunsmith-tiers.json';
/** 全库目录：由 tools/sync-catalog.mjs 从 sitemap + 明细页抓来，1392 个方案。 */
const CATALOG_FILE = 'gunsmith-catalog.json';
/**
 * 随包自带的目录快照（data/gunsmith-catalog.json）。
 * 别人下载装上就有全库，不用先跑 30 分钟同步；本机同步过的会优先于它。
 */
const BUNDLED_CATALOG = fileURLToPath(new URL('../data/gunsmith-catalog.json', import.meta.url));
/** 图 × 难度 → 战备要求，来自 /kzb。 */
const REQ_FILE = 'gunsmith-requirements.json';
/** 站上不列「普通」，按无门槛处理。 */
const NO_REQUIREMENT = 0;

/** 用户嘴里的风格词 → 站点标签。 */
const STYLE_ALIASES = {
  后坐力稳: ['后坐力稳', '高稳定性', '稳'],
  高稳定性: ['高稳定性', '后坐力稳'],
  高性价比: ['高性价比'],
  性价比: ['高性价比'],
  满改: ['满改神器'],
  满改神器: ['满改神器'],
  以小博大: ['以小博大'],
  腰射: ['腰射专用', '腰射专用'],
  腰射专用: ['腰射专用'],
  便宜: ['高性价比', '以小博大'],
};

const IGNORE_TAGS = new Set(['新武器', '赛事同款', '金枪客']);

export const GUNSMITH_TOOL_DECLS = [
  {
    name: 'gun_suggest',
    description: 'Suggest Delta Force gun builds. Searches the full local catalog (about 1400 builds synced from the site sitemap), the site\'s newest 20 builds with rich metadata, and anything the owner saved. Returns id, build name, weapon, price in Havoc coins, author and tags, skipping tags the owner disliked. Note: entries from the full catalog carry price and style inferred from the build name.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scene: { type: 'string', description: 'Map name, e.g. 潮汐监狱 / 零号大坝 / 长弓溪谷 / 航天基地 / 巴克什. Omit to use the configured default.' },
        difficulty: {
          type: 'string',
          enum: ['普通', '机密', '绝密'],
          description: 'Difficulty tier. Together with scene it sets the 战备 threshold: when the owner gave no price, builds whose gun price reaches the threshold are recommended. When the owner did give a price, that price wins and the threshold is only mentioned.',
        },
        gun: { type: 'string', description: 'Weapon name filter, e.g. AN94 / K437 / PKM / MDR.' },
        budgetMin: { type: 'number', description: 'Owner\'s own minimum gun price in Havoc coins. Takes precedence over the 战备 threshold. Accepts 80000 or 8 (万).' },
        budgetMax: { type: 'number', description: 'Owner\'s own maximum gun price in Havoc coins. Takes precedence over the 战备 threshold. Accepts 80000 or 8 (万).' },
        style: { type: 'string', description: 'Style tag, e.g. 后坐力稳 / 高性价比 / 满改 / 以小博大 / 腰射专用.' },
        limit: { type: 'integer', description: 'How many candidates, 1 to 10. Defaults to 3.', minimum: 1, maximum: 10 },
        refresh: { type: 'boolean', description: 'Ignore the cache and refetch the public list.' },
      },
    },
  },
  {
    name: 'gun_code',
    description: 'Pick one build and put its share code on the clipboard, ready for the owner to paste in game. Use the id from gun_suggest, or match by gun+scene+style.',
    tags: ['read', 'write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id returned by gun_suggest or gun_list.' },
        gun: { type: 'string', description: 'Weapon name when no id is given.' },
        scene: { type: 'string', description: 'Map name when no id is given.' },
        style: { type: 'string', description: 'Style tag when no id is given.' },
      },
    },
  },
  {
    name: 'gun_detail',
    description: 'Attachment list and stat deltas for one build: slot by slot, e.g. 枪口 → AK实用补偿器.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id returned by gun_suggest or gun_list.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'gun_save',
    description: 'Save a build code into the local library. Takes the code from the clipboard (the owner clicked "copy build code" on the site) or from the code argument. Refuses content that does not look like a share code.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', description: 'The share code. Omit to read it from the clipboard.' },
        gun: { type: 'string', description: 'Weapon name, if known.' },
        note: { type: 'string', description: 'A short note, e.g. 站上「轮椅AK-12」.' },
      },
    },
  },
  {
    name: 'gun_list',
    description: 'Search the local library: every code the owner saved, with stars and notes.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Free text matched against name, gun, note and tags.' },
        gun: { type: 'string', description: 'Weapon name filter.' },
      },
    },
  },
  {
    name: 'gun_rate',
    description: 'Rate a saved or suggested build 1 to 5 stars, with an optional complaint. One or two stars plus a note teach the owner\'s taste: that build\'s style tags stop being suggested.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id of the build.' },
        stars: { type: 'integer', description: '1 to 5.', minimum: 1, maximum: 5 },
        note: { type: 'string', description: 'Short comment, e.g. 太抖 / 开镜慢 / 挺好用.' },
      },
      required: ['id', 'stars'],
    },
  },
  {
    name: 'gun_forget',
    description: 'Remove one build from the local library.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id (or the code) of the build.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'gun_loadout_check',
    description: 'Compare a build price against the site\'s 卡战备 tiers (11W/18W/55W/60W/78W with their maps) and say which tier it sits between.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id of the build.' },
        scene: { type: 'string', description: 'Map to check against; defaults to the configured one.' },
      },
    },
  },
];

export class GunsmithWorld {
  constructor({ cfg, dataDir = '', log = console, deps = {} }) {
    this.id = WORLD_ID;
    this.cfg = cfg;
    this.dataDir = dataDir;
    this.log = log;
    this.host = null;
    this.store = new GunStore({ dataDir, log });
    this.fetchTextImpl = deps.fetchText ?? fetchText;
    this.clipboardImpl = deps.clipboard ?? null;
    this.listCache = { fetchedAt: 0, items: [] };
    this.tierCache = { fetchedAt: 0, items: [] };
    this.catalogCache = { items: [] };
    this.reqCache = { fetchedAt: 0, items: [] };
    this.toolDecls = GUNSMITH_TOOL_DECLS;
  }

  /* ── 生命周期 ───────────────────────────────── */

  async start(host) {
    this.host = host;
    await this.store.load();
    await this.loadCaches();
    // 战备门槛要进系统前缀，所以挂载时取一次（单请求，缓存 60 分钟）；失败不影响启动
    if (!this.reqCache.items.length && this.readPages()) {
      await this.requirements().catch((err) => this.log.warn?.(`[gunsmith] 启动取战备要求失败: ${err.message}`));
    }
  }

  async stop() {
    this.host = null;
  }

  envPromptVars() {
    const budget = this.defaultBudget();
    const reqs = this.reqCache.items;
    return {
      'gunsmith.site': this.siteBase(),
      'gunsmith.defaultScene': String(this.cfg?.defaultScene ?? '').trim() || '未设置',
      'gunsmith.defaultBudget': budget > 0 ? `${(budget / 10000).toFixed(1)}W` : '不限',
      'gunsmith.avoidTags': this.store.avoidTags().join('/') || '还没有',
      'gunsmith.requirements': reqs.length
        ? `${reqs.map((r) => `${r.label} ${r.wan}W`).join('；')}；普通无门槛`
        : '还没取到（下次联网后有了）',
      'gunsmith.catalogSize': this.catalogCache.items.length
        ? `全库 ${this.catalogCache.items.length} 条（${this.catalogCache.source === 'bundled' ? `随包快照 ${String(this.catalogCache.syncedAt).slice(0, 10)}，想要更新的就让主人跑 tools/sync-catalog.mjs` : '本机同步'}）`
        : '全库目录没有：现在只有站点列表页 20 条 + 本地库',
    };
  }

  webUi(language) {
    const t = gunsmithText(language);
    const zh = String(language ?? '').toLowerCase().startsWith('zh');
    return {
      config: [gunsmithConfigGroup(language)],
      promptDocs: [{
        key: 'worlds.gunsmith.envPrompt',
        title: zh ? '改枪台 · 环境提示词' : 'Gunsmith Bench · environment prompt',
        description: zh
          ? '改枪台 World 进 system 前缀的那一段：三个数据来源、能用什么、不许做什么。'
          : 'The Gunsmith Bench World section: its three data sources, what it may do, what it may not.',
        path: ENV_PROMPT_FILE,
        role: 'envPrompt',
        vars: [
          { name: 'gunsmith.site', description: zh ? '当前配置的数据站。' : 'The configured data site.' },
          { name: 'gunsmith.defaultScene', description: zh ? '默认场景；未设置时为空。' : 'Default scene; empty when unset.' },
          { name: 'gunsmith.defaultBudget', description: zh ? '默认预算，形如 8.0W 或「不限」。' : 'Default budget, like 8.0W or 不限.' },
          { name: 'gunsmith.avoidTags', description: zh ? '主人嫌弃过、已自动避开的风格标签。' : 'Style tags the owner disliked and that are now skipped.' },
          { name: 'gunsmith.requirements', description: zh ? '图 × 难度的战备门槛，如「大坝、长弓—机密 11W；…；普通无门槛」。' : 'Loadout-value thresholds per map and difficulty.' },
          { name: 'gunsmith.catalogSize', description: zh ? '全库目录规模，如「全库 1392 条」或「还没同步」。' : 'Size of the synced full catalog.' },
        ],
      }],
      ...(t ? {} : {}),
    };
  }

  /* ── 配置读取 ───────────────────────────────── */

  siteBase() {
    return String(this.cfg?.siteBase ?? GUNSMITH_DEFAULTS.siteBase).trim() || GUNSMITH_DEFAULTS.siteBase;
  }

  readPages() {
    return this.cfg?.readPublicPages !== false;
  }

  timeoutMs() {
    const n = Number(this.cfg?.timeoutMs);
    return Number.isFinite(n) && n >= 1000 ? n : GUNSMITH_DEFAULTS.timeoutMs;
  }

  cacheMs() {
    const n = Number(this.cfg?.cacheMinutes);
    const minutes = Number.isFinite(n) && n >= 0 ? n : GUNSMITH_DEFAULTS.cacheMinutes;
    return minutes * 60 * 1000;
  }

  defaultBudget() {
    const n = Number(this.cfg?.defaultBudget);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  codePattern() {
    const raw = String(this.cfg?.codePattern ?? '').trim() || GUNSMITH_DEFAULTS.codePattern;
    try { return new RegExp(raw); } catch { return new RegExp(GUNSMITH_DEFAULTS.codePattern); }
  }

  clip() {
    if (this.clipboardImpl) return this.clipboardImpl;
    this.clipboardImpl = createClipboard({ koffiPath: String(this.cfg?.koffiPath ?? ''), log: this.log });
    return this.clipboardImpl;
  }

  /* ── 缓存 ───────────────────────────────────── */

  async loadCaches() {
    if (!this.dataDir) return;
    try {
      const raw = await readFile(join(this.dataDir, CACHE_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) this.listCache = { fetchedAt: Number(parsed.fetchedAt) || 0, items: parsed.items };
    } catch (err) { if (err.code !== 'ENOENT') this.log.warn?.(`[gunsmith] 读列表缓存失败: ${err.message}`); }
    try {
      const raw = await readFile(join(this.dataDir, TIERS_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) this.tierCache = { fetchedAt: Number(parsed.fetchedAt) || 0, items: parsed.items };
    } catch (err) { if (err.code !== 'ENOENT') this.log.warn?.(`[gunsmith] 读战备缓存失败: ${err.message}`); }
    // 全库目录：配置指定 > 本机同步 > 随包快照。谁先用上，谁就是这次的数据源。
    const explicit = String(this.cfg?.catalogFile ?? '').trim();
    const candidates = [
      explicit ? { file: explicit, source: 'explicit' } : null,
      this.dataDir ? { file: join(this.dataDir, CATALOG_FILE), source: 'local' } : null,
      this.cfg?.bundledCatalog === false ? null : { file: BUNDLED_CATALOG, source: 'bundled' },
    ].filter(Boolean);
    for (const { file, source } of candidates) {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        const items = Array.isArray(parsed.items) ? parsed.items.filter((x) => x?.code) : [];
        if (!items.length) continue;
        this.catalogCache = { items, file, source, syncedAt: parsed.syncedAt ?? '' };
        this.log.info?.(`[gunsmith] 全库目录 ${items.length} 条已载入（${source}: ${file}）`);
        break;
      } catch (err) {
        if (err.code !== 'ENOENT') this.log.warn?.(`[gunsmith] 读全库目录失败（${file}）: ${err.message}`);
      }
    }
    try {
      const raw = await readFile(join(this.dataDir, REQ_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) {
        this.reqCache = {
          fetchedAt: Number(parsed.fetchedAt) || 0,
          items: parsed.items,
          byTier: parsed.byTier ?? {},
          accGlobal: parsed.accGlobal ?? null,
        };
      }
    } catch (err) { if (err.code !== 'ENOENT') this.log.warn?.(`[gunsmith] 读战备要求失败: ${err.message}`); }
  }

  async writeCache(name, data) {
    if (!this.dataDir) return;
    try {
      const file = join(this.dataDir, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (err) { this.log.warn?.(`[gunsmith] 写缓存失败: ${err.message}`); }
  }

  /* ── 池子：站点列表 + 本地库 ─────────────────── */

  /**
   * 候选池。站点给的是第一页 20 条（翻页走 /api/，不碰）；
   * 本地库里的码补在后面，去重按码。
   */
  async pool({ refresh = false } = {}) {
    const local = this.store.entries();
    let remote = this.listCache.items;

    if (this.readPages()) {
      const stale = refresh || Date.now() - this.listCache.fetchedAt > this.cacheMs();
      if (stale || !remote.length) {
        try {
          const html = await this.fetchTextImpl(urls.guns(this.siteBase()), { timeoutMs: this.timeoutMs() });
          remote = parseGunsList(html, { siteBase: this.siteBase() });
          if (remote.length) {
            this.listCache = { fetchedAt: Date.now(), items: remote };
            await this.writeCache(CACHE_FILE, this.listCache);
          } else if (!this.listCache.items.length) {
            this.log.warn?.('[gunsmith] 公开页没解析出方案，可能是站点改版');
          }
        } catch (err) {
          this.log.warn?.(`[gunsmith] 取列表失败: ${err.message}`);
          remote = this.listCache.items;
        }
      }
    }

    const seen = new Set(remote.map((r) => normalizeCode(r.code).toLowerCase()));
    const extra = local.filter((e) => !seen.has(normalizeCode(e.code).toLowerCase())).map((e) => ({ ...e, from: 'library' }));
    for (const e of extra) seen.add(normalizeCode(e.code).toLowerCase());
    // 全库目录补在后面：列表页只渲染最新 20 条，长尾（1392 个方案）靠它兜住
    const catalog = [];
    for (const c of this.catalogCache.items) {
      const key = normalizeCode(c.code).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      catalog.push(this.fromCatalog(c));
    }
    return [...remote.map((r) => ({ ...r, from: 'site' })), ...extra, ...catalog];
  }

  /** 场景/枪/预算/风格过滤。 */
  filter(items, { scene, gun, budgetMin, budgetMax, style } = {}) {
    const avoid = this.store.avoidTags();
    const pickStyle = this.styleTags(style);
    return items.filter((it) => {
      if (this.avoidTagsHit(it, avoid)) return false;
      if (scene && !this.sceneHit(it, scene)) return false;
      if (gun) {
        const g = String(gun).trim().toLowerCase();
        const hay = `${it.gun ?? ''} ${it.name ?? ''}`.toLowerCase();
        if (!hay.includes(g)) return false;
      }
      const price = Number(it.price) || 0;
      if (budgetMax > 0 && price > 0 && price > budgetMax) return false;
      if (budgetMin > 0 && price > 0 && price < budgetMin) return false;
      if (pickStyle.length && !pickStyle.some((t) => (it.tags ?? []).includes(t))) return false;
      return true;
    });
  }

  /** 打分：偏好风格 > 使用量 > 便宜。 */
  score(it, { style } = {}) {
    let s = 0;
    const prefs = [...this.store.preferStyles(), ...this.styleTags(style)];
    for (const p of prefs) if ((it.tags ?? []).includes(p)) s += 1000;
    s += Math.min(Number(it.applies) || 0, 2_000_000) / 1000;
    s -= (Number(it.price) || 0) / 1_000_000;
    return s;
  }

  sceneHit(item, scene) {
    const q = String(scene ?? '').replace(/\s+/g, '').trim();
    if (!q) return true;
    const maps = item.maps ?? [];
    if (!maps.length) return true; // 本地收的码没有地图信息，别一刀切掉
    return maps.some((m) => m.includes(q) || q.includes(m) || m.slice(0, 2) === q.slice(0, 2));
  }

  styleTags(style) {
    const q = String(style ?? '').trim();
    if (!q) return [];
    for (const [k, v] of Object.entries(STYLE_ALIASES)) if (q.includes(k) || k.includes(q)) return v;
    return [q];
  }

  avoidTagsHit(item, avoid) {
    if (!avoid.length) return false;
    const tags = item.tags ?? [];
    return tags.some((t) => avoid.includes(t));
  }

  parseMoney(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
    const s = String(value).trim().toLowerCase();
    const m = s.match(/([\d.]+)\s*(w|万)?/);
    if (!m) return 0;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return 0;
    return Math.round(m[2] ? n * 10000 : n);
  }

  wan(price) {
    const n = Number(price) || 0;
    return n >= 10000 ? `${(n / 10000).toFixed(1)}W` : `${n}`;
  }

  /** 一行候选，气泡里读起来不啰嗦。 */
  line(it, i) {
    const bits = [
      `${i + 1}. ${it.name || '(无名)'}`,
      it.gun || '',
      `${this.wan(it.price)}`,
      it.author || '',
      (it.tags ?? []).filter((t) => !IGNORE_TAGS.has(t) || (it.tags ?? []).length === 1).slice(0, 3).join('/'),
    ].filter(Boolean);
    const stars = this.store.taste.rated?.[String(it.id)];
    const mark = stars ? ` ★${stars.stars}${stars.note ? ` ${stars.note}` : ''}` : '';
    return `${bits.join(' · ')} · id=${it.id}${mark}`;
  }

  /* ── 工具 ───────────────────────────────────── */

  tools() {
    const bind = (name, fn) => ({
      ...this.toolDecls.find((d) => d.name === name),
      handler: async (args = {}) => {
        try { return await fn(args ?? {}); }
        catch (err) {
          this.log.warn?.(`[gunsmith] ${name} 失败: ${err.message}`);
          return { text: `${name} 出错了：${err.message}`, failed: true };
        }
      },
    });
    return [
      bind('gun_suggest', (a) => this.suggest(a)),
      bind('gun_code', (a) => this.pick(a)),
      bind('gun_detail', (a) => this.detail(a)),
      bind('gun_save', (a) => this.save(a)),
      bind('gun_list', (a) => this.list(a)),
      bind('gun_rate', (a) => this.rate(a)),
      bind('gun_forget', (a) => this.forget(a)),
      bind('gun_loadout_check', (a) => this.loadout(a)),
    ];
  }

  async suggest(a) {
    const scene = String(a.scene ?? this.cfg?.defaultScene ?? '').trim();
    const difficulty = String(a.difficulty ?? '').trim();
    const limit = Math.max(1, Math.min(10, Number(a.limit) || 3));

    // 主人自己给的枪价优先；没给才用配置里的默认预算，再没有就按战备门槛推
    const userMax = this.parseMoney(a.budgetMax);
    const userMin = this.parseMoney(a.budgetMin);
    const budgetMax = userMax || this.defaultBudget();
    const budgetMin = userMin;
    const priceGiven = budgetMax > 0 || budgetMin > 0;

    // 战备门槛：只在主人没提枪价时当筛选依据
    let req = null;
    if (difficulty) {
      const r = await this.requirementFor(scene, difficulty);
      if (r?.error) return { text: r.error, failed: true };
      req = r;
    }

    const items = await this.pool({ refresh: Boolean(a.refresh) });
    if (!items.length) {
      return { text: '现在一个方案都取不到：公开页可能改版了，本地库也还是空的。你在站上复制一个码，说「收一下」我就存下来。', failed: true };
    }

    let hit = this.filter(items, { scene, gun: a.gun, budgetMin, budgetMax, style: a.style });
    let note = '';

    if (req && req.wan > 0) {
      const need = req.wan * 10000;
      const acc = this.accessoryRef(req.wan);
      const gunNeed = Math.max(0, need - acc);
      const accLine = acc > 0 ? `头甲胸挂背包约 ${this.wan(acc)}` : '头甲成本未知';
      if (priceGiven) {
        // 主人的价格说了算：照筛，但门槛该提还是要提
        if (budgetMax > 0 && budgetMax < need) {
          note = `⚠ ${req.map}${req.difficulty}门槛 ${req.wan}W（${accLine}占一部分），你给的 ${this.wan(budgetMax)} 可能进不去。`;
        }
        hit = hit.filter((it) => Number(it.price) > 0); // 价格未知的没法判断，先不给
        hit = hit.sort((x, y) => Number(x.price) - Number(y.price));
      } else {
        hit = hit.filter((it) => Number(it.price) >= gunNeed);
        note = `${req.map}${req.difficulty}门槛 ${req.wan}W；${accLine}也算战备，所以枪价 ≥ ${this.wan(gunNeed)} 就够（从低到高排）。`;
        hit = hit.sort((x, y) => Number(x.price) - Number(y.price));
      }
    } else {
      if (req && req.wan === 0) note = `${req.map} 普通没有战备门槛，随便配。`;
      hit = hit.sort((x, y) => this.score(y, a) - this.score(x, a));
    }
    hit = hit.slice(0, limit);

    if (!hit.length) {
      const avoid = this.store.avoidTags();
      const why = [];
      if (scene) why.push(`图=${scene}`);
      if (difficulty) why.push(`难度=${difficulty}`);
      if (a.gun) why.push(`枪=${a.gun}`);
      if (budgetMax) why.push(`枪价≤${this.wan(budgetMax)}`);
      if (req && req.wan > 0 && !priceGiven) {
        const g = Math.max(0, req.wan * 10000 - this.accessoryRef(req.wan));
        why.push(`枪价≥${this.wan(g)}`);
      }
      if (a.style) why.push(`风格=${a.style}`);
      if (avoid.length) why.push(`已避开=${avoid.join('/')}`);
      return `这个条件下没找到（${why.join('，')}）。要么放宽一条，要么换个条件我再筛。`;
    }

    const head = [
      scene || '不限图',
      difficulty || '',
      budgetMax ? `枪价≤${this.wan(budgetMax)}` : (req?.wan > 0 ? `枪价≥${this.wan(Math.max(0, req.wan * 10000 - this.accessoryRef(req.wan)))}` : '不限预算'),
      a.style || '',
    ].filter(Boolean).join(' · ');
    const lines = hit.map((it, i) => this.line(it, i));
    const tail = note ? `\n${note}` : '';
    return `${head}\n${lines.join('\n')}${tail}\n说编号或 id，我把码放剪贴板。`;
  }

  async pick(a) {
    const items = await this.pool();
    let target = null;
    if (a.id) {
      const key = String(a.id).trim();
      target = items.find((it) => String(it.id) === key)
        ?? items.find((it) => sameCode(it.code, key))
        ?? this.store.find(key);
    }
    if (!target) {
      const list = this.filter(items, {
        scene: a.scene, gun: a.gun, style: a.style, budgetMax: this.defaultBudget(),
      }).sort((x, y) => this.score(y, a) - this.score(x, a));
      target = list[0] ?? null;
    }
    if (!target) return { text: '没找到这个方案，先让我 gun_suggest 一遍，拿 id 再来。', failed: true };

    const written = this.writeClipboard(target.code);
    await this.store.markUsed(target.id);
    const head = `${target.name || '(无名)'} · ${target.gun || ''} · ${this.wan(target.price)}${target.author ? ` · ${target.author}` : ''}`.replace(/ · $/, '');
    const tail = written.ok
      ? '码已经放进剪贴板了，回游戏 Ctrl+V。'
      : `剪贴板没写成（${written.error}），码在下面自己抄一下：`;
    const codeLine = written.ok ? '' : `\n${target.code}`;
    const note = target.comment ? `\n作者说：${target.comment}` : '';
    return `${head}${note}\n${tail}${codeLine}`;
  }

  async detail(a) {
    const key = String(a.id ?? '').trim();
    if (!key) return { text: '要给我一个 id。', failed: true };
    // 先看全库目录：配件清单在同步时就存下来了，不必再联网
    const cat = this.catalogCache.items.find((x) => String(x.id) === key || sameCode(x.code, key));
    if (cat?.accessories?.length) return formatAccessories(cat.accessories, cat.stats ?? null);

    const numeric = key.replace(/\D/g, '');
    if (!numeric) {
      const local = this.store.find(key);
      return local
        ? `本地库这条没有配件清单（收来的码只有码本身）。要配件就在站上打开它看一眼，或直接进游戏粘贴。\n${local.code}`
        : { text: '这个 id 找不到对应方案。', failed: true };
    }
    if (!this.readPages()) return { text: '「允许读公开页」现在是关的，这条又不在全库目录里，配件清单要联网才拿得到。', failed: true };
    const html = await this.fetchTextImpl(urls.detail(this.siteBase(), numeric), { timeoutMs: this.timeoutMs() });
    const { accessories, props } = parseGunDetail(html);
    if (!accessories.length) return { text: '这个方案的详情页没解析出配件，站点可能改版了。', failed: true };
    return formatAccessories(accessories, props);
  }

  async save(a) {
    let code = normalizeCode(a.code);
    let via = '参数';
    if (!code) {
      if (this.cfg?.clipboardRead === false) return { text: '「允许读剪贴板」是关的，把码直接说给我。', failed: true };
      const clip = this.clip();
      if (!clip.ok) return { text: `剪贴板读不了：${clip.reason}。把码直接说给我也行。`, failed: true };
      const got = clip.read();
      if (!got.ok) return { text: `读剪贴板失败：${got.error}`, failed: true };
      code = normalizeCode(got.text);
      via = '剪贴板';
      if (!code) return { text: '剪贴板是空的。先在站上点「复制改枪码」再叫我。', failed: true };
    }
    if (!this.codePattern().test(code)) {
      const preview = code.length > 60 ? `${code.slice(0, 60)}…` : code;
      return { text: `这个看着不像改枪码（${via}：「${preview}」）。改枪码长这样：AN94突击步枪-烽火地带-6LR24DK02CGRPJ9ITGHGB`, failed: true };
    }
    const existing = this.store.entries().find((e) => sameCode(e.code, code));
    // 按码反查站点元数据：剪贴板只给得出一条码，标签/地图/价格得从公开列表里补，
    // 否则打星时没有标签可学，口味永远学不会。
    let siteHit = null;
    if (!existing?.tags?.length) {
      try {
        siteHit = (await this.pool()).find((it) => sameCode(it.code, code)) ?? null;
      } catch (err) {
        this.log.warn?.(`[gunsmith] 反查元数据失败: ${err.message}`);
      }
    }
    const note = String(a.note ?? '').trim();
    const record = {
      id: existing?.id ?? siteHit?.id ?? code,
      code,
      name: siteHit?.name || existing?.name || note,
      gun: String(a.gun ?? '').trim() || siteHit?.gun || existing?.gun || guessGun(code),
      price: siteHit?.price ?? existing?.price ?? 0,
      author: siteHit?.author ?? existing?.author ?? '',
      comment: siteHit?.comment ?? existing?.comment ?? '',
      maps: siteHit?.maps ?? existing?.maps ?? [],
      tags: siteHit?.tags ?? existing?.tags ?? [],
      note,
      url: siteHit?.url ?? existing?.url ?? '',
      source: via === '剪贴板' ? 'clipboard' : 'manual',
    };
    const res = await this.store.upsert(record);
    if (!res.ok) return { text: `没存下来：${res.reason}`, failed: true };
    const label = res.entry.name ? `「${res.entry.name}」` : '';
    const matched = siteHit ? '，站点上认出来了，标签和地图一起存了' : '';
    return `${res.updated ? '更新了' : '收好了'}：${res.entry.gun || '这条'}${label}，来自${via}${matched}。库里有 ${this.store.entries().length} 条。`;
  }

  async list(a) {
    const all = this.store.entries();
    if (!all.length) return '本地库还是空的。你在站上点「复制改枪码」，然后跟我说「收一下」。';
    const q = String(a.query ?? '').trim().toLowerCase();
    const gun = String(a.gun ?? '').trim().toLowerCase();
    const hit = all.filter((e) => {
      if (gun && !`${e.gun ?? ''} ${e.name ?? ''}`.toLowerCase().includes(gun)) return false;
      if (!q) return true;
      return `${e.name ?? ''} ${e.gun ?? ''} ${e.note ?? ''} ${(e.tags ?? []).join(' ')} ${e.code}`.toLowerCase().includes(q);
    });
    if (!hit.length) return `库里 ${all.length} 条，没有匹配「${a.query ?? a.gun}」的。`;
    const lines = hit.slice(0, 10).map((e, i) => {
      const stars = this.store.taste.rated?.[String(e.id)];
      return `${i + 1}. ${e.name || e.gun || '(无名)'}${e.gun && e.name ? ` · ${e.gun}` : ''}${stars ? ` ★${stars.stars}` : ''} · id=${e.id}`;
    });
    return `库里有 ${all.length} 条：\n${lines.join('\n')}`;
  }

  async rate(a) {
    const res = await this.store.rate(a.id, a.stars, a.note);
    if (!res) return { text: '这条不在本地库里。先把方案选一次，或说「收一下」存下来再打分。', failed: true };
    const learned = res.learned?.length ? `，以后不推「${res.learned.join('/')}」了` : '';
    return `记下了：${res.entry.name || res.entry.gun || '这条'} ${'★'.repeat(res.stars)}${res.entry.note ? `（${res.entry.note}）` : ''}${learned}`;
  }

  async forget(a) {
    const gone = await this.store.remove(a.id);
    if (!gone) return { text: `库里没有「${a.id}」。`, failed: true };
    return `删掉了：${gone.name || gone.gun || gone.code}。还剩 ${this.store.entries().length} 条。`;
  }

  async loadout(a) {
    const items = await this.pool();
    const target = (a.id ? items.find((it) => String(it.id) === String(a.id)) ?? this.store.find(a.id) : null);
    if (!target) return { text: '要给我一个 id，我先知道是哪套。', failed: true };
    const price = Number(target.price) || 0;
    const scene = String(a.scene ?? this.cfg?.defaultScene ?? '').trim();
    const difficulty = String(a.difficulty ?? '').trim();

    const reqs = await this.requirements();
    if (!reqs.length) return { text: `这套枪价 ${this.wan(price)}。战备要求这次没取到（离线或站点改版），下次再问。`, failed: true };

    const lines = [`${target.name || target.gun || '这套'} · 枪价 ${this.wan(price)}`];
    lines.push(`战备要求：${reqs.map((r) => `${r.label} ${r.wan}W（头甲约 ${this.wan(this.accessoryRef(r.wan))}）`).join('；')}；普通无门槛`);

    if (price <= 0) {
      lines.push('这套没有价格信息（明细页不带价格），没法对标门槛。');
    } else {
      const reach = [];
      const short = [];
      for (const r of reqs) {
        const need = r.wan * 10000;
        const acc = this.accessoryRef(r.wan);
        const total = price + acc;
        if (total >= need) reach.push(`${r.label} ${r.wan}W（余 ${this.wan(total - need)}）`);
        else short.push(`${r.label} ${r.wan}W（还差 ${this.wan(need - total)}）`);
      }
      lines.push(reach.length ? `够得着：${reach.join('、')}` : '一套都不够门槛');
      if (short.length) lines.push(`配齐头甲也不够：${short.join('、')}`);
    }

    if (difficulty) {
      const req = await this.requirementFor(scene, difficulty);
      if (req?.error) lines.push(req.error);
      else if (req) {
        const need = req.wan * 10000;
        if (need === 0) lines.push(`${req.map} 普通无门槛，这套能进`);
        else {
          const acc = this.accessoryRef(req.wan);
          const total = price + acc;
          lines.push(`${req.map}${req.difficulty}门槛 ${req.wan}W：枪 ${this.wan(price)} + 头甲约 ${this.wan(acc)} = 合计 ≈ ${this.wan(total)} → ${total >= need ? `够（余 ${this.wan(total - need)}）` : `还差 ${this.wan(need - total)}`}`);
        }
      }
    }

    lines.push('注：头甲按站上同档位卡战备套装的中位成本估算，进图前用「卡战备」页核一下更准。');
    return lines.filter(Boolean).join('\n');
  }

  /**
   * 图 × 难度 → 战备要求。来自 `/kzb` 的 `11W 大坝、长弓—机密` 这类档位行；
   * 站上不列「普通」，按无门槛 0 处理。缓存写在 gunsmith-requirements.json。
   */
  async requirements() {
    if (this.reqCache.items.length && Date.now() - this.reqCache.fetchedAt < this.cacheMs()) return this.reqCache.items;
    if (!this.readPages()) return this.reqCache.items;
    try {
      const html = await this.fetchTextImpl(urls.kzb(this.siteBase()), { timeoutMs: this.timeoutMs() });
      const items = parseRequirements(html);
      const loadouts = parseLoadoutSets(html);
      if (items.length) {
        this.reqCache = {
          fetchedAt: Date.now(),
          items,
          byTier: loadouts.byTier ?? {},
          accGlobal: loadouts.accessoryCost ?? null,
        };
        await this.writeCache(REQ_FILE, this.reqCache);
      }
      return items.length ? items : this.reqCache.items;
    } catch (err) {
      this.log.warn?.(`[gunsmith] 取战备要求失败: ${err.message}`);
      return this.reqCache.items;
    }
  }

  /**
   * 这个门槛档位下，头甲胸挂背包大约占掉多少战备。
   *
   * 主人原话：「头甲还算战备」「绝密头甲会贵一点」。所以默认按档位分开估：
   *   - 绝密：取站上同档位套装里**最贵那套**的头甲（绝密大家堆好装备）
   *   - 机密/普通：取中位数（省钱打法居多）
   * 再乘上「站上假账」带来的 战备/售价 倍率——买 X 钱的头甲能顶 X~1.16X 的战备。
   * 配置 `accessoryBudget` 直接覆盖；`accessoryMode` 可强制 median / max。
   */
  accessoryRef(wan) {
    const override = Number(this.cfg?.accessoryBudget);
    if (Number.isFinite(override) && override > 0) return override;
    const byTier = this.reqCache.byTier ?? {};
    const hit = byTier[String(wan)] ?? byTier[wan];
    if (!hit) {
      const global = this.reqCache.accGlobal?.median;
      return global > 0 ? global : 0;
    }
    const mode = String(this.cfg?.accessoryMode ?? 'tiered').trim();
    const difficulty = this.tierDifficulty(wan);
    const useMax = mode === 'max' || (mode === 'tiered' && difficulty === '绝密');
    const cost = useMax ? (hit.max ?? hit.median) : (hit.median ?? hit.min);
    const ratio = Math.min(1.35, Math.max(1, Number(hit.ratio) || 1));
    return Math.round((Number(cost) || 0) * ratio);
  }

  /** 某个门槛档位属于哪个难度（从战备表反查）。 */
  tierDifficulty(wan) {
    const hit = (this.reqCache.items ?? []).find((t) => t.wan === Number(wan));
    return hit?.difficulty ?? '';
  }

  /** 战备表：`{ 零号大坝: { 普通: 0, 机密: 11 }, … }`（单位 W）。 */
  async requirementTable() {
    const reqs = await this.requirements();
    const table = {};
    const touch = (map) => {
      table[map] = table[map] ?? { 普通: NO_REQUIREMENT };
      return table[map];
    };
    for (const r of reqs) for (const map of (r.maps ?? [])) touch(map)[r.difficulty] = r.wan;
    return table;
  }

  /**
   * 某张图某个难度要多少战备（单位 W）。
   * 返回 `{ wan, map, difficulty }`，或 `{ error }` 说明为什么给不出来。
   */
  async requirementFor(scene, difficulty) {
    const d = String(difficulty ?? '').trim();
    if (!d) return null;
    if (!['普通', '机密', '绝密'].includes(d)) return { error: `难度只认 普通 / 机密 / 绝密，不认识「${d}」。` };
    const wanted = String(scene ?? this.cfg?.defaultScene ?? '').trim();
    if (!wanted) return { error: `要知道是哪张图才能给战备要求（例如「潮汐监狱 绝密」）。` };
    const map = canonicalMap(wanted);
    const table = await this.requirementTable();
    const row = table[map];
    if (!row) return { error: `站上的战备档里没有「${map}」，目前有 ${Object.keys(table).join('/')}。` };
    if (row[d] === undefined) {
      const have = Object.entries(row).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}W`).join('、') || '普通（无门槛）';
      return { error: `${map} 没有「${d}」这一档；它有：${have}。` };
    }
    return { wan: row[d], map, difficulty: d };
  }

  /** 说给主人听的一句话战备表。 */
  async requirementsText() {
    const reqs = await this.requirements();
    if (!reqs.length) return '还没取到（离线或站点改版）';
    return reqs.map((r) => `${r.label} ${r.wan}W`).join('；') + '；普通无门槛';
  }

  async tiers() {
    if (this.tierCache.items.length && Date.now() - this.tierCache.fetchedAt < this.cacheMs()) return this.tierCache.items;
    if (!this.readPages()) return this.tierCache.items;
    try {
      const html = await this.fetchTextImpl(urls.kzb(this.siteBase()), { timeoutMs: this.timeoutMs() });
      const items = parseTiers(html);
      if (items.length) {
        this.tierCache = { fetchedAt: Date.now(), items };
        await this.writeCache(TIERS_FILE, this.tierCache);
      }
      return items;
    } catch (err) {
      this.log.warn?.(`[gunsmith] 取战备档失败: ${err.message}`);
      return this.tierCache.items;
    }
  }

  /**
   * 全库目录条目 → 候选记录。
   * 明细页只有码、配件和属性变化，没有价格/地图/标签——这三个从方案名里推断，
   * 并打上 `inferred: true`，上层排序时可以把它们排在富元数据的后面。
   */
  fromCatalog(c) {
    const hint = nameHints(c.name);
    return {
      id: String(c.id ?? c.code),
      code: c.code,
      name: c.name ?? '',
      gun: c.gun ?? guessGun(c.code),
      price: hint.price,
      author: '',
      comment: '',
      maps: [],
      tags: hint.tags,
      likes: 0,
      applies: 0,
      props: c.stats ?? null,
      accessories: c.accessories ?? [],
      updatedAt: '',
      url: c.url ?? '',
      from: 'catalog',
      inferred: true,
    };
  }

  writeClipboard(code) {
    if (this.cfg?.clipboardWrite === false) return { ok: false, error: '「允许写剪贴板」是关的' };
    const clip = this.clip();
    if (!clip.ok) return { ok: false, error: clip.reason };
    return clip.write(code);
  }
}

/** 从码里猜枪名：`AN94突击步枪-烽火地带-…` 的第一段。不带横杠的码猜不出来，返回空。 */
function guessGun(code) {
  const segments = String(code ?? '').split('-');
  if (segments.length < 3) return '';
  const first = segments[0];
  return first && first.length <= 24 ? first : '';
}

/** 方案名里的风格线索：`20W性价比腾龙`、`43W满腰射S12K`、`高秒伤SVCH`。 */
const NAME_STYLE_HINTS = [
  [/性价比|便宜/, '高性价比'],
  [/满改|满配/, '满改神器'],
  [/腰射/, '腰射专用'],
  [/以小博大/, '以小博大'],
  [/后坐力/, '后坐力稳'],
  [/稳定|稳/, '高稳定性'],
];

/** 从方案名推断预算与风格；推断不出来就是 0 / 空数组，不瞎猜。 */
export function nameHints(name) {
  const text = String(name ?? '');
  const tags = [];
  for (const [re, tag] of NAME_STYLE_HINTS) if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  const m = text.match(/(\d+(?:\.\d+)?)\s*[Ww万]/);
  const price = m ? Math.round(Number(m[1]) * 10000) : 0;
  return { price, tags };
}

/** 配件清单的统一排版：槽位 → 配件名（品质星）+ 合计变化。 */
export function formatAccessories(accessories, props = null) {
  const lines = accessories.map((s) => `  ${s.slot} → ${s.name}${s.grade ? `（${'★'.repeat(Math.min(4, s.grade))}）` : ''}`);
  const deltaBits = props
    ? Object.entries({ recoil: '后坐力', control: '操控', stable: '据枪稳定', hipShot: '腰射精度', armorHarm: '甲伤', fireSpeed: '射速', shootDistance: '射程', meatHarm: '肉伤' })
      .filter(([k]) => Number(props[k]))
      .map(([k, label]) => `${label}${Number(props[k]) > 0 ? '+' : ''}${props[k]}`)
      .join(' ')
    : '';
  return `配件（${accessories.length} 件）：\n${lines.join('\n')}${deltaBits ? `\n合计变化：${deltaBits}` : ''}`;
}
