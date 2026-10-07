// Copyright 2026 Anthropic PBC / atri404
// SPDX-License-Identifier: Apache-2.0
//
// Token Weather 汉化增强版 + 像素大剧场 (Crab Theater Mode):
// 1. 上下文窗口实时天气预报、多阶分段彩色进度条 (参考 claude-deck segments 样式: ▰ ▱ 与暗轨色)、
//    全会话累计输入/输出/推理/命中率、真实纯流式模型输出速率 (基于流式 chunk 精确间隔)、历史趋势走势图。
// 2. 深度融合原版《crab-theater》9 行 24-bit 像素画布大舞台引擎 (Raster + ▀ ▄ █ 半块字符绘制):
//    - 6 大动态场景 (meadow, forge, rail, cave, space, sea);
//    - Claude 官方正统暖橙色 (#de7356) 方块像素螃蟹，随轮次踏步迈步行走 + 随机眨眼动画;
//    - 动态动作标牌 (Signboard) 随时间由远及近滑入;
//    - 伴生剧场气泡 (Speech Bubble): 展示当前动作台词，或在气象变色时播报专属警报与专业优化建议！

import { paint } from './scene.js';

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const BAR_WIDTH = 10;
const TRACK_COLOR = "#3a3936"; // 参考 claude-deck 深度暗轨底色

const ROWS = 2; // 极简纯粹：仅 2 行高度 (4 像素纵向，完美呈现迷你方块小蟹)
const KEY = 'scene';
const TICK_MS = 70; // 恢复流畅丝滑 70ms 帧率 (~14fps)
const EPOCH = Date.now();

// 天气分档与阶梯色彩映射: 按上下文占用百分比 (<25% 绿, <50% 青, <75% 黄, <90% 洋红, ≥90% 红)
const FORECAST = [
  { upTo: 25, icon: "☀", word: "晴朗", color: "green" },
  { upTo: 50, icon: "☁", word: "多云", color: "cyan" },
  { upTo: 75, icon: "☂", word: "阵雨", color: "yellow" },
  { upTo: 90, icon: "☇", word: "风暴", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "亟待压缩", color: "red" },
];

// 本地气象变动建议字典
const PET_ADVICE = {
  "晴朗": {
    up: "空间极度充裕！尽情思考与编写，无需顾虑上下文负担~",
    down: "乌云散去，晴空万里！上下文精炼释放回绿区健康水位，轻装上阵！",
  },
  "多云": {
    up: "状态平稳健康，记忆脉络清晰，探索与多文件协作正常推进。",
    down: "呼~ 内存大扫除成功！上下文降回到多云安全区，记忆整齐。",
  },
  "阵雨": {
    up: "降雨警觉！占用已过半。避免全量倾倒超大文件或冗余日志，多用精准定位与局部阅读。",
    down: "水位回落至阵雨区，注意继续保持节奏，按需读取资料。",
  },
  "风暴": {
    up: "强风暴来袭！上下文较为紧张，建议尽快收尾交付当前子任务，防范信息过载。",
    down: "从红区回落至风暴区，虽脱离极度危险，仍需注意控制上下文体量。",
  },
  "亟待压缩": {
    up: "⚠️ 紧急红警！临近上下文上限，强烈建议输入 /compact 进行记忆精简压缩，防止早期关键信息被截断！",
    down: "⚠️ 依然处于临界红区，建议随时执行 /compact 压缩会话。",
  },
};

// 历史占用读数: { tokens, window, percent }, 旧 -> 新
let readings = [];
// 会话累计统计
let totalInput = 0;
let totalOutput = 0;
let totalThinking = 0;
let totalCacheRead = 0;
let totalCacheWrite = 0;
const recordedTurns = new Set();

// 模型纯流式输出速率与首字延迟统计 (EWMA 平滑)
let lastRate = null;
let lastTtft = null;
let activeTurnPureTokens = 0;
let activeTurnPureMs = 0;

