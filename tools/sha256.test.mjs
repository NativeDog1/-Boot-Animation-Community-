/**
 * sha256.test.mjs — 自己写的增量 SHA-256 必须和 Node 的 crypto **逐字节一致**。
 *
 * 这是整条"浏览器切分"方案的地基：如果哈希算错，机器人拼回文件后校验就会失败，
 * 用户会看到一个莫名其妙的错误。所以这里既测标准向量，也测**跨块边界**的分片
 * （一次喂 1 字节、喂 63/64/65 字节、随机大小），因为那是最容易写错的地方。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { createSha256, sha256OfBlob } from '../docs/assets/js/lib/sha256.js';

const nodeHash = (buf) => createHash('sha256').update(buf).digest('hex');

test('标准向量：空串、abc、以及 FIPS 的长例子', () => {
  const cases = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  for (const [text, expect] of cases) {
    const h = createSha256();
    h.update(new TextEncoder().encode(text));
    assert.equal(h.hex(), expect);
  }
});

test('一次喂 vs 分片喂，结果必须一样（含跨块边界）', () => {
  const data = randomBytes(300);                       // 300 字节 = 4 块多
  const whole = createSha256();
  whole.update(data);
  assert.equal(whole.hex(), nodeHash(data));

  // 各种分片大小，特别是 63/64/65 这些刚好卡在块边界上的
  for (const size of [1, 7, 31, 63, 64, 65, 100, 128, 299]) {
    const h = createSha256();
    for (let i = 0; i < data.length; i += size) h.update(data.subarray(i, i + size));
    assert.equal(h.hex(), nodeHash(data), `分片大小 ${size} 时结果不一致`);
  }
});

test('随机长度的随机数据，多次对照', () => {
  for (let round = 0; round < 12; round += 1) {
    const len = Math.floor(Math.random() * 5000);
    const data = randomBytes(len);
    const h = createSha256();
    // 随机分片
    let i = 0;
    while (i < data.length) {
      const step = 1 + Math.floor(Math.random() * 200);
      h.update(data.subarray(i, i + step));
      i += step;
    }
    assert.equal(h.hex(), nodeHash(data), `长度 ${len} 时结果不一致`);
  }
});

test('长度编码：跨过 64 字节填充边界（55/56/57 与 63/64/65）', () => {
  for (const len of [55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
    const data = randomBytes(len);
    const h = createSha256();
    h.update(data);
    assert.equal(h.hex(), nodeHash(data), `长度 ${len} 时结果不一致`);
  }
});

test('sha256OfBlob：按 4 MB 分片算大文件，且进度回调合理', async () => {
  const size = 9 * 1024 * 1024 + 12345;                 // 跨多个分片，尾巴不是整块
  const data = randomBytes(size);
  const blob = new Blob([data]);
  const seen = [];
  const got = await sha256OfBlob(blob, { onProgress: (done, total) => seen.push([done, total]) });
  assert.equal(got, nodeHash(data));
  assert.equal(seen.length, Math.ceil(size / (4 * 1024 * 1024)));
  assert.deepEqual(seen[seen.length - 1], [size, size]);
});

test('收尾后不能再 update（避免静默算错）', () => {
  const h = createSha256();
  h.update(new TextEncoder().encode('abc'));
  h.hex();
  assert.throws(() => h.update(new Uint8Array([1])), /收尾/);
});
