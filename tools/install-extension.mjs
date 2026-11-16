#!/usr/bin/env node
/**
 * 把「桌宠改枪台」装进本机 Coopanion（或任意 Cortico 部署），或从里面卸掉。
 *
 *   node tools/install-extension.mjs
 *   node tools/install-extension.mjs --extensions <DIR>
 *   node tools/install-extension.mjs --uninstall
 *
 * 默认去找 ../../Coopanion/data/extensions（本工作区的部署位置），也可以用
 * --extensions 或环境变量 CORTICO_EXTENSIONS_DIR 指定。
 *
 * 安装三步，都可逆：
 *   1. 拷本包到 <extensions>/vendor/cortico-world-gunsmith（不含 node_modules、.git）
 *   2. 备份 <extensions>/package.json → package.json.bak-gunsmith，加一条 link: 依赖
 *   3. 建 <extensions>/node_modules/cortico-world-gunsmith → vendor 的 junction
 * 装完要重启 Coopanion，然后在 World 页启用「桌宠改枪台」。
 */
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'cortico-world-gunsmith';
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

/**
 * 找 Coopanion 的 extensions 目录。
 * 不再写死「往上两级」——包被人搬进别的文件夹后那条路就断了。
 * 改为从包所在目录逐级往上找，最多 6 层，任一命中即可。
 */
function findExtensions() {
  const looksRight = (dir) => existsSync(join(dir, 'node_modules')) && existsSync(join(dir, 'package.json'));
  const tried = [];
  let dir = here;
  for (let up = 0; up < 6; up++) {
    for (const rel of [join('Coopanion', 'data', 'extensions'), join('data', 'extensions')]) {
      const candidate = resolve(dir, rel);
      tried.push(candidate);
      if (looksRight(candidate)) return { dir: candidate, tried };
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return { dir: null, tried };
}

const explicit = opt('extensions', process.env.CORTICO_EXTENSIONS_DIR || '');
let extensions;
if (explicit) {
  extensions = resolve(explicit);
  if (!existsSync(join(extensions, 'node_modules'))) {
    console.error(`这不是 Cortico 的 extensions 目录（缺 node_modules）：${extensions}`);
    console.error('用 --extensions <DIR> 指定，例如 E:\\DSH-PET\\Coopanion\\data\\extensions');
    process.exit(2);
  }
} else {
  const found = findExtensions();
  if (!found.dir) {
    console.error('没自动找到 Cortico 的 extensions 目录。找过这些位置：');
    for (const t of found.tried.slice(0, 8)) console.error(`  ✗ ${t}`);
    console.error('\n用 --extensions <DIR> 指定，例如：');
    console.error('  node tools/install-extension.mjs --extensions "E:\\DSH-PET\\Coopanion\\data\\extensions"');
    process.exit(2);
  }
  extensions = found.dir;
  console.log(`自动定位到 extensions 目录：${extensions}`);
}

const say = (s) => console.log(s);
const vendor = join(extensions, 'vendor', NAME);
const link = join(extensions, 'node_modules', NAME);
const pkgFile = join(extensions, 'package.json');
const backup = `${pkgFile}.bak-gunsmith`;

const readPkg = () => JSON.parse(readFileSync(pkgFile, 'utf8').replace(/^\uFEFF/, ''));
const writePkg = (pkg) => writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

if (argv.includes('--uninstall')) {
  const pkg = readPkg();
  if (pkg.dependencies?.[NAME]) {
    delete pkg.dependencies[NAME];
    writePkg(pkg);
    say(`1/3 已从 dependencies 移除 ${NAME}`);
  } else {
    say('1/3 dependencies 里没有这条依赖');
  }
  if (existsSync(link)) { rmSync(link, { recursive: true, force: true }); say('2/3 已删联接'); }
  else say('2/3 联接不存在');
  if (existsSync(vendor)) { rmSync(vendor, { recursive: true, force: true }); say('3/3 已删 vendor 副本'); }
  else say('3/3 vendor 副本不存在');
  say('\n卸载完成。重启 Coopanion 生效；本地码库 gunsmith-codes.json 留在部署数据目录里，要清就自己删。');
  process.exit(0);
}

/* 1. 拷包 */
mkdirSync(join(extensions, 'vendor'), { recursive: true });
if (existsSync(vendor)) rmSync(vendor, { recursive: true, force: true });
cpSync(here, vendor, {
  recursive: true,
  filter: (src) => !src.includes('node_modules') && !src.includes('.git') && !src.includes('.tmp-check'),
});
say(`1/3 已拷贝 → ${vendor}`);

/* 2. 登记依赖 */
const raw = readFileSync(pkgFile, 'utf8');
if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8');
const pkg = readPkg();
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies[NAME] = `link:vendor/${NAME}`;
writePkg(pkg);
say(`2/3 已登记依赖 link:vendor/${NAME}（备份 ${backup}）`);

/* 3. junction */
if (existsSync(link)) {
  say(`3/3 联接已存在：${link}`);
} else {
  symlinkSync(vendor, link, 'junction');
  say(`3/3 已建联接 → ${link}`);
}

say('\n安装完成。接下来：');
say('  1. 重启 Coopanion');
say('  2. World 页启用「桌宠改枪台」，信任窗口里确认');
say('  3. 跟它说「找个潮汐监狱 8W 以内压得住后坐力的步枪」试试');
say(`  全部可逆：node tools/install-extension.mjs --uninstall`);
