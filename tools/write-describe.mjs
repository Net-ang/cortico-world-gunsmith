#!/usr/bin/env node
/**
 * 生成 describe.json：工具/事件取自 index.js 的 describe 对象，环境提示词取自 ENV_PROMPT.md。
 * 改了工具或事件之后重跑一次，不要手改 describe.json。
 *
 *   node tools/write-describe.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import GUNSMITH from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const prompt = await readFile(join(root, 'src', 'ENV_PROMPT.md'), 'utf8');

const describe = {
  tools: GUNSMITH.describe.tools.map((t) => ({
    name: t.name,
    description: t.description,
    tags: t.tags ?? [],
    parameters: t.parameters ?? { type: 'object', additionalProperties: false, properties: {} },
    ...(t.summary ? { summary: t.summary } : {}),
  })),
  events: GUNSMITH.describe.events ?? [],
  prompts: [{
    key: 'worlds.gunsmith.envPrompt',
    title: '桌宠改枪台 · 环境提示词',
    role: 'envPrompt',
    content: prompt,
  }],
};

const file = join(root, 'describe.json');
await writeFile(file, `${JSON.stringify(describe, null, 2)}\n`, 'utf8');
console.log(`已写入 ${file}：${describe.tools.length} 个工具、${describe.events.length} 个事件、${describe.prompts.length} 段提示词`);
