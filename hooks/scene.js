// Pure pixel painting: a half-block canvas (two pixels per cell, stacked),
// an overlay of glyphs, and the scenes the crab walks through.
// Adapted from crab-theater (c) chankostin for token-weather-zh

export const DEFAULT = 0x01000000;
export const CRAB = 0xde7356;
export const EYE = 0x1c1c1c;

export const BODY = [
  '..##########..',
  '..##########..',
  '..#e######e#..',
  '###e######e###',
  '..##########..',
  '..##########..',
];
export const LEGS = [
  ['..#.#....#.#..', '..#.#....#.#..'],
  ['...#.#..#.#...', '...#.#..#.#...'],
];

export const SIGN = {
  meadow: { border: 0x9aa0a6, text: 0xe6c07b },
  cave:   { border: 0xb07a4a, text: 0xe0b33a },
  rail:   { border: 0xff5577, text: 0xff8fa8 },
  forge:  { border: 0xff6a2a, text: 0xffb066 },
  space:  { border: 0x8d6be8, text: 0xb9a3ff },
  sea:    { border: 0x4aa3d8, text: 0x9fd3f0 },
};

export const hash = (n) => {
  let x = Math.imul(n | 0, 374761393) + 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const pset = (c, x, y, col) => {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x >= 0 && x < c.W && y >= 0 && y < c.H) c.px[y * c.W + x] = col;
};

const fill = (c, x, y, w, h, col) => {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) pset(c, x + dx, y + dy, col);
  }
};

const glyph = (c, x, y, s, col) => {
  let i = 0;
  for (const ch of s) {
    const cx = x + i++;
    if (cx >= 0 && cx < c.W && y >= 0 && y < c.R) {
      c.oc[y * c.W + cx] = ch.codePointAt(0) ?? 0x20;
      c.of[y * c.W + cx] = col;
    }
  }
};

const stars = (c, density, offset, rows) => {
  for (let cy = 0; cy < rows; cy++) {
    for (let x = 0; x < c.W; x++) {
      const k = (x + offset) * 131 + cy * 7919;
      if (hash(k) < density) {
        const tw = hash(k + Math.floor(c.t / 500));
        glyph(c, x, cy, tw < 0.2 ? '*' : '·', tw < 0.5 ? 0xc8ccdf : 0x7f849c);
      }
    }
  }
};

const meadow = (c) => {
  const { W, H, s } = c;
  stars(c, 0.012, Math.floor(s / 4), 3);
  for (let x = 0; x < W; x++) {
    const wx = x + s;
    pset(c, x, H - 2, 0x5aa63c);
    pset(c, x, H - 1, 0x3d7a2a);
    const b = Math.floor(wx / 6);
    if (hash(b) < 0.4 && wx % 6 < 4) {
      const h = 1 + Math.floor(hash(b + 999) * 4);
      const col = hash(b + 7) < 0.5 ? 0x4c8c2b : 0x6fb13f;
      for (let y = 1; y <= h; y++) if (y === 1 || (wx + y) % 2 === 0) pset(c, x, H - 2 - y, col);
    }
    if (hash(wx * 13 + 5) < 0.03) pset(c, x, H - 3, 0xe8c547);
  }
  return H - 2;
};

const cave = (c) => {
  const { W, H, s } = c;
  for (let x = 0; x < W; x++) {
    const wx = x + s;
    pset(c, x, 0, 0x4a3426);
    pset(c, x, 1, 0x5a4030);
    if (hash(Math.floor(wx / 3)) < 0.3) {
      const len = 1 + Math.floor(hash(Math.floor(wx / 3) + 3) * 4);
      fill(c, x, 2, 1, len, 0x6b4a2f);
    }
    pset(c, x, H - 2, 0x7a5230);
    pset(c, x, H - 1, 0x5a3a20);
    const b = Math.floor(wx / 9);
    if (hash(b + 50) < 0.35 && wx % 9 < 5) {
      const h = 1 + Math.floor(hash(b + 51) * 3);
      fill(c, x, H - 2 - h, 1, h, 0x5c5149);
    }
    if (hash(wx * 3 + 1) < 0.07) {
      const blink = hash(wx + Math.floor(c.t / 300)) < 0.7;
      pset(c, x, 4 + Math.floor(hash(wx + 77) * (H - 9)), blink ? 0xe0b33a : 0x8a6d2a);
    }
  }
  return H - 2;
};

