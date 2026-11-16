# 桌宠改枪台 · cortico-world-gunsmith

<p align="center">
  <img src="docs/preview.png" alt="鲸鱼娘端着改满的金色狙击枪" width="320">
</p>

Coopanion / Cortico 的 World 扩展（`world api 6`）。给桌宠加一件事：

> **你说要什么枪、什么图、什么预算，它把方案和改枪码摆到你面前，把码放进剪贴板；Ctrl+V 是你自己按的。**

它不检测游戏、不读窗口、不读画面、不读内存、不模拟键鼠——**跟游戏进程零接触**。

> **隐私说明（先说清楚）**：它会读你的**剪贴板**，但**只在你让它「收一下」改枪码时读那一次**，内容不匹配改枪码格式就当场拒绝、不入库、不上传。跑久了也不会自己去看。它还会访问 `shushu.fan` 的公开网页取配装数据；关掉 `readPublicPages` 就完全离线。因为读剪贴板，扩展市场可能会给这个包打上「读取隐私」警示标签——这是如实标注，不是下架。

---

## 给别人装（拿到 zip / tgz 的人看这里）

**要求**：Windows + Coopanion（`world api 6`，在 0.2.20 上验过）+ Node ≥ 22。

1. 解压，进入 `cortico-world-gunsmith/` 目录
2. 指到对方的 extensions 目录装：

```powershell
node tools/install-extension.mjs --extensions "C:\Users\<你>\AppData\Local\Programs\Coopanion\data\extensions"
# 找不到就搜：Get-ChildItem C:\ -Filter Coopanion.exe -Recurse -ErrorAction SilentlyContinue
```

3. 重启 Coopanion → World 页启用「桌宠改枪台」→ 信任确认
4. 先跑一遍自检确认没坏：`node tools/selfcheck.mjs`

装完启动日志里应有 `core: World 已启动: gunsmith`。卸掉：`node tools/install-extension.mjs --uninstall --extensions <同一目录>`。

> 装脚本只做三件事：拷到 `vendor/`、在 `extensions/package.json` 里加一条 `link:`、建 `node_modules` junction。全部可逆，会先备份 `package.json.bak-gunsmith`。

---

## 装

```powershell
node tools/install-extension.mjs
# 装到别处：--extensions "D:\path\to\Coopanion\data\extensions"
# 卸掉：    --uninstall
```

重启 Coopanion → World 页启用「桌宠改枪台」→ 信任确认。

## 用

| 你说 | 它做 |
|---|---|
| 潮汐监狱，8W 以内，压得住后坐力的步枪 | `gun_suggest` 列三条：方案名 · 枪 · 售价 · 作者 · 标签 + id |
| 潮汐监狱 绝密 有什么能进 | 按**战备门槛**筛：只推枪价 ≥ 78W 的，从低到高排 |
| 潮汐监狱 绝密，但我只有 30W | **按你的 30W 筛**，同时提醒够不到 78W 门槛 |
| 大坝 机密 | 门槛 11W，枪价 ≥ 11W 的都能进 |
| ① / 就那个轮椅的 | `gun_code` 把码放进剪贴板，回你「回游戏 Ctrl+V」 |
| 这套装了什么 | `gun_detail` 按槽位念配件 + 合计属性变化 |
| 收一下 | `gun_save` 读一次剪贴板，验证像码才入库 |
| 上次那个 AK 的码呢 | `gun_list` 搜本地库 |
| 这个太抖了 | `gun_rate` 打 1~2 星，「后坐力稳」之后不再推给你 |
| 这套会不会超战备 | `gun_loadout_check` 对标门槛，说清够得着哪些图、差多少 |

### 战备门槛（它记着这张表）

**门槛算的是「总战备」——头甲、胸挂、背包都占。** 所以枪不必自己顶满门槛：

| 图 | 机密 | 绝密 | 头甲参考 | 机密枪价需 | 绝密枪价需 |
|---|---|---|---|---|---|
| 零号大坝 / 长弓溪谷 | 11W | — | ≈1.8W | ≥9.2W | — |
| 航天基地 / 巴克什 | 18W | 60W / 55W | ≈4.5W / 11W | ≥13.5W | ≈44~46W |
| 潮汐监狱 | — | 78W | ≈15.5W | — | **≥62.5W** |

「头甲参考」是从站上**同档位卡战备套装**里算的中位成本（那边每套都列齐头盔/护甲/胸挂/背包的单价）；「普通」难度站上不列，按无门槛处理。每次启动取一次、缓存 60 分钟，并写进系统提示词——所以它记得住。地图简称自动归一（大坝→零号大坝、长弓→长弓溪谷、航天→航天基地）。