// 上一次记录的天气等级对象
let lastForecastWord = null;
let petAlert = null;

// 像素大剧场状态
let act = { id: 0, scene: 'meadow', say: '营地小憩 · 守望天色', label: '', at: 0 };
let typed = 0;
let nextId = 1;
let mount = null;
let timer = null;

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? p;

const width = (s) => {
  let w = 0;
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0) ?? 0;
    w += cp < 0x1100 || (cp >= 0x2000 && cp < 0x2c00) ? 1 : 2;
  }
  return w;
};

const fit = (s, max) => {
  if (width(s) <= max) return s;
  let out = '';
  for (const ch of String(s ?? '')) {
    if (width(out + ch) > max - 1) break;
    out += ch;
  }
  return `${out}…`;
};

const firstCommand = (cmd) => {
  const raw = String(cmd ?? '');
  const part = raw.split(/&&|\|\||;|\|/).map((s) => s.trim()).find((s) => s && !/^cd\s/.test(s));
  const word = (part ?? raw).split(/\s+/).find((w) => w && !/^\w+=/.test(w));
  return base(word ?? 'sh');
};

const describeTool = (tool, a) => {
  const str = (k) => (typeof a[k] === 'string' ? a[k] : '');
  switch (tool) {
    case 'Read': {
      const f = base(str('file_path'));
      return { scene: 'meadow', label: f, say: `翻阅草丛卷轴 [${f}]`, after: `${f} 读毕` };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const f = base(str('file_path') || str('notebook_path'));
      return { scene: 'forge', label: f, say: `淬火锻打源码 [${f}]`, after: `${f} 锻造完成` };
    }
    case 'Write': {
      const f = base(str('file_path'));
      return { scene: 'forge', label: f, say: `炉火熔铸新卷 [${f}]`, after: `${f} 铸造完成` };
    }
    case 'Bash': {
      const c = firstCommand(str('command'));
      return { scene: 'rail', label: c, say: `操纵工坊矿车 [${c}]`, after: `${c} 运抵终点` };
    }
    case 'Grep': {
      const p = str('pattern');
      return { scene: 'cave', label: p, say: `提灯搜寻矿脉 [${p}]`, after: `矿脉探明` };
    }
    case 'Glob':
      return { scene: 'cave', label: str('pattern'), say: `洞窟探寻矿图`, after: `矿图定位` };
    case 'WebSearch':
      return { scene: 'space', label: str('query'), say: `跃入星轨检索 [${str('query')}]`, after: `星图检索完成` };
    case 'WebFetch': {
      let host = 'web';
      try {
        host = new URL(str('url')).hostname;
      } catch {}
      return { scene: 'space', label: host, say: `星际穿梭跃迁 [${host}]`, after: `${host} 穿梭完成` };
    }
    case 'Agent':
    case 'Task':
      return {
        scene: 'sea',
        label: str('subagent_type') || 'agent',
        say: `远洋扬帆调度旗舰 [${str('subagent_type') || 'agent'}]`,
        after: `舰队回报捷报`,
      };
    case 'Skill':
      return { scene: 'sea', label: str('skill'), say: `升起战旗调度技能 [${str('skill')}]`, after: `技能完成` };
    case 'ToolSearch':
      return { scene: 'cave', label: 'tools', say: `洞窟探寻工具宝箱`, after: `宝箱开启` };
    default: {
      const name = tool.split('__').pop() ?? tool;
      return { scene: tool.startsWith('mcp__') ? 'space' : 'meadow', label: name, say: `调度工坊工装 [${name}]`, after: `${name} 调度完毕` };
    }
  }
};

