// Pure pixel painting for compact Claw'd pet:
// 2 rows height (4 vertical pixels via half-block cells).
// Left-aligned with no background canvas clutter.
// Retains tool invocation signboard effect and Claw'd stepping/blinking animation.

export const DEFAULT = 0x01000000;
export const CRAB = 0xde7356;
export const EYE = 0x1c1c1c;

// 迷你 Claude 官方方块小蟹 Claw'd (宽度 8px，高度 4px，映射为 2 行半块字符)
// 帧 0
export const CRAB_FRAME_0 = [
  '..####..',
  '##e##e##',
  '.######.',
  '#.#..#.#',
];

// 帧 1 (迈腿走步)
export const CRAB_FRAME_1 = [
  '..####..',
  '##e##e##',
  '.######.',
  '.#.#.#.#',
];

export const SIGN = {
  meadow: { border: 0x9aa0a6, text: 0xe6c07b },
  cave:   { border: 0xb07a4a, text: 0xe0b33a },
  rail:   { border: 0xff5577, text: 0xff8fa8 },
  forge:  { border: 0xff6a2a, text: 0xffb066 },
  space:  { border: 0x8d6be8, text: 0xb9a3ff },
  sea:    { border: 0x4aa3d8, text: 0x9fd3f0 },
};

const pset = (c, x, y, col) => {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x >= 0 && x < c.W && y >= 0 && y < c.H) c.px[y * c.W + x] = col;
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

const sanitize = (label) => {
  const ascii = label.replace(/[^\x20-\x7e]/g, '').trim();
  const s = ascii || '*';
  return s.length > 20 ? `${s.slice(0, 19)}~` : s;
};

// 工具调用标牌：直接静止贴在小蟹身旁展示（告别从右滑到左的晃眼横移，温和淡雅）
const drawSign = (c, act, crabWidth) => {
  if (!act.label) return;
  const label = sanitize(act.label);
  const textLen = label.length;
  // 直接锚定在小蟹右侧 1 格，安静自然
  const x = crabWidth + 1;
  if (x + textLen + 2 >= c.W) return;

  const { border, text } = SIGN[act.scene] || SIGN.meadow;
  // 第一行：[ 道具/文件名 ]
  glyph(c, x, 0, `[${label}]`, text);
  // 第二行：工具标识小阴影托盘
  glyph(c, x, 1, `└${'─'.repeat(Math.min(textLen, Math.max(0, c.W - x - 2)))}`, border);
};

const drawMiniCrab = (c, x, t) => {
  const blink = Math.floor(t / 100) % 35 === 0;
  const step = Math.floor(t / 140) % 2;
  const frame = step === 0 ? CRAB_FRAME_0 : CRAB_FRAME_1;

  for (let dy = 0; dy < 4; dy++) {
    const row = frame[dy];
    for (let dx = 0; dx < row.length; dx++) {
      const p = row[dx];
      if (p === '.') continue;
      const col = p === 'e' ? (blink ? CRAB : EYE) : CRAB;
      pset(c, x + dx, dy, col);
    }
  }
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
 * 绘制 2 行无背景的左下角小蟹点阵舞台
 */
export const paint = (layout, act, now, t) => {
  const { W, R, crabX } = layout;
  const H = R * 2; // R = 2, H = 4
  const c = {
    W,
    H,
    R,
    t,
    px: new Int32Array(W * H).fill(-1),
    oc: new Uint32Array(W * R),
    of: new Uint32Array(W * R),
  };

  // 左下角绘制迷你小蟹 (宽 8 像素 = 8 格半块)
  drawMiniCrab(c, crabX, t);

  // 渲染工具调用场景道具标牌（静止附着在小蟹身旁）
  drawSign(c, act, crabX + 8);

  const words = new Uint32Array(W * R * 3);
  for (let cy = 0; cy < R; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      let cp = 0x20;
      let fg = DEFAULT;
      let bg = DEFAULT;

      if (c.oc[i]) {
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
