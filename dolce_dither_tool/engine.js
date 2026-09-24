/* dolce_dither_tool engine - JavaScript port of glitch_dither4.py.
   Pure functions on typed arrays; no DOM access. */
const Engine = (() => {
  "use strict";

  // ---------------------------------------------------------------- random
  function makeRng(seed) {
    let a = (seed ^ 0x9e3779b9) >>> 0, b = 0x243f6a88, c = 0xb7e15162, d = Math.imul(seed | 0, 0x85ebca6b) >>> 0;
    function next() {                       // sfc32
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (let i = 0; i < 20; i++) next();
    let spare = null;
    return {
      random: next,
      uniform: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo)),
      approxNormal: () => (next() + next() + next() + next() - 2) * 1.7320508,
      normal() {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let u = next(); while (u < 1e-12) u = next();
        const v = next(), m = Math.sqrt(-2 * Math.log(u));
        spare = m * Math.sin(2 * Math.PI * v);
        return m * Math.cos(2 * Math.PI * v);
      },
    };
  }

  // ---------------------------------------------------------------- helpers
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lum = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;

  function hexToRgb(hex) {
    let s = String(hex).trim().replace(/^#/, "");
    if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    return "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  }

  function normalCdf(x) {             // Abramowitz-Stegun erf approximation
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + (x >= 0 ? y : -y));
  }

  function normalize(arr) {
    let mean = 0;
    for (let i = 0; i < arr.length; i++) mean += arr[i];
    mean /= arr.length;
    let v = 0;
    for (let i = 0; i < arr.length; i++) { const d = arr[i] - mean; v += d * d; }
    const sd = Math.sqrt(v / arr.length) + 1e-8;
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - mean) / sd;
    return arr;
  }

  // ------------------------------------------------ fractal value noise
  function cubicTable(nIn, nOut) {
    const idx = new Int32Array(nOut * 4), wt = new Float32Array(nOut * 4), A = -0.5;
    const k = (x) => { x = Math.abs(x); return x <= 1 ? ((A + 2) * x - (A + 3)) * x * x + 1 : x < 2 ? (((x - 5) * x + 8) * x - 4) * A : 0; };
    const sc = nIn / nOut;
    for (let o = 0; o < nOut; o++) {
      const x = (o + 0.5) * sc - 0.5, i0 = Math.floor(x), t = x - i0;
      const ws = [k(1 + t), k(t), k(1 - t), k(2 - t)];
      for (let j = 0; j < 4; j++) { idx[o * 4 + j] = clamp(i0 - 1 + j, 0, nIn - 1); wt[o * 4 + j] = ws[j]; }
    }
    return { idx, wt };
  }

  // mean 0 / std 1; refLong keeps the noise scale tied to the whole image
  function fbm(h, w, rng, base, octaves, pers, refLong) {
    const total = new Float32Array(h * w), long = refLong || Math.max(h, w);
    let amp = 1;
    for (let o = 0; o < octaves; o++) {
      const cells = base * (1 << o);
      const gh = Math.max(2, Math.round(cells * h / long) + 1), gw = Math.max(2, Math.round(cells * w / long) + 1);
      const grid = new Float32Array(gh * gw);
      for (let i = 0; i < grid.length; i++) grid[i] = rng.random();
      const tx = cubicTable(gw, w), ty = cubicTable(gh, h), rows = new Float32Array(gh * w);
      for (let gy = 0; gy < gh; gy++) {
        const gr = gy * gw, rr = gy * w;
        for (let x = 0; x < w; x++) {
          const q = x * 4;
          rows[rr + x] = grid[gr + tx.idx[q]] * tx.wt[q] + grid[gr + tx.idx[q + 1]] * tx.wt[q + 1]
                       + grid[gr + tx.idx[q + 2]] * tx.wt[q + 2] + grid[gr + tx.idx[q + 3]] * tx.wt[q + 3];
        }
      }
      for (let y = 0; y < h; y++) {
        const q = y * 4, r0 = ty.idx[q] * w, r1 = ty.idx[q + 1] * w, r2 = ty.idx[q + 2] * w, r3 = ty.idx[q + 3] * w;
        const w0 = ty.wt[q] * amp, w1 = ty.wt[q + 1] * amp, w2 = ty.wt[q + 2] * amp, w3 = ty.wt[q + 3] * amp, ro = y * w;
        for (let x = 0; x < w; x++) total[ro + x] += rows[r0 + x] * w0 + rows[r1 + x] * w1 + rows[r2 + x] * w2 + rows[r3 + x] * w3;
      }
      amp *= pers;
    }
    return normalize(total);
  }

  function gaussianBlur(src, h, w, sigma) {
    if (sigma <= 0) return Float32Array.from(src);
    const r = Math.max(1, Math.floor(4 * sigma + 0.5)), K = 2 * r + 1, ker = new Float32Array(K);
    let s = 0;
    for (let i = -r; i <= r; i++) { ker[i + r] = Math.exp(-0.5 * (i / sigma) ** 2); s += ker[i + r]; }
    for (let i = 0; i < K; i++) ker[i] /= s;
    const refl = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };
    const pass = (inp, out, n, count, stride, step) => {   // blur `count` lines of length n
      const buf = new Float32Array(n + 2 * r);
      for (let l = 0; l < count; l++) {
        const o = l * stride;
        for (let i = -r; i < n + r; i++) buf[i + r] = inp[o + refl(i, n) * step];
        for (let i = 0; i < n; i++) {
          let acc = 0;
          for (let k = 0; k < K; k++) acc += buf[i + k] * ker[k];
          out[o + i * step] = acc;
        }
      }
    };
    const tmp = new Float32Array(h * w), out = new Float32Array(h * w);
    pass(src, tmp, w, h, w, 1);          // rows
    pass(tmp, out, h, w, 1, w);          // columns
    return out;
  }

  // ------------------------------------------------ distance transform
  function dt1d(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  }
  // distance from every cell to the nearest cell where src is set
  function edt(src, h, w) {
    const n = Math.max(h, w), f = new Float64Array(n), d = new Float64Array(n);
    const v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(h * w), out = new Float32Array(h * w);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = src[y * w + x] ? 0 : 1e20;
      dt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = g[y * w + x];
      dt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
    }
    return out;
  }
  function signedDistance(mask, h, w) {            // >0 outside, <0 inside
    const inv = new Uint8Array(h * w);
    for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
    const out = edt(mask, h, w), inn = edt(inv, h, w), sd = new Float32Array(h * w);
    for (let i = 0; i < sd.length; i++) sd[i] = out[i] - inn[i];
    return sd;
  }

  // ------------------------------------------------ connected components
  function keepLargest(m, h, w) {
    const lab = new Int32Array(h * w), stack = new Int32Array(h * w);
    let best = 0, bestSize = 0, cur = 0;
    for (let i = 0; i < m.length; i++) {
      if (!m[i] || lab[i]) continue;
      cur++; let sp = 0, size = 0; stack[sp++] = i; lab[i] = cur;
      while (sp) {
        const p = stack[--sp]; size++;
        const y = (p / w) | 0, x = p - y * w;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack[sp++] = p + 1; }
        if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = cur; stack[sp++] = p - w; }
        if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = cur; stack[sp++] = p + w; }
      }
      if (size > bestSize) { bestSize = size; best = cur; }
    }
    for (let i = 0; i < m.length; i++) m[i] = lab[i] === best && best > 0 ? 1 : 0;
    return m;
  }
  function fillHoles(m, h, w) {
    const seen = new Uint8Array(h * w), stack = new Int32Array(h * w);
    let sp = 0;
    const push = (p) => { if (!m[p] && !seen[p]) { seen[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w); if (y < h - 1) push(p + w);
    }
    for (let i = 0; i < m.length; i++) if (!m[i] && !seen[i]) m[i] = 1;
    return m;
  }

  // ------------------------------------------------ shapes
  // Blob: wobbly oval with a ragged, fractal edge. Written into `out` (h x w).
  function blob(out, h, w, cx, cy, sx, sy, angleDeg, rough, jag, rng, windowed) {
    const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const rx = sx * w, ry = sy * h;
    let y0 = 0, y1 = h, x0 = 0, x1 = w;
    if (windowed) {
      const R = Math.max(rx, ry) * 1.9 + 4;
      y0 = clamp(Math.floor(cy * h - R), 0, h); y1 = clamp(Math.ceil(cy * h + R), 0, h);
      x0 = clamp(Math.floor(cx * w - R), 0, w); x1 = clamp(Math.ceil(cx * w + R), 0, w);
      if (y1 - y0 < 2 || x1 - x0 < 2) return out;
    }
    const hh = y1 - y0, ww = x1 - x0;
    const coef = [], phase = [];
    for (let k = 2; k <= 6; k++) { coef.push(rng.normal() / k); phase.push(rng.uniform(0, 2 * Math.PI)); }
    const LUT = 2048, wob = new Float32Array(LUT + 1);
    let wmax = 1e-8;
    for (let i = 0; i <= LUT; i++) {
      const th = -Math.PI + 2 * Math.PI * i / LUT;
      let s = 0;
      for (let k = 0; k < 5; k++) s += coef[k] * Math.sin((k + 2) * th + phase[k]);
      wob[i] = s; wmax = Math.max(wmax, Math.abs(s));
    }
    const ragged = fbm(hh, ww, rng, 12, 6, 0.62, Math.max(h, w));
    const sub = new Uint8Array(hh * ww);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < ww; x++) {
        const X = x0 + x - cx * w, Y = y0 + y - cy * h;
        const u = (X * ca + Y * sa) / rx, v = (-X * sa + Y * ca) / ry;
        const d = Math.sqrt(u * u + v * v);
        const th = Math.atan2(v, u), wb = wob[Math.round((th + Math.PI) / (2 * Math.PI) * LUT)] / wmax;
        const i = y * ww + x;
        if (d / (1 + rough * wb) + jag * ragged[i] < 1) sub[i] = 1;
      }
    }
    keepLargest(sub, hh, ww); fillHoles(sub, hh, ww);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) if (sub[y * ww + x]) out[(y0 + y) * w + x0 + x] = 1;
    return out;
  }

  function scatterPatches(h, w, avoid, n, sizeMin, sizeMax, shape, rough, jag, rng) {
    const out = new Uint8Array(h * w), S = Math.min(h, w);
    for (let p = 0; p < n; p++) {
      let cx = 0, cy = 0;
      for (let t = 0; t < 60; t++) {
        cx = rng.uniform(0, w); cy = rng.uniform(0, h);
        const i = (cy | 0) * w + (cx | 0);
        if (!avoid[i] && !out[i]) break;
      }
      const r = rng.uniform(sizeMin, sizeMax) * S;
      const kind = shape !== "mix" ? shape : rng.random() < 0.4 ? "rect" : "blob";
      if (kind === "rect") {
        let bw = r * rng.uniform(1.0, 3.5), bh = r * rng.uniform(0.2, 1.0);
        if (rng.random() < 0.4) [bw, bh] = [bh, bw];
        const x0 = Math.max(0, cx - bw / 2) | 0, x1 = Math.min(w, (cx + bw / 2) | 0) + 1;
        const y0 = Math.max(0, cy - bh / 2) | 0, y1 = Math.min(h, (cy + bh / 2) | 0) + 1;
        for (let y = y0; y < Math.min(y1, h); y++) for (let x = x0; x < Math.min(x1, w); x++) out[y * w + x] = 1;
      } else {
        const asp = rng.uniform(0.6, 1.6);
        blob(out, h, w, cx / w, cy / h, r * asp / w, r / asp / h, rng.uniform(0, 180), rough * 1.5, jag * 2, rng, true);
      }
    }
    return out;
  }

  // loose bits of dither ahead of the edge, thinning out with distance
  const FRAG_BLOCKS = [[1, 1, 0.10], [2, 1, 0.08], [2, 2, 0.07], [4, 1, 0.05], [3, 2, 0.05],
                       [4, 3, 0.03], [8, 2, 0.02], [6, 5, 0.012], [16, 2, 0.008], [12, 6, 0.004]];
  function fragments(sd, h, w, rng, spread, density) {
    const fall = new Float32Array(h * w), frag = new Uint8Array(h * w);
    for (let i = 0; i < fall.length; i++) if (sd[i] > 0) { const f = clamp(1 - sd[i] / spread, 0, 1); fall[i] = f * f; }
    for (const [bw, bh, p] of FRAG_BLOCKS) {
      const oy = rng.int(0, bh), ox = rng.int(0, bw), pp = Math.min(1, p * density);
      for (let by = -oy; by < h; by += bh) {
        const ya = Math.max(0, by), yb = Math.min(h, by + bh);
        for (let bx = -ox; bx < w; bx += bw) {
          const xa = Math.max(0, bx), xb = Math.min(w, bx + bw);
          let mx = 0;
          for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (fall[y * w + x] > mx) mx = fall[y * w + x];
          if (mx > 0 && rng.random() < pp * mx)
            for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) frag[y * w + x] = 1;
        }
      }
    }
    const n = fbm(h, w, rng, 24, 4, 0.6), dd = 2.5 * Math.min(1, density);
    for (let i = 0; i < frag.length; i++) {
      if (fall[i] > 0 && n[i] + dd * fall[i] > 2.7) frag[i] = 1;
      if (!(sd[i] > 0)) frag[i] = 0;
    }
    return frag;
  }

  // ------------------------------------------------ dithering
  const KERNELS = {
    floyd: [[[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]], 16],
    atkinson: [[[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]], 8],
    jjn: [[[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
           [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]], 48],
    stucki: [[[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
              [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]], 42],
    "sierra-lite": [[[1, 0, 2], [-1, 1, 1], [0, 1, 1]], 4],
  };

  function nearest(buf, base, c, pw, K) {
    let best = 0, bd = 1e30;
    for (let j = 0; j < K; j++) {
      let d = 0;
      for (let ch = 0; ch < c; ch++) { const df = buf[base + ch] - pw[j * c + ch]; d += df * df; }
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  function paletteStep(pw, K, c) {
    const nn = [];
    for (let i = 0; i < K; i++) {
      let m = Infinity;
      for (let j = 0; j < K; j++) {
        if (i === j) continue;
        let d = 0;
        for (let ch = 0; ch < c; ch++) { const df = pw[i * c + ch] - pw[j * c + ch]; d += df * df; }
        m = Math.min(m, Math.sqrt(d));
      }
      nn.push(m);
    }
    nn.sort((a, b) => a - b);
    const k = nn.length;
    return k % 2 ? nn[(k - 1) / 2] : (nn[k / 2 - 1] + nn[k / 2]) / 2;
  }

  function errorDiffuse(buf, h, w, c, pw, K, method, serpentine) {
    const [kern, div] = KERNELS[method], nk = kern.length;
    const kdx = kern.map((t) => t[0]), kdy = kern.map((t) => t[1]), kwt = kern.map((t) => t[2] / div);
    const idx = new Int32Array(h * w);
    for (let y = 0; y < h; y++) {
      const rev = serpentine && (y & 1);
      const start = rev ? w - 1 : 0, stop = rev ? -1 : w, step = rev ? -1 : 1;
      for (let x = start; x !== stop; x += step) {
        const base = (y * w + x) * c, best = nearest(buf, base, c, pw, K);
        idx[y * w + x] = best;
        for (let ch = 0; ch < c; ch++) {
          const err = buf[base + ch] - pw[best * c + ch];
          if (err === 0) continue;
          for (let i = 0; i < nk; i++) {
            const nx = x + kdx[i] * step, ny = y + kdy[i];
            if (nx >= 0 && nx < w && ny < h) buf[(ny * w + nx) * c + ch] += err * kwt[i];
          }
        }
      }
    }
    return idx;
  }

  let BAYER = null;
  function bayer8() {
    if (BAYER) return BAYER;
    let m = [[0, 2], [3, 1]];
    while (m.length < 8) {
      const n = m.length, nm = [];
      for (let y = 0; y < 2 * n; y++) {
        nm.push([]);
        for (let x = 0; x < 2 * n; x++) {
          const v = m[y % n][x % n] * 4, q = (y < n ? 0 : 2) + (x < n ? 0 : 1);
          nm[y].push(v + [0, 2, 3, 1][q]);
        }
      }
      m = nm;
    }
    BAYER = m.map((row) => row.map((v) => (v + 0.5) / 64 - 0.5));
    return BAYER;
  }

  // Dither an RGB float image (h x w) with dots g cells wide -> Uint8 RGB
  function dither(img, h, w, g, palette, P, rng) {
    const sh = Math.ceil(h / g), sw = Math.ceil(w / g), n = sh * sw;
    const small = new Float32Array(n * 3);
    if (g === 1) small.set(img);
    else {
      for (let by = 0; by < sh; by++) for (let bx = 0; bx < sw; bx++) {
        let r = 0, gg = 0, b = 0;
        for (let yy = 0; yy < g; yy++) {
          const y = Math.min(h - 1, by * g + yy);
          for (let xx = 0; xx < g; xx++) {
            const x = Math.min(w - 1, bx * g + xx), q = (y * w + x) * 3;
            r += img[q]; gg += img[q + 1]; b += img[q + 2];
          }
        }
        const q = (by * sw + bx) * 3, a = g * g;
        small[q] = r / a; small[q + 1] = gg / a; small[q + 2] = b / a;
      }
    }
    if (P.gamma !== 1) {
      const ig = 1 / P.gamma, L = 1024, lut = new Float32Array(L + 2);
      for (let i = 0; i <= L + 1; i++) lut[i] = 255 * Math.pow(Math.min(1, i / L), ig);
      for (let i = 0; i < small.length; i++) {
        const f = clamp(small[i], 0, 255) / 255 * L, i0 = f | 0;
        small[i] = lut[i0] + (lut[i0 + 1] - lut[i0]) * (f - i0);
      }
    }
    let pal = palette.map((c) => c.slice()), c, work, pw;
    if (P.mapping === "tone") {
      pal.sort((p, q) => lum(...p) - lum(...q));
      c = 1; work = new Float32Array(n);
      for (let i = 0; i < n; i++) work[i] = lum(small[i * 3], small[i * 3 + 1], small[i * 3 + 2]);
      pw = new Float32Array(pal.length);
      for (let j = 0; j < pal.length; j++) pw[j] = pal.length > 1 ? 255 * j / (pal.length - 1) : 0;
    } else {
      c = 3; work = small;
      pw = new Float32Array(pal.flat());
    }
    if (P.contrast !== 1) for (let i = 0; i < work.length; i++) work[i] = (work[i] - 127.5) * P.contrast + 127.5;
    const K = pal.length;
    let idx;
    if (P.method === "bayer" || P.method === "grain") {
      const spread = paletteStep(pw, K, c);
      let noise;
      if (P.method === "grain") {
        noise = new Float32Array(n);
        for (let i = 0; i < n; i++) noise[i] = rng.approxNormal();
        if (P.clump > 0) noise = normalize(gaussianBlur(noise, sh, sw, P.clump));
        for (let i = 0; i < n; i++) noise[i] *= 0.45 * spread;
      } else {
        const B = bayer8();
        noise = new Float32Array(n);
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) noise[y * sw + x] = B[y & 7][x & 7] * spread;
      }
      idx = new Int32Array(n);
      const tmp = new Float32Array(c);
      for (let i = 0; i < n; i++) {
        for (let ch = 0; ch < c; ch++) tmp[ch] = work[i * c + ch] + noise[i];
        idx[i] = nearest(tmp, 0, c, pw, K);
      }
    } else {
      idx = errorDiffuse(Float32Array.from(work), sh, sw, c, pw, K, P.method, P.serpentine);
    }
    const out = new Uint8Array(h * w * 3), pf = Uint8Array.from(pal.flat());
    for (let y = 0; y < h; y++) {
      const by = (y / g) | 0;
      for (let x = 0; x < w; x++) {
        const k = idx[by * sw + ((x / g) | 0)] * 3, q = (y * w + x) * 3;
        out[q] = pf[k]; out[q + 1] = pf[k + 1]; out[q + 2] = pf[k + 2];
      }
    }
    return out;
  }

  // ------------------------------------------------ palette from a photo (median cut)
  function medianCut(rgba, count, n) {
    const step = Math.max(1, Math.floor(count / 60000)), px = [];
    for (let i = 0; i < count; i += step) px.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    let boxes = [px];
    while (boxes.length < n) {
      let bi = -1, bestRange = -1, bestCh = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255, hi = 0;
          for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
          if (hi - lo > bestRange) { bestRange = hi - lo; bi = i; bestCh = ch; }
        }
      });
      if (bi < 0 || bestRange <= 0) break;
      const b = boxes[bi].sort((p, q) => p[bestCh] - q[bestCh]), mid = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
    }
    return boxes.filter((b) => b.length).map((b) => {
      const s = [0, 0, 0];
      for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
      return rgbToHex(s.map((v) => v / b.length));
    });
  }

  // ------------------------------------------------ main render
  /* createRenderer() -> render(img, P, opts)
     img:  {data: RGBA Uint8ClampedArray, width, height, id}
     P:    settings; P.scale / P.bgScale are in pixels of this image
     opts: {mask: Uint8Array | null, maskId, bgPalette: [[r,g,b]] | null}
     Stages are cached, so changing only colours / dither settings skips the
     shape work, and moving the region skips the background dither. Each
     stage has its own random stream so caching never changes the result. */
  function createRenderer() {
    const cache = {};
    const key = (o) => JSON.stringify(o);

    function cellsOf(img, s) {
      const k = key([img.id, s]);
      if (cache.cellsKey === k) return cache.cells;
      const W = img.width, H = img.height, src = img.data, hc = Math.ceil(H / s), wc = Math.ceil(W / s);
      const cells = new Float32Array(hc * wc * 3);
      for (let cy = 0; cy < hc; cy++) for (let cx = 0; cx < wc; cx++) {
        let r = 0, g = 0, b = 0;
        for (let yy = 0; yy < s; yy++) {
          const y = Math.min(H - 1, cy * s + yy);
          for (let xx = 0; xx < s; xx++) {
            const q = (y * W + Math.min(W - 1, cx * s + xx)) * 4;
            r += src[q]; g += src[q + 1]; b += src[q + 2];
          }
        }
        const q = (cy * wc + cx) * 3, a = s * s;
        cells[q] = Math.round(r / a); cells[q + 1] = Math.round(g / a); cells[q + 2] = Math.round(b / a);
      }
      cache.cellsKey = k; cache.cells = cells;
      return cells;
    }

    function shapesOf(img, P, s, hc, wc, opts) {
      const k = key([img.id, s, opts.maskId || null, P.seed, P.cx, P.cy, P.rx, P.ry, P.angle, P.roughness, P.jag,
                     P.patches, P.patchMin, P.patchMax, P.patchShape, P.fragments, P.spread, P.tiers, P.grow,
                     P.void, P.voidFade, P.clump]);
      if (cache.shapesKey === k) return cache.shapes;
      const W = img.width, H = img.height, NC = hc * wc, rng = makeRng(P.seed | 0);
      const main = new Uint8Array(NC);
      if (opts.mask) {
        const mask = opts.mask;
        for (let cy = 0; cy < hc; cy++) for (let cx = 0; cx < wc; cx++) {
          let sum = 0;
          for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++)
            sum += mask[Math.min(H - 1, cy * s + yy) * W + Math.min(W - 1, cx * s + xx)];
          main[cy * wc + cx] = sum * 2 > s * s ? 1 : 0;
        }
      } else {
        blob(main, hc, wc, P.cx, P.cy, P.rx, P.ry, P.angle, P.roughness, P.jag, rng, false);
      }
      if (P.patches > 0) {
        const pm = scatterPatches(hc, wc, main, P.patches | 0, P.patchMin, P.patchMax, P.patchShape, P.roughness, P.jag, rng);
        for (let i = 0; i < NC; i++) if (pm[i]) main[i] = 1;
      }
      let any = false;
      for (let i = 0; i < NC; i++) if (main[i]) { any = true; break; }
      let S = { empty: !any };
      if (any) {
        const sd = signedDistance(main, hc, wc), take = Uint8Array.from(main);
        if (P.fragments > 0) {
          const fr = fragments(sd, hc, wc, rng, Math.max(1, P.spread * Math.min(hc, wc)), P.fragments);
          for (let i = 0; i < NC; i++) if (fr[i]) take[i] = 1;
        }
        let y0 = hc, y1 = 0, x0 = wc, x1 = 0;
        for (let y = 0; y < hc; y++) for (let x = 0; x < wc; x++) if (take[y * wc + x]) {
          if (y < y0) y0 = y; if (y >= y1) y1 = y + 1; if (x < x0) x0 = x; if (x >= x1) x1 = x + 1;
        }
        const ch = y1 - y0, cw = x1 - x0, NB = ch * cw;
        const tk = new Uint8Array(NB), mm = new Uint8Array(NB), depth = new Float32Array(NB);
        let dmax = 0;
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const i = y * cw + x, j = (y + y0) * wc + x + x0;
          tk[i] = take[j]; mm[i] = main[j];
          depth[i] = Math.max(0, -sd[j]); if (depth[i] > dmax) dmax = depth[i];
        }
        // intensity tiers: coarser dots toward the core, each snapped to its own grid
        const tiers = Math.max(1, P.tiers | 0), tier = new Int8Array(NB);
        for (let i = 0; i < NB; i++) tier[i] = tk[i] ? 0 : -1;
        let dn = null;
        if (dmax > 0 && (tiers > 1 || P.void > 0)) {
          const jit = fbm(ch, cw, rng, 8, 5, 0.6);
          dn = new Float32Array(NB);
          for (let i = 0; i < NB; i++) dn[i] = mm[i] ? depth[i] / dmax + 0.12 * jit[i] : -1;
          for (let t = 1; t < tiers; t++) {
            const g = Math.pow(Math.max(1, P.grow | 0), t), thr = 0.85 * t / tiers;
            for (let by = 0; by < ch; by += g) for (let bx = 0; bx < cw; bx += g) {
              let mn = 1e9;
              for (let yy = 0; yy < g; yy++) for (let xx = 0; xx < g; xx++) {
                const v = dn[Math.min(ch - 1, by + yy) * cw + Math.min(cw - 1, bx + xx)];
                if (v < mn) mn = v;
              }
              if (mn > thr)
                for (let y = by; y < Math.min(ch, by + g); y++) for (let x = bx; x < Math.min(cw, bx + g); x++)
                  if (mm[y * cw + x]) tier[y * cw + x] = t;
            }
          }
        }
        // void: the deepest part turns one colour; the dots die off toward it
        const voidM = new Uint8Array(NB);
        if (P.void > 0 && dn) {
          const vr = makeRng((P.seed | 0) + 7777), start = 1 - P.void, fade = Math.max(P.voidFade, 1e-6);
          let grit = new Float32Array(NB);
          for (let i = 0; i < NB; i++) grit[i] = vr.approxNormal();
          grit = normalize(gaussianBlur(grit, ch, cw, Math.max(P.clump, 0.6)));
          for (let i = 0; i < NB; i++) {
            let t = clamp((dn[i] - (start - fade)) / fade, 0, 1);
            t = t * t * (3 - 2 * t);
            if (dn[i] > start || (mm[i] && normalCdf(grit[i]) < t)) voidM[i] = 1;
          }
        }
        S = { empty: false, take, y0, y1, x0, x1, ch, cw, tk, tier, tiers, voidM, dist: null };
      }
      cache.shapesKey = k; cache.shapes = S; cache.strengthKey = null;
      return S;
    }

    function backgroundOf(img, P, opts, palette) {
      const bs = Math.max(1, P.bgScale | 0);
      const bgPal = opts.bgPalette || palette;
      const bgP = { mapping: opts.bgPalette ? "color" : P.mapping, gamma: P.gamma, contrast: P.contrast,
                    method: P.method, clump: P.clump, serpentine: P.serpentine };
      const k = key([img.id, bs, bgPal, bgP, P.seed]);
      if (cache.bgKey === k) return cache.bg;
      const W = img.width, H = img.height, N = W * H, src = img.data, rgb = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { rgb[i * 3] = src[i * 4]; rgb[i * 3 + 1] = src[i * 4 + 1]; rgb[i * 3 + 2] = src[i * 4 + 2]; }
      const bg = dither(rgb, H, W, bs, bgPal, bgP, makeRng((P.seed | 0) + 202));
      cache.bgKey = k; cache.bg = bg;
      return bg;
    }

    function strengthOf(S, P, hc, wc, shapesKey) {
      const k = key([shapesKey, P.background, P.blend, P.seed]);
      if (cache.strengthKey === k) return cache.strength;
      if (!S.dist) S.dist = edt(S.take, hc, wc);
      const reach = Math.max(1, P.blend * Math.min(hc, wc)), NC = hc * wc;
      const wob = fbm(hc, wc, makeRng((P.seed | 0) + 303), 6, 4, 0.55), st = new Float32Array(NC);
      for (let i = 0; i < NC; i++) {
        const near = Math.pow(clamp(1 - S.dist[i] / reach, 0, 1), 1.5), wv = clamp(0.5 + 0.25 * wob[i], 0, 1);
        st[i] = clamp(P.background + (1 - P.background) * near * (0.5 + wv), 0, 1);
      }
      cache.strengthKey = k; cache.strength = st;
      return st;
    }

    return function render(img, P, opts = {}) {
      const W = img.width, H = img.height, src = img.data, s = Math.max(1, P.scale | 0);
      const hc = Math.ceil(H / s), wc = Math.ceil(W / s);
      const cells = cellsOf(img, s);
      const S = shapesOf(img, P, s, hc, wc, opts);
      const out = new Uint8ClampedArray(src);
      const palette = P.palette.map(hexToRgb);

      if (P.background > 0) {
        const bg = backgroundOf(img, P, opts, palette);
        if (!S.empty) {
          const st = strengthOf(S, P, hc, wc, cache.shapesKey);
          const XA = new Int32Array(W), XB = new Int32Array(W), TX = new Float32Array(W);
          for (let x = 0; x < W; x++) {
            const fx = clamp((x + 0.5) / s - 0.5, 0, wc - 1);
            XA[x] = fx | 0; XB[x] = Math.min(wc - 1, XA[x] + 1); TX[x] = fx - XA[x];
          }
          for (let y = 0; y < H; y++) {                   // bilinear upsample of the strength map
            const fy = clamp((y + 0.5) / s - 0.5, 0, hc - 1), ya = fy | 0, yb = Math.min(hc - 1, ya + 1), ty = fy - ya;
            const ra = ya * wc, rb = yb * wc;
            for (let x = 0; x < W; x++) {
              const xa = XA[x], xb = XB[x], tx = TX[x];
              const a = s === 1 ? st[ra + x]
                : (st[ra + xa] * (1 - tx) + st[ra + xb] * tx) * (1 - ty) + (st[rb + xa] * (1 - tx) + st[rb + xb] * tx) * ty;
              const q = (y * W + x) * 4, p = (y * W + x) * 3;
              out[q] = src[q] + (bg[p] - src[q]) * a;
              out[q + 1] = src[q + 1] + (bg[p + 1] - src[q + 1]) * a;
              out[q + 2] = src[q + 2] + (bg[p + 2] - src[q + 2]) * a;
            }
          }
        }
      }
      if (S.empty) return out;

      const { y0, y1, x0, x1, ch, cw, tk, tier, tiers, voidM } = S, NB = ch * cw;
      const crop = new Float32Array(NB * 3);
      for (let y = 0; y < ch; y++) {
        const a = ((y + y0) * wc + x0) * 3;
        crop.set(cells.subarray(a, a + cw * 3), y * cw * 3);
      }
      const outCells = new Uint8Array(NB * 3), drng = makeRng((P.seed | 0) + 101);
      for (let t = 0; t < tiers; t++) {
        let any = false;
        for (let i = 0; i < NB; i++) if (tier[i] === t) { any = true; break; }
        if (!any) continue;
        const d = dither(crop, ch, cw, Math.pow(Math.max(1, P.grow | 0), t), palette, P, drng);
        for (let i = 0; i < NB; i++) if (tier[i] === t) { outCells[i * 3] = d[i * 3]; outCells[i * 3 + 1] = d[i * 3 + 1]; outCells[i * 3 + 2] = d[i * 3 + 2]; }
      }
      const vc = hexToRgb(P.voidColor);
      for (let i = 0; i < NB; i++) if (voidM[i]) { outCells[i * 3] = vc[0]; outCells[i * 3 + 1] = vc[1]; outCells[i * 3 + 2] = vc[2]; }

      for (let y = y0 * s; y < Math.min(H, y1 * s); y++) {    // paste back at full resolution
        const row = (((y / s) | 0) - y0) * cw - x0;
        for (let x = x0 * s; x < Math.min(W, x1 * s); x++) {
          const i = row + ((x / s) | 0);
          if (!tk[i]) continue;
          const q = (y * W + x) * 4;
          out[q] = outCells[i * 3]; out[q + 1] = outCells[i * 3 + 1]; out[q + 2] = outCells[i * 3 + 2];
        }
      }
      return out;
    };
  }

  return { createRenderer, medianCut, hexToRgb, rgbToHex };
})();
if (typeof module !== "undefined") module.exports = Engine;