const setAct = ($, next) => {
  act = next;
  typed = 0;
  $.ui.invalidate('ui.render');
};

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    readings = [];
    totalInput = 0;
    totalOutput = 0;
    totalThinking = 0;
    totalCacheRead = 0;
    totalCacheWrite = 0;
    recordedTurns.clear();
    lastRate = null;
    lastTtft = null;
    activeTurnPureTokens = 0;
    activeTurnPureMs = 0;
    lastForecastWord = null;
    petAlert = null;
    typed = 0;
    mount = null;
    act = { id: nextId++, scene: 'meadow', say: '营地小憩 · 守望气象', label: '', at: Date.now() };

    timer?.cancel?.();
    timer = null;
    let tickCount = 0;
    try {
      timer = $.clock.every(TICK_MS, () => {
        tickCount++;
        // 每约 1.5 秒自动同步一次上下文最新读数，保证 compact 等操作后即时感知
        if (tickCount % 20 === 0) {
          void takeReading($);
        }
        if (!mount) return;
        if (typed < Array.from(act.say).length) {
          typed += 1;
          $.ui.invalidate('ui.render');
          return;
        }
        const now = Date.now();
        void $.ui.blit({ requestId: mount.requestId, key: KEY, cells: paint(mount, act, now, now - EPOCH) });
      });
    } catch {}

    await takeReading($);
    return result;
  });

  on('session.measure', async ($, e, next) => {
    const result = await next(e);
    if (e.context) {
      applyContextReading(e.context);
    }
    return result;
  });

  on('prompt.submit', ($, e, next) => {
    void takeReading($);
    activeTurnPureTokens = 0;
    activeTurnPureMs = 0;
    const say = pick(['思考中… 规划航线', '正在审阅委托卷轴', '点亮灯火，准备出发']);
    setAct($, { id: nextId++, scene: pick(['meadow', 'space', 'sea']), say, label: '', at: Date.now() });
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    const info = describeTool(e.tool, e.input || {});
    const who = e.agentId ? '僚机' : '';
    setAct($, { id: nextId++, scene: info.scene, say: who + info.say, label: info.label, at: Date.now() });
    const mine = act.id;
    try {
      const result = await next(e);
      if (act.id === mine) {
        setAct($, { ...act, id: nextId++, say: who + info.after });
      }
      return result;
    } catch (err) {
      throw err;
    }
  });

  // 监听纯模型流式生成步骤，精确计算纯流式输出吞吐与首字延迟 (TTFT)
  on('turn.step', async function* ($, e, next) {
    const t0 = performance.now();
    let firstTokenTime = null;
    let lastTokenTime = null;
    let chunkCount = 0;
    let r = undefined;

    const gen = next(e);
    while (true) {
      const item = await gen.next();
      if (item.done) {
        r = item.value;
        break;
      }
      const val = item.value;
      const now = performance.now();
      if (val && (val.kind === "text" || val.kind === "thinking" || val.kind === "input" || val.kind === "tool")) {
        if (firstTokenTime === null) {
          firstTokenTime = now;
          const stepTtft = now - t0;
          if (stepTtft >= 5) {
            lastTtft = lastTtft === null ? stepTtft : 0.7 * stepTtft + 0.3 * lastTtft;
          }
        }
        lastTokenTime = now;
        chunkCount++;
      }
      yield val;
    }

    if (r && r.usage && typeof r.usage.output_tokens === "number" && r.usage.output_tokens > 0) {
      const tokens = r.usage.output_tokens;
      if (firstTokenTime !== null && lastTokenTime !== null && (lastTokenTime - firstTokenTime) >= 30 && chunkCount > 1) {
        const streamMs = lastTokenTime - firstTokenTime;
        activeTurnPureTokens += tokens;
        activeTurnPureMs += streamMs;
      } else {
        const stepMs = performance.now() - t0;
        if (stepMs >= 30) {
          activeTurnPureTokens += tokens;
          activeTurnPureMs += stepMs;
        }
      }
    }

    return r;
  });

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;

    const isNewTurn = !e.turnId || !recordedTurns.has(e.turnId);
    if (e.turnId) recordedTurns.add(e.turnId);

    if (isNewTurn && e.usage) {
      const u = e.usage;
      const uncached = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
      const cacheCreate = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0;
      const cacheRead = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
      const out = typeof u.output_tokens === 'number' ? u.output_tokens : 0;

      const details = u.output_tokens_details;
      const think = (details && typeof details.thinking_tokens === 'number')
        ? details.thinking_tokens
        : (typeof u.thinking_tokens === 'number' ? u.thinking_tokens : 0);

      totalInput += (uncached + cacheCreate + cacheRead);
      totalOutput += out;
      totalThinking += think;
      totalCacheRead += cacheRead;
      totalCacheWrite += cacheCreate;

      let currentTurnRate = null;
      if (activeTurnPureTokens > 0 && activeTurnPureMs > 0) {
        currentTurnRate = activeTurnPureTokens / (activeTurnPureMs / 1000);
      } else if (out > 0 && typeof e.durationMs === 'number' && e.durationMs > 0) {
        currentTurnRate = out / (e.durationMs / 1000);
      }

      if (currentTurnRate !== null && currentTurnRate > 0) {
        if (lastRate === null) {
          lastRate = currentTurnRate;
        } else {
          // EWMA 指数移动平均平滑滤波：长输出(>50 tokens)高置信度权重(0.75)，短响应保持平滑稳定性(0.35)
          const tokenCount = activeTurnPureTokens > 0 ? activeTurnPureTokens : out;
          const alpha = tokenCount >= 50 ? 0.75 : 0.35;
          lastRate = alpha * currentTurnRate + (1 - alpha) * lastRate;
        }
      }
      activeTurnPureTokens = 0;
      activeTurnPureMs = 0;
    }

    if (petAlert && typeof petAlert.remainingTurns === 'number') {
      petAlert.remainingTurns -= 1;
      if (petAlert.remainingTurns <= 0) {
        petAlert = null;
      }
    }

    // 单轮任务结束后自动退出思考中状态，回归常态守望
    if (!petAlert) {
      act = {
        ...act,
        id: nextId++,
        scene: act.scene,
        say: '回答完毕 · 守望天色',
        label: '',
        at: Date.now(),
      };
      typed = 0;
    }

    await takeReading($);
    return result;
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.hasSurvey || (e.props && e.props.hasSurvey)) {
      return next(e);
    }
    if (readings.length === 0) {
      void takeReading($);
      readings.push({ tokens: 0, window: 200_000, percent: 0 });
    }
    const { Box, Text, Raster } = $.ui.resolve(e);
    const bodyCols = e.props?.bodyColumns ?? e.bodyColumns ?? e.viewport?.columns ?? 80;
    const W = Math.min(bodyCols, 512);

    return renderTheaterWithWeather(Box, Text, Raster, W, e.requestId);
  });
}

