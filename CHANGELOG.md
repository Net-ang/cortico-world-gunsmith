# CHANGELOG

## 0.1.0 — 2026-11-05

首个版本。一个 Cortico/Coopanion World 扩展（`world api 6`），给桌宠加一个「改枪台」。

### 新增

- **8 个工具**：`gun_suggest`、`gun_code`、`gun_detail`、`gun_save`、`gun_list`、`gun_rate`、`gun_forget`、`gun_loadout_check`
- **公开页取数**：读 `shushu.fan/guns` 的 Next.js flight 载荷取结构化 JSON（20 条方案，自带 `solutionCode` 改枪码）；`/guns/official/<id>` 取槽位→配件名；`/kzb` 取战备门槛与卡战备套装
- **全库目录**：`tools/sync-catalog.mjs` 从 sitemap 的 1392 个明细页抓全部方案（码 + 名称 + 配件 + 属性），礼貌限速、可续跑；**并随包自带一份快照**（`data/gunsmith-catalog.json`），装完即全库。解析顺序：配置指定 > 本机同步 > 随包快照
- **战备门槛按「总战备」算**：图 × 难度 → 门槛（大坝/长弓 机密 11W、航天/巴克什 机密 18W、巴克什 绝密 55W、航天基地 绝密 60W、潮汐监狱 绝密 78W、普通无门槛）；**头甲胸挂背包也算战备**，按 `/kzb` 同档位套装估（绝密取最贵那套 × 假账倍率），因此枪价要求低于门槛
- **价格优先级**：主人给了枪价就按主人的价筛；没给才用「枪价 ≥ 门槛 − 头甲」；门槛表里没有的图/难度如实说没有
- **剪贴板通道**：koffi 调 `user32` 读写，含中文；四级 koffi 解析链 + `koffiPath` 手动指路；失败则降级为气泡显示码
- **本地库与口味学习**：`gunsmith-codes.json` 按码去重；`gunsmith-taste.json` 记录星级、吐槽、`avoidTags`；1~2 星自动避开对应风格标签
- **按码反查元数据**：从剪贴板收来的码会回站点列表匹配，补上标签/地图/价格
- **离线降级**：`readPublicPages: false` 纯本地库；磁盘缓存让断网时照常可用
- **自检**：`tools/selfcheck.mjs`，离线 106 项 + 3 项联网

### 边界（有意为之）

- 不检测游戏、不读窗口/画面/内存/音频、不模拟键鼠——与游戏进程零接触
- 不碰站点 `/api/`（robots `Disallow`），不翻页，不后台轮询
- 「帮」到剪贴板为止，`Ctrl+V` 由用户自己按
- 随包快照只含公开页数据，来源与归属见 `data/NOTICE.md`

### 修掉的坑

- `koffi.decode(p,'str16',len)` 会 native crash（静默 exit 1）→ 改为按字节读后拼 UTF-16LE
- `koffi` 不在扩展自身解析链上（`MODULE_NOT_FOUND`）→ 用 app 的 `package.json` 作 `createRequire` base
- 改枪码的三种真实形态都踩过：枪名自带横杠（`AK-12…`）、枪名只有 3 字（`复合弓…`）、中间段带 ASCII（`六式zy`）或**完全不带横杠**（`6L79CCC0…`）→ 校验与解析全部放宽，并优先读结构化 `"code"` 字段
- 列表页 `?page=2`/`tab`/`keyword` 等 15 种参数组合都回同一份 20 条 → 全库改走 sitemap + 明细页
