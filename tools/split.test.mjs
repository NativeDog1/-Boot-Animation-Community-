/**
 * split.test.mjs — 分片方案与清单格式的测试。
 *
 * 清单是**浏览器和机器人之间的契约**：这边生成、那边解析。所以除了自洽性，
 * 还拿 tools/fixtures/parts-manifest.txt 这份固定样本对照 —— 格式一改，
 * 这个测试立刻红，Python 那份也会跟着红（两边盯着同一个文件）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planParts, partFileName, manifestOf, parseManifest, partsHint,
  DEFAULT_PART_BYTES, ATTACH_LIMIT, PART_PREFIX,
} from '../docs/assets/js/lib/split.js';

const FIXTURE = readFileSync(new URL('./fixtures/parts-manifest.txt', import.meta.url), 'utf8').trim();
const FIXTURE_META = {
  name: 'cyber-neon-4k.mp4',
  bytes: 209715200,
  parts: 10,
  partBytes: 20971520,
  sha256: '9f2c1b7e4d8a6f3051c9e2b7a4d6f8013c5e9b2d7a4f6c8103e5b9d2f7a4c6e8',
};

test('分片大小必须明显小于 GitHub 附件上限', () => {
  assert.equal(DEFAULT_PART_BYTES < ATTACH_LIMIT, true);
  const parts = planParts(300 * 1024 * 1024);
  for (const p of parts) assert.equal(p.bytes <= ATTACH_LIMIT, true, `${p.name} 超过附件上限`);
});

test('planParts：边界完全覆盖、不重不漏', () => {
  const size = 100 * 1024 * 1024 + 12345;
  const parts = planParts(size);
  assert.equal(parts[0].start, 0);
  assert.equal(parts[parts.length - 1].end, size);
  let sum = 0;
  for (let i = 0; i < parts.length; i += 1) {
    sum += parts[i].bytes;
    if (i > 0) assert.equal(parts[i].start, parts[i - 1].end, '分片之间有缝或重叠');
  }
  assert.equal(sum, size);
  assert.equal(parts.length, Math.ceil(size / DEFAULT_PART_BYTES));
});

test('planParts：小文件也切一片；非法输入返回空', () => {
  const one = planParts(1024);
  assert.equal(one.length, 1);
  assert.equal(one[0].bytes, 1024);
  assert.deepEqual(planParts(0), []);
  assert.deepEqual(planParts(NaN), []);
  assert.deepEqual(planParts(-5), []);
});

test('分片文件名：零填充，字母序 == 数字序', () => {
  const parts = planParts(200 * 1024 * 1024, DEFAULT_PART_BYTES, 'My Intro 4K.mp4');
  const names = parts.map((p) => p.name);
  assert.equal(names[0], 'My Intro 4K.part01of10.mp4');
  assert.equal(names[9], 'My Intro 4K.part10of10.mp4');
  assert.deepEqual([...names].sort(), names, '按字母排序后顺序必须不变');
  assert.deepEqual([...names].sort(), names, '（这条挂了就说明零填充位数不对）');
});

test('文件名：没有扩展名时补 .mp4；带点号的名字不被截错', () => {
  assert.equal(partFileName('clip', 1, 3), 'clip.part1of3.mp4');
  assert.equal(partFileName('my.clip.final.MOV', 2, 12), 'my.clip.final.part02of12.MOV');
});

test('清单：与固定样本逐字节一致（跨语言契约）', () => {
  assert.equal(manifestOf(FIXTURE_META), FIXTURE);
});

test('清单：往返解析', () => {
  const meta = parseManifest(FIXTURE);
  assert.deepEqual(meta, FIXTURE_META);
  assert.equal(manifestOf(meta), FIXTURE);
});

test('清单：坏输入一律返回 null，不猜', () => {
  const bad = [
    '', null, undefined, 'hello',
    'ba-parts:v2;name=a;bytes=1;parts=1;partbytes=1;sha256=' + 'a'.repeat(64),
    'ba-parts:v1;name=a;bytes=0;parts=1;partbytes=1;sha256=' + 'a'.repeat(64),
    'ba-parts:v1;name=a;bytes=1;parts=0;partbytes=1;sha256=' + 'a'.repeat(64),
    'ba-parts:v1;name=a;bytes=1;parts=1;partbytes=1;sha256=abc',
    'ba-parts:v1;name=a;bytes=1;parts=1;partbytes=1',
  ];
  for (const text of bad) assert.equal(parseManifest(text), null, `不该通过: ${text}`);
});

test('清单：容忍换行与空格，名字里的分号被替换掉', () => {
  const withSpace = FIXTURE.replace(/;/g, ' ; ').replace(PART_PREFIX, '  ' + PART_PREFIX + '  ');
  const parsed = parseManifest(withSpace);
  assert.equal(parsed.sha256, FIXTURE_META.sha256);
  const dirty = manifestOf({ ...FIXTURE_META, name: 'a;b\nc.mp4' });
  assert.equal(parseManifest(dirty).name, 'a_b_c.mp4');
  assert.equal(dirty.includes('\n'), false);
});

test('partsHint：会告诉用户有几个分片、总共多大', () => {
  const hint = partsHint(planParts(60 * 1024 * 1024), 60 * 1024 * 1024);
  assert.equal(hint.includes('3 个分片'), true);
  assert.equal(hint.includes('60.0 MB'), true);
});