function applyContextReading(context) {
  if (!context || !context.window) return;
  const tokens = context.tokens ?? 0;
  const percent = Math.round(context.percent ?? (tokens / context.window) * 100);
  if (tokens > 0) {
    readings = readings.filter((r) => r.tokens > 0);
  }
  readings.push({ tokens, window: context.window, percent });
  if (readings.length > HISTORY) readings = readings.slice(-HISTORY);

  const curForecast = forecastFor(percent);
  if (lastForecastWord !== null && lastForecastWord !== curForecast.word) {
    const oldIdx = FORECAST.findIndex((item) => item.word === lastForecastWord);
    const newIdx = FORECAST.findIndex((item) => item.word === curForecast.word);
    const direction = newIdx >= oldIdx ? 'up' : 'down';
    const adviceInfo = PET_ADVICE[curForecast.word] || PET_ADVICE['晴朗'];
    const advice = direction === 'up' ? adviceInfo.up : adviceInfo.down;

    petAlert = {
      from: lastForecastWord,
      to: curForecast.word,
      color: curForecast.color,
      direction,
      percent,
      tokens,
      window: context.window,
      advice,
      remainingTurns: 2,
    };

    const isGoodNews = direction === 'down';
    const alertTitle = isGoodNews ? '放晴喜讯' : '气象警报';
    act = {
      id: nextId++,
      scene: curForecast.word === '亟待压缩' ? 'forge' : act.scene,
      say: `[${alertTitle}]: ${lastForecastWord}➔${curForecast.word}(${percent}%) 💡建议: ${advice}`,
      label: `${percent}%`,
      at: Date.now(),
    };
    typed = 0;
  }
  lastForecastWord = curForecast.word;
}

