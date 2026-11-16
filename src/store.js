/**
 * 本地库 + 口味：两个 JSON 文件，落在部署数据目录（与 weather-state.json 同级）。
 *
 *   gunsmith-codes.json  { version, entries: [record…] }
 *   gunsmith-taste.json  { version, preferStyles[], avoidTags[], rated{}, updatedAt }
 *
 * 只做文件读写与查询，不碰网络、不碰窗口。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const CODES_FILE = 'gunsmith-codes.json';
export const TASTE_FILE = 'gunsmith-taste.json';

export async function loadJson(file, fallback) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return fallback;
  }
}

export async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** 码归一化：去空白、统一大小写（码后半段是大写字母数字）。 */
export function normalizeCode(code) {
  return String(code ?? '').replace(/\s+/g, '').trim();
}

export function sameCode(a, b) {
  return normalizeCode(a).toLowerCase() === normalizeCode(b).toLowerCase();
}

export class GunStore {
  constructor({ dataDir = '', log = console } = {}) {
    this.dataDir = dataDir;
    this.log = log;
    this.codes = { version: 1, entries: [] };
    this.taste = { version: 1, preferStyles: [], avoidTags: [], rated: {}, updatedAt: '' };
  }

  get ready() {
    return Boolean(this.dataDir);
  }

  pathOf(name) {
    return this.ready ? join(this.dataDir, name) : '';
  }

  async load() {
    if (!this.ready) return this;
    try {
      const codes = await loadJson(this.pathOf(CODES_FILE), { version: 1, entries: [] });
      this.codes = { version: 1, entries: Array.isArray(codes.entries) ? codes.entries.filter((e) => e?.code) : [] };
      const taste = await loadJson(this.pathOf(TASTE_FILE), {});
      this.taste = {
        version: 1,
        preferStyles: toStringArray(taste.preferStyles),
        avoidTags: toStringArray(taste.avoidTags),
        rated: taste.rated && typeof taste.rated === 'object' ? taste.rated : {},
        updatedAt: String(taste.updatedAt ?? ''),
      };
    } catch (err) {
      this.log.warn?.(`[gunsmith] 读本地库失败: ${err.message}`);
    }
    return this;
  }

  async saveCodes() {
    if (!this.ready) return false;
    try { await saveJson(this.pathOf(CODES_FILE), this.codes); return true; }
    catch (err) { this.log.warn?.(`[gunsmith] 写码库失败: ${err.message}`); return false; }
  }

  async saveTaste() {
    if (!this.ready) return false;
    this.taste.updatedAt = new Date().toISOString();
    try { await saveJson(this.pathOf(TASTE_FILE), this.taste); return true; }
    catch (err) { this.log.warn?.(`[gunsmith] 写口味失败: ${err.message}`); return false; }
  }

  entries() {
    return this.codes.entries;
  }

  find(id) {
    const key = String(id ?? '').trim();
    if (!key) return null;
    return this.codes.entries.find((e) => String(e.id) === key || e.code === key) ?? null;
  }

  /** 按码去重；同码则更新非空字段。 */
  async upsert(record) {
    const incoming = { ...record, code: normalizeCode(record?.code) };
    if (!incoming.code) return { ok: false, reason: '没有码' };
    const at = this.codes.entries.findIndex((e) => sameCode(e.code, incoming.code));
    if (at >= 0) {
      const old = this.codes.entries[at];
      const merged = { ...old };
      for (const [k, v] of Object.entries(incoming)) {
        if (v === '' || v === null || v === undefined) continue;
        if (Array.isArray(v) && !v.length) continue;
        merged[k] = v;
      }
      merged.addedAt = old.addedAt ?? new Date().toISOString();
      this.codes.entries[at] = merged;
      await this.saveCodes();
      return { ok: true, updated: true, entry: merged };
    }
    const entry = {
      ...incoming,
      id: String(incoming.id ?? incoming.code),
      addedAt: new Date().toISOString(),
      usedAt: '',
    };
    this.codes.entries.unshift(entry);
    await this.saveCodes();
    return { ok: true, updated: false, entry };
  }

  async remove(id) {
    const at = this.codes.entries.findIndex((e) => String(e.id) === String(id) || sameCode(e.code, id));
    if (at < 0) return null;
    const [gone] = this.codes.entries.splice(at, 1);
    await this.saveCodes();
    return gone;
  }

  async markUsed(id) {
    const e = this.find(id);
    if (!e) return null;
    e.usedAt = new Date().toISOString();
    await this.saveCodes();
    return e;
  }

  /** 打星 + 口味学习：低分且带吐槽 → 该方案的标签进 avoidTags。 */
  async rate(id, stars, note = '') {
    const entry = this.find(id);
    if (!entry) return null;
    const n = Math.max(1, Math.min(5, Math.round(Number(stars) || 3)));
    this.taste.rated[String(entry.id)] = { stars: n, note: String(note ?? '').slice(0, 120), at: new Date().toISOString() };
    let learned = [];
    if (n <= 2) {
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      // 只从「有区分度」的标签里学：新武器/赛事同款这种不算口味
      const IGNORE = new Set(['新武器', '赛事同款', '金枪客']);
      learned = tags.filter((t) => !IGNORE.has(t) && !this.taste.avoidTags.includes(t));
      this.taste.avoidTags.push(...learned);
    }
    if (n >= 4) {
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      for (const t of tags) {
        if (!this.taste.preferStyles.includes(t) && this.taste.avoidTags.includes(t)) {
          this.taste.avoidTags = this.taste.avoidTags.filter((x) => x !== t);
        }
      }
    }
    await this.saveTaste();
    return { entry, stars: n, learned };
  }

  avoidTags() {
    return this.taste.avoidTags.slice();
  }

  preferStyles() {
    return this.taste.preferStyles.slice();
  }
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，、\s]+/).map((v) => v.trim()).filter(Boolean);
  return [];
}
