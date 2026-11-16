/**
 * 剪贴板读写 —— koffi 调 user32，已实测通（含中文）。
 *
 * 两个实测踩出来的坑，别绕开：
 *   1. `koffi.decode(p,'str16',len)` 会 native crash（静默 exit 1，无堆栈）。
 *      必须按字节读：koffi.decode(p,'uint8_t',size) → Buffer → utf16le。
 *   2. `koffi` 不在扩展自己的解析链上（vendor 目录 require 会 MODULE_NOT_FOUND）。
 *      必须拿 app 的 package.json 作 createRequire 的 base。
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

/** koffi 解析链：任一成功即用。 */
function loadKoffi(koffiPath = '') {
  const tries = [];
  const bases = [];
  if (koffiPath) bases.push(koffiPath.endsWith('.json') ? koffiPath : join(koffiPath, 'package.json'));

  // ① Electron 主进程：app.getAppPath() 最权威（拿不到就跳过）
  try {
    const { createRequire: cr } = { createRequire };
    const electron = cr(import.meta.url)('electron');
    const appPath = electron?.app?.getAppPath?.();
    if (appPath) bases.push(join(appPath, 'package.json'));
  } catch { /* 不在 Electron 里，正常 */ }

  // ② process.resourcesPath：Electron 主进程一定有
  if (process.resourcesPath) bases.push(join(process.resourcesPath, 'app', 'package.json'));

  // ③ 从可执行文件反推：…\Coopanion\Coopanion.exe → …\Coopanion\resources\app\package.json
  //    万一 World 跑在没有 resourcesPath 的上下文里，这条能救回来。
  if (process.execPath) bases.push(join(process.execPath, '..', 'resources', 'app', 'package.json'));

  // ④ 最后按工作目录猜一次
  if (process.cwd()) bases.push(join(process.cwd(), 'resources', 'app', 'package.json'));

  // ⑤ 包自身解析链（万一将来把 koffi 装成本包依赖）
  try { return { koffi: createRequire(import.meta.url)('koffi'), via: 'self' }; } catch (e) { tries.push(`self: ${e.code ?? e.message}`); }

  for (const base of bases) {
    if (!existsSync(base)) { tries.push(`skip ${base}`); continue; }
    try {
      const req = createRequire(pathToFileURL(base));
      return { koffi: req('koffi'), via: base };
    } catch (e) { tries.push(`${base}: ${e.code ?? e.message}`); }
  }
  return { koffi: null, via: null, tries };
}

let cached = null;

/** 拿一份可用的 Win32 剪贴板句柄集合；失败返回 { ok:false, reason }。 */
export function createClipboard({ koffiPath = '', log = console } = {}) {
  if (cached) return cached;
  if (process.platform !== 'win32') {
    cached = { ok: false, reason: `非 Windows（${process.platform}）`, read: null, write: null };
    return cached;
  }
  const { koffi, via, tries } = loadKoffi(koffiPath);
  if (!koffi) {
    cached = { ok: false, reason: `koffi 不可用：${(tries ?? []).join(' | ')}`, read: null, write: null };
    return cached;
  }
  let F;
  try {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    F = {
      OpenClipboard: user32.func('bool __stdcall OpenClipboard(void *hwnd)'),
      CloseClipboard: user32.func('bool __stdcall CloseClipboard()'),
      EmptyClipboard: user32.func('bool __stdcall EmptyClipboard()'),
      GetClipboardData: user32.func('void * __stdcall GetClipboardData(uint32_t fmt)'),
      SetClipboardData: user32.func('void * __stdcall SetClipboardData(uint32_t fmt, void *hMem)'),
      IsClipboardFormatAvailable: user32.func('bool __stdcall IsClipboardFormatAvailable(uint32_t fmt)'),
      GlobalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t bytes)'),
      GlobalLock: kernel32.func('void * __stdcall GlobalLock(void *hMem)'),
      GlobalUnlock: kernel32.func('bool __stdcall GlobalUnlock(void *hMem)'),
      GlobalSize: kernel32.func('size_t __stdcall GlobalSize(void *hMem)'),
      lstrlenW: kernel32.func('int __stdcall lstrlenW(void *s)'),
      RtlMoveMemory: kernel32.func('void __stdcall RtlMoveMemory(void *dst, void *src, size_t n)'),
    };
  } catch (e) {
    cached = { ok: false, reason: `API 注册失败：${e.message}`, read: null, write: null };
    return cached;
  }

  const read = () => {
    if (!F.OpenClipboard(null)) return { ok: false, error: 'OpenClipboard 失败（可能被别的程序占着）' };
    try {
      if (!F.IsClipboardFormatAvailable(CF_UNICODETEXT)) return { ok: true, text: '' };
      const h = F.GetClipboardData(CF_UNICODETEXT);
      if (!h) return { ok: false, error: 'GetClipboardData 返回 NULL' };
      const p = F.GlobalLock(h);
      if (!p) return { ok: false, error: 'GlobalLock 返回 NULL' };
      try {
        const chars = F.lstrlenW(p);
        if (chars <= 0) return { ok: true, text: '' };
        const size = Math.min(Number(F.GlobalSize(h)) || (chars + 1) * 2, (chars + 1) * 2);
        const bytes = koffi.decode(p, 'uint8_t', size);
        const text = Buffer.from(bytes).toString('utf16le').replace(/\0[\s\S]*$/, '');
        return { ok: true, text };
      } finally {
        F.GlobalUnlock(h);
      }
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      F.CloseClipboard();
    }
  };

  const write = (text) => {
    if (!F.OpenClipboard(null)) return { ok: false, error: 'OpenClipboard 失败（可能被别的程序占着）' };
    try {
      F.EmptyClipboard();
      const buf = Buffer.from(`${text}\0`, 'utf16le');
      const hMem = F.GlobalAlloc(GMEM_MOVEABLE, buf.length);
      if (!hMem) return { ok: false, error: 'GlobalAlloc 返回 NULL' };
      const p = F.GlobalLock(hMem);
      if (!p) return { ok: false, error: 'GlobalLock 返回 NULL' };
      F.RtlMoveMemory(p, buf, buf.length);
      F.GlobalUnlock(hMem);
      // 成功后内存归系统所有，不要 GlobalFree
      if (!F.SetClipboardData(CF_UNICODETEXT, hMem)) return { ok: false, error: 'SetClipboardData 返回 NULL' };
      return { ok: true, bytes: buf.length };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      F.CloseClipboard();
    }
  };

  log.info?.(`[gunsmith] 剪贴板通道就绪（koffi via ${via}）`);
  cached = { ok: true, read, write, via };
  return cached;
}

/** 测试用：清掉缓存。 */
export function resetClipboardCache() {
  cached = null;
}
