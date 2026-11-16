/**
 * config.json 的 `worlds.gunsmith` 段。
 *
 * 形状由 GUNSMITH_DEFAULTS 定，WebUI 旋钮由 gunsmithConfigGroup(language) 声明：
 * 每个 schema 路径必须落在 `worlds.gunsmith.` 内，且 DEFAULTS 里必须有同名默认值。
 * `x-hot: false` 表示构造时用掉（建缓存），改了要重启 World。
 */

export const GUNSMITH_DEFAULTS = {
  enabled: false,
  /** 数据站根地址。换镜像/换站只改这里。 */
  siteBase: 'https://shushu.fan',
  /** 关掉 = 纯本地库，完全离线。 */
  readPublicPages: true,
  /** 列表摘要缓存分钟数。只在你开口时取，不后台轮询。 */
  cacheMinutes: 60,
  /** 默认场景（图名），留空则不限。 */
  defaultScene: '',
  /** 默认预算（哈夫币）。0 = 不限。 */
  defaultBudget: 0,
  /** 风格偏好，逗号分隔，如「后坐力稳,高性价比」。 */
  preferStyles: '',
  /** 「收一下」时允许读剪贴板。 */
  clipboardRead: true,
  /** gun_code 时允许把码写进剪贴板。 */
  clipboardWrite: true,
  /**
   * 判断剪贴板内容像不像改枪码。两种形态都认：
   *   ① `AN94突击步枪-烽火地带-6LR24DK02CGRPJ9ITGHGB`（枪名可能自带横杠或很短，中间段不一定是烽火地带）
   *   ② 不带横杠的纯字母数字码，如 `6L79CCC0BK4JN1CPUVQAH`
   * 别的文本一律拒绝。
   */
  codePattern: '^(?:(?:\\S+-){2,}[A-Za-z0-9]{6,40}|[A-Za-z0-9]{12,40})$',
  /** 剪贴板 / 篇幅等已经在下面声明。 */
  /** 头甲折算战备的估法：tiered（绝密取最贵那套、机密取中位）/ median / max。 */
  accessoryMode: 'tiered',
  /** 硬性指定头甲占多少战备（哈夫币）；0 = 用站点数据推。 */
  accessoryBudget: 0,
  /** 全库目录文件路径；留空 = 用数据目录下的 gunsmith-catalog.json。可指向别人同步好的快照。 */
  catalogFile: '',
  /** 是否把随包自带的目录快照（data/gunsmith-catalog.json）当兜底数据源。 */
  bundledCatalog: true,
  /** 单次 HTTP 超时。 */
  timeoutMs: 12000,
  /** koffi 手动指路（只在自动探测失败时用）。 */
  koffiPath: '',
};