**推荐优先级**：你给了枪价就按你的价 → 没给才用门槛（枪价 + 头甲参考 ≥ 门槛）→ 门槛表里没有的图/难度，它会直说没有，不编数字。

## 数据从哪来

三层拼起来，各有边界：

| 层 | 规模 | 内容 | 边界 |
|---|---|---|---|
| `shushu.fan/guns` 公开页 | 20 条（服务端只渲染第一页，换 `?page=`/`tab`/关键词都回同一份，翻页走 `/api/`） | 方案 + **改枪码** + 价格 + 标签 + 地图 + 属性 | robots `Allow: /`，只读 |
| `shushu.fan/guns/official/<id>` | **1392 个明细页**（sitemap 全列出来了） | **改枪码** + 槽位配件 + 属性变化 | 同上 |
| `shushu.fan/kzb` | — | 战备档位 | 同上 |
| 你的剪贴板 | — | 你自己复制的码 | 只在你说「收一下」时读一次 |
| 本地库 | — | 收过的码、星级、吐槽 | `gunsmith-codes.json` / `gunsmith-taste.json` |

### 全库：随包自带快照，开箱即用

**包里带了一份目录快照**（`data/gunsmith-catalog.json`，约 1400 条），所以别人下载装上就有全库，不用先同步。解析顺序：

```
配置 worlds.gunsmith.catalogFile  →  本机同步的目录  →  随包快照
```

本机同步过的**优先于**随包快照，不会互相覆盖。快照会过时（`syncedAt` 有日期），想要最新就自己跑一次同步：

```powershell
# 约 30 分钟，1392 个页面，每个间隔 1.2s + 抖动，不并发；中断可续跑
node tools/sync-catalog.mjs --out "<数据目录>\gunsmith-catalog.json"

# 试跑 30 个看看
node tools/sync-catalog.mjs --out ... --limit 30
```

列表页那条路只能拿 20 条（`?page=2`/`tab`/`keyword` 等 15 种参数组合都回同一份，翻页走 `/api/`，robots 禁止）。全库改走 **sitemap 里的 1392 个明细页**，每页都有明文改枪码，robots 同样 `Allow: /`。

细节：明细页**没有**价格/地图/作者标签，所以全库条目的价格和风格是**从方案名推断**的（「20W性价比腾龙」→ 20W + 高性价比）；按地图筛选时只有那 20 条和本地库才有真地图信息。名字里没写价格的条目，按门槛筛选时会被排除——宁可少推，不拿猜的价格骗你。

快照的来源与归属见 `data/NOTICE.md`（数据来自 shushu.fan 公开页，版权归站点与分享方案的玩家）。删掉那个文件即可退回「20 条 + 本地库」模式。

**不碰 `/api/`**（站方 robots 明确 `Disallow`）。列表缓存 60 分钟，只在你开口时取，不后台轮询；缓存里的老数据在断网时照常可用。

## 配置（`worlds.gunsmith.*`）

`siteBase` `readPublicPages` `cacheMinutes` `defaultScene` `defaultBudget` `preferStyles` `clipboardRead` `clipboardWrite` `codePattern` `timeoutMs` `koffiPath`

`readPublicPages: false` = 纯本地库、完全离线。`koffiPath` 只在剪贴板通道自动探测失败时填。

## 自检

```powershell
node tools/selfcheck.mjs          # 111 项离线：契约 / 解析 / 本地库 / 口味 / 工具端到端 / 随包快照
node tools/selfcheck.mjs --net    # 另抓一次真实公开页，验证站点没改版
node tools/write-describe.mjs     # 改过工具或事件后重生成 describe.json
```

## 两个技术坑（别重犯）

1. **剪贴板不能按 `str16` 解码**——`koffi.decode(p,'str16',len)` 会 native crash（静默 exit 1，无堆栈）。要按字节读：`Buffer.from(koffi.decode(p,'uint8_t',size)).toString('utf16le')`。
2. **`koffi` 不在本包解析链上**——从 `vendor/cortico-world-gunsmith` 出发 `require('koffi')` 是 `MODULE_NOT_FOUND`。得拿 Coopanion 的 `resources/app/package.json` 作 `createRequire` 的 base；`clipboard.js` 里有四级探测链。

另有一个容易忘的：改枪码的第一段可能自己带横杠（`AK-12突击步枪-烽火地带-…`），校验正则不能按「三段」卡死。

## 明确不做

- 不模拟键鼠、不往游戏客户端粘贴或点选——**「帮」到剪贴板为止**
- 不读游戏画面 / 内存 / 音频
- 不碰站点 `/api/`，不翻页，不并发拉站