const rail = (c) => {
  const { W, H, s, t } = c;
  stars(c, 0.01, Math.floor(s / 4), 3);
  const top = H - 6;
  for (let x = 0; x < W; x++) {
    const wx = x + s;
    if (wx % 4 < 2) pset(c, x, top, 0x6f68b0);
    for (let y = top + 1; y < H; y++) {
      const brick = (y - top) % 2 === 0 && (wx + (y % 4 === 0 ? 0 : 3)) % 6 === 0;
      pset(c, x, y, brick ? 0x3f3a72 : 0x4f4a8a);
    }
  }
  const carts = [0xff5577, 0x4fb3ff, 0xc8f25a];
  const cs = Math.floor(t / 40);
  const n = Math.ceil(W / 30) + 1;
  for (let i = 0; i < n; i++) {
    const x0 = W - ((cs + i * 30) % (W + 30));
    fill(c, x0, top - 4, 7, 3, carts[i % carts.length] ?? 0xff5577);
    pset(c, x0 + 1, top - 1, 0x9a9a9a);
    pset(c, x0 + 5, top - 1, 0x9a9a9a);
  }
  return top;
};

const forge = (c) => {
  const { W, H, s, t } = c;
  stars(c, 0.008, Math.floor(s / 4), 3);
  const sand = H - 3;
  for (let x = 0; x < W; x++) {
    const wx = x + s;
    pset(c, x, sand, 0xb8a05a);
    if (Math.sin((wx + t / 120) / 2.2) > 0.2) pset(c, x, H - 2, 0x4aa3d8);
    pset(c, x, H - 1, 0x2f7fb3);
  }
  const vh = H - 6;
  const peak = sand - vh;
  for (let k = -1; k <= Math.ceil(W / 80) + 1; k++) {
    const vc = 60 - (s % 80) + k * 80;
    for (let dy = 0; dy < vh; dy++) {
      const half = Math.floor((vh - dy) * 1.3);
      for (let dx = -half; dx <= half; dx++) {
        pset(c, vc + dx, sand - 1 - dy, hash((vc + dx + s) * 7 + dy) < 0.15 ? 0x7d4a28 : 0x6b3f22);
      }
    }
    fill(c, vc - 1, peak, 3, 1, 0xff6a2a);
    for (let i = 0; i < 8; i++) {
      const phase = (t / 70 + i * 5) % 14;
      const ex = vc + Math.round((hash(i + k * 31) - 0.5) * 10 * (phase / 14));
      pset(c, ex, peak - 1 - Math.floor(phase), i % 2 ? 0xff9f40 : 0xd8442a);
    }
  }
  return sand;
};

const space = (c) => {
  const { W, H, s, t } = c;
  stars(c, 0.05, Math.floor(s / 2), c.R);
  const ps = Math.floor(s / 1.5);
  for (let k = -1; k <= Math.ceil(W / 110) + 1; k++) {
    const pc = 90 - (ps % 110) + k * 110;
    const cy = Math.floor(H / 2);
    const r = 5;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r * 2; dx <= r * 2; dx++) {
        if ((dx / 2) ** 2 + dy ** 2 <= r * r) {
          pset(c, pc + dx, cy + dy, dx < -2 && dy < -1 ? 0x8d6be8 : 0x6d4bc4);
        }
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const ax = W - ((t / 25 + i * 259) % (W + 10));
    const ay = 2 + Math.floor(hash(i * 17) * (H - 6));
    fill(c, ax, ay, 3, 2, 0x9a8f80);
    pset(c, ax + 1, ay, 0x7a7060);
  }
  return H - 4;
};

const sea = (c) => {
  const { W, H, s, t } = c;
  stars(c, 0.01, Math.floor(s / 4), 3);
  for (let x = 0; x < W; x++) {
    const wx = x + s;
    const surf = H - 3 + (Math.sin((wx + t / 90) / 3) > 0 ? 0 : 1);
    pset(c, x, surf, 0x4aa3d8);
    for (let y = surf + 1; y < H; y++) pset(c, x, y, 0x2f6f9f);
  }
  for (let k = -1; k <= Math.ceil(W / 90) + 1; k++) {
    const bc = 70 - (s % 90) + k * 90;
    fill(c, bc - 6, H - 5, 12, 1, 0x8a7a4a);
    fill(c, bc - 5, H - 4, 10, 1, 0x6f6238);
    fill(c, bc, H - 12, 1, 7, 0xb0a070);
    for (let r = 0; r < 6; r++) fill(c, bc + 1, H - 12 + r, Math.max(1, r), 1, 0xd9d2b0);
  }
  for (let i = 0; i < 3; i++) {
    const fx = Math.floor(W - ((t / 60 + i * 40) % (W + 5)));
    glyph(c, fx, c.R - 1, '><>', 0xffb347);
  }
  return H - 3;
};

