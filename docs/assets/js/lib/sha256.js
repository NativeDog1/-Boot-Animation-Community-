/**
 * sha256.js — 增量 SHA-256（纯 JS，零依赖）。
 *
 * 为什么不用 WebCrypto 的 `crypto.subtle.digest()`：它只接受一个完整 buffer，
 * 也就是要把**整个文件读进内存**。社区里 4K 片头动辄几十上百 MB，几百 MB 的文件
 * 会让标签页卡死甚至崩掉。这里按 4 MB 分片喂进来，内存恒定，多大的文件都能算。
 *
 * 只实现哈希，不做别的：`update(bytes)` 可以喂任意多次，`hex()` 收尾。
 * 正确性由 tools/sha256.test.mjs 对着 Node 的 crypto 逐步对照（含跨块边界的分片）。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

function toHex32(value) {
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function createSha256() {
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;

  const block = new Uint8Array(64);
  let blockLen = 0;
  let totalLen = 0;
  let done = false;
  const w = new Uint32Array(64);

  function processBlock(bytes, offset) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      w[i] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return {
    /** 喂一段数据（可以反复调用）。 */
    update(bytes) {
      if (done) throw new Error('sha256: 已经 hex() 收尾了');
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      totalLen += data.length;
      let offset = 0;

      // 先把上次剩下的补满一块
      if (blockLen > 0) {
        const need = 64 - blockLen;
        const take = Math.min(need, data.length);
        block.set(data.subarray(0, take), blockLen);
        blockLen += take;
        offset = take;
        if (blockLen === 64) {
          processBlock(block, 0);
          blockLen = 0;
        }
      }

      // 整块直接过
      while (offset + 64 <= data.length) {
        processBlock(data, offset);
        offset += 64;
      }

      // 尾巴留着
      if (offset < data.length) {
        block.set(data.subarray(offset), 0);
        blockLen = data.length - offset;
      }
      return this;
    },

    /** 收尾并返回 64 位小写十六进制。只能调用一次。 */
    hex() {
      if (!done) {
        done = true;
        const bits = totalLen * 8;                 // 到 2^53 都精确，够用到 PB 级
        const high = Math.floor(bits / 4294967296);
        const low = bits >>> 0;

        block[blockLen] = 0x80;
        blockLen += 1;
        if (blockLen > 56) {
          while (blockLen < 64) { block[blockLen] = 0; blockLen += 1; }
          processBlock(block, 0);
          blockLen = 0;
        }
        while (blockLen < 56) { block[blockLen] = 0; blockLen += 1; }
        block[56] = (high >>> 24) & 0xff;
        block[57] = (high >>> 16) & 0xff;
        block[58] = (high >>> 8) & 0xff;
        block[59] = high & 0xff;
        block[60] = (low >>> 24) & 0xff;
        block[61] = (low >>> 16) & 0xff;
        block[62] = (low >>> 8) & 0xff;
        block[63] = low & 0xff;
        processBlock(block, 0);
      }
      return toHex32(h0) + toHex32(h1) + toHex32(h2) + toHex32(h3)
        + toHex32(h4) + toHex32(h5) + toHex32(h6) + toHex32(h7);
    },
  };
}

/**
 * 算一个 Blob/File 的 sha256 —— **内存恒定**（每次只读 chunkSize 字节）。
 * @param {Blob} blob
 * @param {{chunkSize?: number, onProgress?: (done: number, total: number) => void}} [opts]
 */
export async function sha256OfBlob(blob, opts = {}) {
  const chunkSize = opts.chunkSize || 4 * 1024 * 1024;
  const h = createSha256();
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, blob.size);
    const buf = await blob.slice(offset, end).arrayBuffer();
    h.update(new Uint8Array(buf));
    if (opts.onProgress) opts.onProgress(end, blob.size);
  }
  return h.hex();
}