async function takeReading($) {
  try {
    const usage = await $.session.usage();
    const context = usage?.context ?? usage;
    applyContextReading(context);
    $.ui.invalidate('ui.render');
  } catch {}
}

function renderTheaterWithWeather(Box, Text, Raster, W, requestId) {
  const now = readings[readings.length - 1] ?? { tokens: 0, window: 200_000, percent: 0 };
  const f = forecastFor(now.percent);
  const trend = trendWord();

  // 极窄屏降级仅显示上下文进度
  if (W < 45) {
    mount = null;
    return Box({
      flexDirection: "column",
      width: W,
      children: [
        Box({
          flexDirection: "row",
          width: W,
          children: [
            Text({ color: f.color, bold: true, children: `${f.icon}  ${f.word}` }),
            ...renderProgressBar(Text, now.percent, now.tokens),
            Text({ color: f.color, bold: true, children: `  ${now.percent}%` }),
            Text({ children: " context" }),
            Text({ dimColor: true, children: `  ${short(now.tokens)} / ${short(now.window)}` }),
          ],
        }),
      ],
    });
  }

  // === 左侧: 2行高迷你方块小方蟹 (8列宽度，4像素高) ===
  const CRAB_W = 8;
  mount = { requestId, W: CRAB_W, R: ROWS, crabX: 0 };
  const currentTime = Date.now();
  const cells = paint(mount, act, currentTime, currentTime - EPOCH);

  const crabBox = Box({
    width: CRAB_W,
    height: ROWS,
    children: [
      Raster({ key: KEY, columns: CRAB_W, rows: ROWS, cells }),
    ],
  });

  const rightW = Math.max(10, W - CRAB_W);

  // === 第 1 行 (右侧上): 螃蟹百分比与言语台词 ===
  const line1Parts = [
    Text({ color: f.color, bold: true, children: ` ${now.percent}%` }),
  ];

  if (act.say) {
    const chars = Array.from(act.say);
    const shown = (typed > 0 && typed < chars.length) ? chars.slice(0, typed).join('') : act.say;
    const isAlert = act.say.includes('警报') || act.say.includes('喜讯');
    const textColor = isAlert ? f.color : "#de7356";
    const availW = Math.max(10, rightW - 10);
    line1Parts.push(Text({ dimColor: true, children: "  💬 " }));
    line1Parts.push(Text({ color: textColor, children: fit(shown, availW) }));
  }

  const row1 = Box({ flexDirection: "row", width: rightW, children: line1Parts });

  // === 第 2 行 (右侧下): 气象状态、多阶暗轨进度条、上下文容量、累计指标与走势图 ===
  const line2Parts = [
    Text({ color: f.color, bold: true, children: ` ${f.icon} ${f.word}` }),
  ];

  const barParts = renderProgressBar(Text, now.percent, now.tokens);
  line2Parts.push(...barParts);

  line2Parts.push(Text({ children: " " }));
  line2Parts.push(Text({ dimColor: true, children: `${short(now.tokens)} / ${short(now.window)}` }));
  line2Parts.push(Text({ children: " context" }));

  if (rightW >= 60 && (totalInput > 0 || totalOutput > 0)) {
    line2Parts.push(Text({ dimColor: true, children: "  ∑ 累计输入 " }));
    line2Parts.push(Text({ color: "cyan", bold: true, children: short(totalInput) }));
    line2Parts.push(Text({ dimColor: true, children: " 累计输出 " }));
    line2Parts.push(Text({ color: "green", bold: true, children: short(totalOutput) }));

    if (totalThinking > 0) {
      line2Parts.push(Text({ dimColor: true, children: " 推理 " }));
      line2Parts.push(Text({ color: "magenta", bold: true, children: short(totalThinking) }));
    }
    const hitRate = Math.round((totalCacheRead / totalInput) * 100);
    line2Parts.push(Text({ dimColor: true, children: " 命中 " }));
    line2Parts.push(Text({ color: "cyan", children: `${hitRate}%` }));
  }

  if (rightW >= 60 && lastRate !== null && lastRate > 0) {
    line2Parts.push(Text({ color: "yellow", bold: true, children: `  ⚡ ${rate(lastRate)}/s` }));
    if (lastTtft !== null && lastTtft > 0 && rightW >= 75) {
      line2Parts.push(Text({ dimColor: true, children: " (首字 " }));
      line2Parts.push(Text({ color: "cyan", children: formatTtft(lastTtft) }));
      line2Parts.push(Text({ dimColor: true, children: ")" }));
    }
  }

  if (rightW >= 75) {
    line2Parts.push(Text({ dimColor: true, children: "  近几轮 " }));
    line2Parts.push(Text({ color: f.color, children: chart() }));
    if (trend) {
      line2Parts.push(Text({ dimColor: true, children: ` ${trend}` }));
    }
  }

  const row2 = Box({ flexDirection: "row", width: rightW, children: line2Parts });

  const rightBox = Box({ flexDirection: "column", width: rightW, height: ROWS, children: [row1, row2] });

  return Box({ flexDirection: "row", width: W, height: ROWS, children: [crabBox, rightBox] });
}

