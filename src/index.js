/**
 * 桌宠改枪台 —— Coopanion / Cortico 扩展入口（World api 6）。
 *
 * 契约：
 *   - package.json 的 `cortico.kind` 是 world、`api` 正好是 6；
 *   - 默认导出要有 id / label / defaults() / create()，defaults() 每次返回新对象且 enabled:false；
 *   - create(ctx) 拿到 WorldContext：cfg / dataDir / timezone / botName / persist()；
 *   - 实例实现 start(host) / stop() / envPromptVars() / tools()，webUi() 可选。
 * 这里不 import `cortico/*`，纯 ESM 就能加载。
 */
import { GUNSMITH_DEFAULTS } from './config.js';
import { GUNSMITH_TOOL_DECLS, GunsmithWorld } from './world.js';

const SUMMARY = {
  gun_suggest: {
    zh: '按图/预算/风格挑配装，返回 id、方案名、枪、售价、作者、标签；自动避开主人嫌弃过的风格。',
    en: 'Suggests builds by map, budget and style, skipping styles the owner disliked.',
  },
  gun_code: {
    zh: '选一套，把改枪码放进剪贴板，回游戏 Ctrl+V 即可。',
    en: 'Picks one build and puts its share code on the clipboard.',
  },
  gun_detail: {
    zh: '这套装了哪些配件：槽位 → 配件名，加合计属性变化。',
    en: 'Attachment list slot by slot, with the stat deltas.',
  },
  gun_save: {
    zh: '把改枪码存进本地库；不给参数时读剪贴板里主人刚复制的那条。',
    en: 'Saves a share code into the local library, from the clipboard by default.',
  },
  gun_list: {
    zh: '翻本地库：存过的所有码，带星级与备注。',
    en: 'Searches the local library of saved codes.',
  },
  gun_rate: {
    zh: '给方案打 1~5 星并可吐槽；1~2 星会让它的风格标签不再被推荐。',
    en: 'Rates a build; one or two stars stop its style tags from being suggested.',
  },
  gun_forget: {
    zh: '从本地库删掉一条。',
    en: 'Removes one entry from the local library.',
  },
  gun_loadout_check: {
    zh: '把售价对标站点战备档（11W/18W/55W/60W/78W）。',
    en: 'Compares the price against the site\'s loadout tiers.',
  },
};

export const GUNSMITH = {
  id: 'gunsmith',
  label: '桌宠改枪台 · Gunsmith Bench',
  defaults: () => ({ ...GUNSMITH_DEFAULTS }),
  create: (ctx) => new GunsmithWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir ?? '',
    log: ctx.log ?? console,
  }),
  /**
   * 自描述：可能出现的全部工具与事件，不进提示词。
   * 纯 JS 包不 import cortico 的 describeTools，所以这里手写 summary。
   */
  describe: {
    tools: GUNSMITH_TOOL_DECLS.map((d) => ({ ...d, summary: SUMMARY[d.name] })),
    // 改枪台不推事件：它只在主人开口时干活，不主动打扰。
    events: [],
  },
};

export default GUNSMITH;
