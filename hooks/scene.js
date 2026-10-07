// Pure pixel painting for compact Claw'd pet:
// 2 rows height (4 vertical pixels via half-block cells).
// Left-aligned with no background canvas clutter.
// Claw'd stepping and blinking animation with pre-rendered frame cache.

export const DEFAULT = 0x01000000;
export const CRAB = 0xde7356;
export const EYE = 0x1c1c1c;

// 迷你 Claude 官方方块小蟹 Claw'd (宽度 8px，高度 4px，映射为 2 行半块字符)
// 帧 0: 常态双足站立
export const CRAB_FRAME_0 = [
  '..####..',
  '##e##e##',
  '.######.',
  '#.#..#.#',
];

// 帧 1: 迈腿走步
export const CRAB_FRAME_1 = [
  '..####..',
  '##e##e##',
  '.######.',
  '.#.#.#.#',
];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(u8) {
  if (typeof u8.toBase64 === 'function') return u8.toBase64();
  const out = [];
  for (let i = 0; i < u8.length; i += 3) {
    const n = ((u8[i] ?? 0) << 16) | ((u8[i + 1] ?? 0) << 8) | (u8[i + 2] ?? 0);
    out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63));
    out.push(i + 1 < u8.length ? B64.charAt((n >> 6) & 63) : '=', i + 2 < u8.length ? B64.charAt(n & 63) : '=');
  }
  return out.join('');
}

function renderFrame(frame, blink) {
  const W = 8, R = 2;
  const words = new Uint32Array(W * R * 3);
  for (let cy = 0; cy < R; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      const topChar = frame[cy * 2][cx];
      const botChar = frame[cy * 2 + 1][cx];
      const topCol = topChar === '.' ? -1 : (topChar === 'e' ? (blink ? CRAB : EYE) : CRAB);
      const botCol = botChar === '.' ? -1 : (botChar === 'e' ? (blink ? CRAB : EYE) : CRAB);

      let cp = 0x20, fg = DEFAULT, bg = DEFAULT;
      if (topCol >= 0 && botCol >= 0) {
        cp = topCol === botCol ? 0x2588 : 0x2580;
        fg = topCol;
        bg = topCol === botCol ? DEFAULT : botCol;
      } else if (topCol >= 0) {
        cp = 0x2580;
        fg = topCol;
      } else if (botCol >= 0) {
        cp = 0x2584;
        fg = botCol;
      }
      words[i * 3] = cp;
      words[i * 3 + 1] = fg;
      words[i * 3 + 2] = bg;
    }
  }
  return base64(new Uint8Array(words.buffer));
}

// 预渲染 4 种基础小蟹动画状态 (0 内存分配):
// [0]: 步态 0 + 睁眼; [1]: 步态 0 + 眨眼; [2]: 步态 1 + 睁眼; [3]: 步态 1 + 眨眼
const PRECOMPUTED_FRAMES = [
  renderFrame(CRAB_FRAME_0, false),
  renderFrame(CRAB_FRAME_0, true),
  renderFrame(CRAB_FRAME_1, false),
  renderFrame(CRAB_FRAME_1, true),
];

/**
 * 绘制 2 行无背景的左下角小蟹点阵舞台 (超低开销预渲染快照缓存)
 */
export const paint = (layout, act, now, t) => {
  const { W, R, crabX } = layout;
  // 快路径：默认 8 列 x 2 行无偏移迷你方块蟹（零内存分配、零 GC）
  if (W === 8 && R === 2 && (crabX ?? 0) === 0) {
    const blink = Math.floor(t / 100) % 35 === 0;
    const step = Math.floor(t / 140) % 2;
    return PRECOMPUTED_FRAMES[(step << 1) | (blink ? 1 : 0)];
  }

  // 动态尺寸回退绘制
  const blink = Math.floor(t / 100) % 35 === 0;
  const step = Math.floor(t / 140) % 2;
  const frame = step === 0 ? CRAB_FRAME_0 : CRAB_FRAME_1;
  return renderFrame(frame, blink);
};