function renderProgressBar(Text, percent, tokens) {
  const parts = [Text({ color: TRACK_COLOR, children: "  [" })];
  const filledCount = tokens > 0 ? Math.min(BAR_WIDTH, Math.max(1, Math.round((percent / 100) * BAR_WIDTH))) : 0;

  if (filledCount > 0) {
    let currentColor = null;
    let currentRun = 0;

    for (let i = 0; i < filledCount; i++) {
      const slotPct = (i + 0.5) * (100 / BAR_WIDTH);
      const color = forecastFor(slotPct).color;
      if (color === currentColor) {
        currentRun++;
      } else {
        if (currentColor !== null && currentRun > 0) {
          parts.push(Text({ color: currentColor, children: "▰".repeat(currentRun) }));
        }
        currentColor = color;
        currentRun = 1;
      }
    }
    if (currentColor !== null && currentRun > 0) {
      parts.push(Text({ color: currentColor, children: "▰".repeat(currentRun) }));
    }
  }

  const emptyCount = BAR_WIDTH - filledCount;
  if (emptyCount > 0) {
    parts.push(Text({ color: TRACK_COLOR, children: "▱".repeat(emptyCount) }));
  }

  parts.push(Text({ color: TRACK_COLOR, children: "]" }));
  return parts;
}

function forecastFor(percent) {
  return FORECAST.find((band) => percent < band.upTo) ?? FORECAST[FORECAST.length - 1];
}

function chart() {
  const top = Math.max(...readings.map((r) => r.tokens), 1);
  const bars = readings.map((r) => BARS[Math.min(BARS.length - 1, Math.floor((r.tokens / top) * (BARS.length - 1)))]);
  return bars.join("");
}

function trendWord() {
  if (readings.length < 2) return "";
  const delta = readings[readings.length - 1].tokens - readings[readings.length - 2].tokens;
  if (delta > 0) return `▲ +${short(delta)}/轮`;
  if (delta < 0) return `▼ ${short(-delta)}/轮`;
  return "持平";
}

function short(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

function rate(r) {
  if (r >= 1000) return `${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k`;
  return r >= 100 ? r.toFixed(0) : r.toFixed(1);
}

function formatTtft(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 1000).toFixed(2)}s`;
}