const TEXT = {
  zh: {
    title: '桌宠改枪台',
    description: '按地图、预算、风格挑三角洲配装，把改枪码放进剪贴板；顺带给配件清单与属性变化。数据来自公开网页，不碰游戏。',
    siteTitle: '数据站',
    siteDesc: '默认 https://shushu.fan（鼠鼠工具）。只读公开页面，不碰 /api/。',
    readTitle: '允许读公开页',
    readDesc: '关掉后只查本地库，完全离线。',
    cacheTitle: '缓存时间',
    cacheDesc: '列表摘要缓存多久。只在你问的时候才去取，不后台轮询。',
    sceneTitle: '默认场景',
    sceneDesc: '常打的图，例如「潮汐监狱」。留空则不限。',
    budgetTitle: '默认预算',
    budgetDesc: '哈夫币。0 表示不限。',
    styleTitle: '风格偏好',
    styleDesc: '逗号分隔，例如「后坐力稳,高性价比」。影响推荐排序。',
    clipReadTitle: '允许读剪贴板',
    clipReadDesc: '你说「收一下」时，从剪贴板取你复制的改枪码。',
    clipWriteTitle: '允许写剪贴板',
    clipWriteDesc: '把选中的码放进剪贴板，你回游戏按 Ctrl+V。',
    patternTitle: '码格式校验',
    patternDesc: '正则。剪贴板内容不匹配就拒绝入库。',
    timeoutTitle: '请求超时',
    timeoutDesc: '单次网页请求超时（毫秒）。',
    koffiTitle: 'koffi 路径',
    koffiDesc: '只在自动探测失败时填，指向 Coopanion 的 resources\\app 目录。',
    accTitle: '头甲占多少战备',
    accDesc: '手动指定头盔/护甲/胸挂/背包合计占多少战备。0 = 用站点卡战备套装自动估。',
    accModeTitle: '头甲估法',
    accModeDesc: 'tiered（绝密取最贵那套、机密取中位，推荐）/ median / max。',
    catalogTitle: '全库目录文件',
    catalogDesc: '留空 = 数据目录下的 gunsmith-catalog.json。也可以指向别人同步好的快照。',
    bundledTitle: '用随包快照兜底',
    bundledDesc: '开 = 本机没有自己同步的目录时，用包里自带的那份快照（约 1400 条）。关 = 只用本机数据。',
    unitMinute: '分钟',
    unitSecond: '秒',
    unitHaf: '哈夫币',
  },
  en: {
    title: 'Gunsmith Bench',
    description: 'Picks Delta Force gun builds by map, budget and style, and puts the share code on your clipboard, with the attachment list and stat deltas.',
    siteTitle: 'Data site',
    siteDesc: 'Defaults to https://shushu.fan. Public pages only; /api/ is never touched.',
    readTitle: 'Read public pages',
    readDesc: 'Off means local library only, fully offline.',
    cacheTitle: 'Cache',
    cacheDesc: 'How long the list summary is kept. Fetched only when you ask, never on a timer.',
    sceneTitle: 'Default scene',
    sceneDesc: 'Your usual map, e.g. 潮汐监狱. Empty means any.',
    budgetTitle: 'Default budget',
    budgetDesc: 'In Havoc coins. 0 means unlimited.',
    styleTitle: 'Style preferences',
    styleDesc: 'Comma separated, e.g. "后坐力稳,高性价比". Affects ranking.',
    clipReadTitle: 'Allow clipboard read',
    clipReadDesc: 'Reads the share code you copied when you say so.',
    clipWriteTitle: 'Allow clipboard write',
    clipWriteDesc: 'Puts the chosen code on the clipboard for you to paste in game.',
    patternTitle: 'Code pattern',
    patternDesc: 'Regex. Clipboard content that does not match is refused.',
    timeoutTitle: 'Request timeout',
    timeoutDesc: 'Per-request timeout in milliseconds.',
    koffiTitle: 'koffi path',
    koffiDesc: 'Only needed when auto-detection fails: the Coopanion resources\\app folder.',
    accTitle: 'Armour share of the threshold',
    accDesc: 'Fixed loadout-value share taken by helmet/armour/rig/backpack. 0 = estimate from the site\'s 卡战备 sets.',
    accModeTitle: 'Armour estimate',
    accModeDesc: 'tiered (priciest set for 绝密, median for 机密; recommended) / median / max.',
    catalogTitle: 'Full catalog file',
    catalogDesc: 'Empty = gunsmith-catalog.json in the data directory. Point it at someone else\'s synced snapshot if you have one.',
    bundledTitle: 'Fall back to the bundled snapshot',
    bundledDesc: 'On = use the snapshot shipped in the package (about 1400 builds) when this machine has no catalog of its own. Off = local data only.',
    unitMinute: 'min',
    unitSecond: 's',
    unitHaf: 'coins',
  },
};

export function gunsmithText(language) {
  return String(language ?? '').toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en;
}

const str = (title, description, hot = true) => ({ type: 'string', title, description, 'x-hot': hot });
const bool = (title, description) => ({ type: 'boolean', title, description, 'x-hot': true });
const int = (title, description, suffix, extra = {}) => ({
  type: 'integer', title, description, 'x-hot': true, ...(suffix ? { 'x-suffix': suffix } : {}), ...extra,
});

/** 本 World 声明的可调项。`worlds.gunsmith.enabled` 由装配层管，不在这里声明。 */
export function gunsmithConfigGroup(language) {
  const t = gunsmithText(language);
  return {
    id: 'world:gunsmith',
    owner: 'world:gunsmith',
    schema: {
      type: 'object',
      title: t.title,
      description: t.description,
      properties: {
        'worlds.gunsmith.siteBase': str(t.siteTitle, t.siteDesc),
        'worlds.gunsmith.readPublicPages': bool(t.readTitle, t.readDesc),
        'worlds.gunsmith.cacheMinutes': int(t.cacheTitle, t.cacheDesc, t.unitMinute, { minimum: 0, maximum: 1440 }),
        'worlds.gunsmith.defaultScene': str(t.sceneTitle, t.sceneDesc),
        'worlds.gunsmith.defaultBudget': int(t.budgetTitle, t.budgetDesc, t.unitHaf, { minimum: 0 }),
        'worlds.gunsmith.preferStyles': str(t.styleTitle, t.styleDesc),
        'worlds.gunsmith.clipboardRead': bool(t.clipReadTitle, t.clipReadDesc),
        'worlds.gunsmith.clipboardWrite': bool(t.clipWriteTitle, t.clipWriteDesc),
        'worlds.gunsmith.accessoryBudget': int(t.accTitle, t.accDesc, t.unitHaf, { minimum: 0 }),
        'worlds.gunsmith.accessoryMode': str(t.accModeTitle, t.accModeDesc),
        'worlds.gunsmith.catalogFile': str(t.catalogTitle, t.catalogDesc),
        'worlds.gunsmith.bundledCatalog': bool(t.bundledTitle, t.bundledDesc),
        'worlds.gunsmith.codePattern': str(t.patternTitle, t.patternDesc),
        'worlds.gunsmith.timeoutMs': int(t.timeoutTitle, t.timeoutDesc, 'ms', {
          minimum: 1000, maximum: 60000, multipleOf: 1000, 'x-scale': 1000, 'x-suffix': t.unitSecond,
        }),
        'worlds.gunsmith.koffiPath': str(t.koffiTitle, t.koffiDesc),
      },
    },
  };
}