const SCENES = { meadow, cave, rail, forge, space, sea };

const drawCrab = (c, x, ground, scene) => {
  const float = scene === 'space' ? Math.round(Math.sin(c.t / 350) * 2) : 0;
  const y0 = ground - 8 + float;
  const blink = Math.floor(c.t / 100) % 40 === 0;
  const legs = LEGS[Math.floor(c.t / 450) % 2] ?? [];
  if (scene === 'sea') fill(c, x - 1, ground, 16, 1, 0x8a6a3a);
  const rows = [...BODY, ...legs];
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const p = row[dx];
      if (p !== '#' && p !== 'e') continue;
      pset(c, x + dx, y0 + dy, p === 'e' && !blink ? EYE : CRAB);
      const cy = Math.floor((y0 + dy) / 2);
      if (x + dx >= 0 && x + dx < c.W && cy >= 0 && cy < c.R) c.oc[cy * c.W + x + dx] = 0;
    }
  });
};

const sanitize = (label) => {
  const ascii = label.replace(/[^\x20-\x7e]/g, '').trim();
  const s = ascii || '*';
  return s.length > 22 ? `${s.slice(0, 21)}~` : s;
};

const drawSign = (c, act, crabX, ground, now) => {
  if (!act.label) return;
  const label = sanitize(act.label);
  const w = label.length + 4;
  const x = Math.max(crabX + 17, c.W - Math.floor((now - act.at) / 25));
  if (x >= c.W) return;
  const bottom = Math.max(5, Math.floor((ground - 1) / 2));
  const { border, text } = SIGN[act.scene] || SIGN.meadow;
  glyph(c, x, bottom - 2, `┌${'─'.repeat(w - 2)}┐`, border);
  glyph(c, x, bottom - 1, '│', border);
  glyph(c, x + 1, bottom - 1, ` ${label} `, text);
  glyph(c, x + w - 1, bottom - 1, '│', border);
  glyph(c, x, bottom, `└${'─'.repeat(w - 2)}┘`, border);
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64 = (u8) => {
  if (typeof u8.toBase64 === 'function') return u8.toBase64();
  const out = [];
  for (let i = 0; i < u8.length; i += 3) {
    const n = ((u8[i] ?? 0) << 16) | ((u8[i + 1] ?? 0) << 8) | (u8[i + 2] ?? 0);
    out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63));
    out.push(i + 1 < u8.length ? B64.charAt((n >> 6) & 63) : '=', i + 2 < u8.length ? B64.charAt(n & 63) : '=');
  }
  return out.join('');
};

/**
 * 绘制一帧大画布像素数据
 */
export const paint = (layout, act, now, t) => {
  const { W, R, crabX, bubble } = layout;
  const H = R * 2;
  const c = {
    W,
    H,
    R,
    t,
    s: Math.floor(t / 300), // 场景卷轴移动速度放慢 3 倍以上，温和舒缓
    px: new Int32Array(W * H).fill(-1),
    oc: new Uint32Array(W * R),
    of: new Uint32Array(W * R),
  };
  const ground = (SCENES[act.scene] ?? SCENES.meadow)(c);
  drawSign(c, act, crabX, ground, now);
  drawCrab(c, crabX, ground, act.scene);

  const words = new Uint32Array(W * R * 3);
  for (let cy = 0; cy < R; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      let cp = 0x20;
      let fg = DEFAULT;
      let bg = DEFAULT;
      const underBubble = bubble !== null && cy < 3 && cx >= bubble.x && cx < bubble.x + bubble.w;
      if (underBubble) {
        // 空出，交给气泡 Box 覆盖
      } else if (c.oc[i]) {
        cp = c.oc[i] ?? 0x20;
        fg = c.of[i] ?? DEFAULT;
      } else {
        const top = c.px[cy * 2 * W + cx] ?? -1;
        const bot = c.px[(cy * 2 + 1) * W + cx] ?? -1;
        if (top >= 0 && bot >= 0) {
          cp = top === bot ? 0x2588 : 0x2580;
          fg = top;
          bg = top === bot ? DEFAULT : bot;
        } else if (top >= 0) {
          cp = 0x2580;
          fg = top;
        } else if (bot >= 0) {
          cp = 0x2584;
          fg = bot;
        }
      }
      words[i * 3] = cp;
      words[i * 3 + 1] = fg;
      words[i * 3 + 2] = bg;
    }
  }
  return base64(new Uint8Array(words.buffer));
};
