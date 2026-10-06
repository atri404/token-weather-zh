// Copyright 2026 Anthropic PBC / atri404
// SPDX-License-Identifier: Apache-2.0
//
// Token Weather 汉化增强版 + 终端伴生宠物 (Desk Pet):
// 1. 上下文窗口实时天气预报、多阶彩色进度条 (阶梯色彩)、全会话累计输入/输出/推理/命中率、输出速率、历史趋势图。
// 2. 融入《crab-theater》桌面宠物机制: 完全 0 Token 额外开销，纯本地运行。
//    - 监听工具调用与状态伴随;
//    - 一旦上下文颜色/阶梯发生变动，宠物立即冒泡提醒上下文占用并给出实用建议！

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const BAR_WIDTH = 10;

// 天气分档与阶梯色彩映射: 按上下文占用百分比 (<25% 绿, <50% 青, <75% 黄, <90% 洋红, ≥90% 红)
const FORECAST = [
  { upTo: 25, icon: "☀", word: "晴朗", color: "green" },
  { upTo: 50, icon: "☁", word: "多云", color: "cyan" },
  { upTo: 75, icon: "☂", word: "阵雨", color: "yellow" },
  { upTo: 90, icon: "☇", word: "风暴", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "亟待压缩", color: "red" },
];

// 本地建议与表情字典（纯本地，0 Token 开销）
const PET_ADVICE = {
  "晴朗": {
    up: "空间极度充裕！尽情思考与编写，无需顾虑上下文负担~",
    down: "乌云散去，晴空万里！上下文精炼释放回绿区健康水位，轻装上阵！",
    faceUp: "(V ◕‿◕ V)",
    faceDown: "٩(◕‿◕)۶",
  },
  "多云": {
    up: "状态平稳健康，记忆脉络清晰，探索与多文件协作正常推进。",
    down: "呼~ 内存整理成功！上下文降回到多云安全区，记忆整齐。",
    faceUp: "(V・ω・V)",
    faceDown: "٩(ˊᗜˋ*)و",
  },
  "阵雨": {
    up: "降雨警觉！占用已过半。避免全量倾倒超大文件或冗余日志，多用精准定位与局部阅读。",
    down: "水位回落至阵雨区，注意继续保持节奏，按需读取资料。",
    faceUp: "(V・o・V)",
    faceDown: "(V・-・V)",
  },
  "风暴": {
    up: "强风暴来袭！上下文较为紧张，建议尽快收尾交付当前子任务，防范信息过载。",
    down: "从红区回落至风暴区，虽脱离极度危险，仍需注意控制上下文体量。",
    faceUp: "(V°д°)V",
    faceDown: "(V;・_・V)",
  },
  "亟待压缩": {
    up: "⚠️ 紧急红警！临近上下文上限，强烈建议输入 /compact 进行记忆精简压缩，防止早期关键信息被截断！",
    down: "⚠️ 依然处于临界红区，建议随时执行 /compact 压缩会话。",
    faceUp: "🚨 ₍ノ°Д°₎ノ",
    faceDown: "🚨 ₍ノ°Д°₎ノ",
  },
};

// 历史占用读数: { tokens, window, percent }, 旧 -> 新
let readings = [];
// 会话累计统计
let totalInput = 0;       // 总输入 = 未缓存输入 + 缓存写入 + 缓存读取
let totalOutput = 0;      // 总输出
let totalThinking = 0;    // 推理思考 token
let totalCacheRead = 0;   // 缓存命中的输入
// 最新一轮的模型输出速率 (tokens/s)
let lastRate = null;

// 上一次记录的天气等级对象
let lastForecastWord = null;
// 宠物变动提醒对象: { from, to, color, direction, percent, tokens, window, advice, face, remainingTurns }
let petAlert = null;
// 最近一次调用的工具简述
let lastToolAction = "正在守望上下文天气";

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    readings = [];
    totalInput = 0;
    totalOutput = 0;
    totalThinking = 0;
    totalCacheRead = 0;
    lastRate = null;
    lastForecastWord = null;
    petAlert = null;
    lastToolAction = "正在守望上下文天气";
    await takeReading($);
    return result;
  });

  on("tool.call", async ($, e, next) => {
    try {
      lastToolAction = describeTool(e);
    } catch {
      // 忽略解析异常
    }
    return next(e).catch((err) => {
      throw err;
    });
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) {
      return result;
    }
    if (e.usage) {
      const uncached = typeof e.usage.input_tokens === "number" ? e.usage.input_tokens : 0;
      const cacheCreate = typeof e.usage.cache_creation_input_tokens === "number" ? e.usage.cache_creation_input_tokens : 0;
      const cacheRead = typeof e.usage.cache_read_input_tokens === "number" ? e.usage.cache_read_input_tokens : 0;
      const out = typeof e.usage.output_tokens === "number" ? e.usage.output_tokens : 0;

      // 推理/思考 token
      const details = e.usage.output_tokens_details;
      const think = (details && typeof details.thinking_tokens === "number")
        ? details.thinking_tokens
        : (typeof e.usage.thinking_tokens === "number" ? e.usage.thinking_tokens : 0);

      totalInput += (uncached + cacheCreate + cacheRead);
      totalOutput += out;
      totalThinking += think;
      totalCacheRead += cacheRead;

      if (out > 0 && typeof e.durationMs === "number" && e.durationMs > 0) {
        lastRate = out / (e.durationMs / 1000);
      }
    }

    // 变色告警提示保留 2 轮后自动转为常态
    if (petAlert && typeof petAlert.remainingTurns === "number") {
      petAlert.remainingTurns -= 1;
      if (petAlert.remainingTurns <= 0) {
        petAlert = null;
      }
    }

    await takeReading($);
    return result;
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (e.hasSurvey || readings.length === 0) {
      return next(e);
    }
    const { Box, Text } = $.ui.resolve(e);
    return renderWeatherAndPet(Box, Text, e.bodyColumns ?? 80);
  });
}

async function takeReading($) {
  try {
    const { context } = await $.session.usage();
    if (!context || !context.window) {
      return;
    }
    const tokens = context.tokens ?? 0;
    const percent = Math.round(context.percent ?? (tokens / context.window) * 100);
    // 过滤掉首轮尚未生成时的 0 读数
    readings = readings.filter((r) => r.tokens > 0);
    readings.push({ tokens, window: context.window, percent });
    if (readings.length > HISTORY) {
      readings = readings.slice(-HISTORY);
    }

    // 检查颜色/天气阶梯是否发生变动
    const curForecast = forecastFor(percent);
    if (lastForecastWord !== null && lastForecastWord !== curForecast.word) {
      const oldIdx = FORECAST.findIndex((item) => item.word === lastForecastWord);
      const newIdx = FORECAST.findIndex((item) => item.word === curForecast.word);
      const direction = newIdx >= oldIdx ? "up" : "down";
      const adviceInfo = PET_ADVICE[curForecast.word] || PET_ADVICE["晴朗"];
      const advice = direction === "up" ? adviceInfo.up : adviceInfo.down;
      const face = direction === "up" ? adviceInfo.faceUp : adviceInfo.faceDown;

      petAlert = {
        from: lastForecastWord,
        to: curForecast.word,
        color: curForecast.color,
        direction,
        percent,
        tokens,
        window: context.window,
        advice,
        face,
        remainingTurns: 2, // 持续提醒 2 轮
      };
    }
    lastForecastWord = curForecast.word;

    $.ui.invalidate("ui.render");
  } catch {
    // 忽略取值异常
  }
}

// 借鉴 crab-theater 的零开销本地场景/动作映射
function describeTool(e) {
  if (!e || !e.tool) return "正在待命";
  switch (e.tool) {
    case "Read":
      return "刚才阅览了代码文件";
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return "刚才打磨编辑了源码";
    case "Grep":
    case "Glob":
    case "ToolSearch":
      return "刚才穿行探测了工程文件";
    case "Bash":
      return "刚才在终端中执行了指令";
    case "WebSearch":
    case "WebFetch":
      return "刚才穿梭网络检索了资料";
    case "Agent":
    case "Skill":
      return "刚才调度协同了智能体";
    default:
      return `刚才调用了工具 ${e.tool}`;
  }
}

function renderWeatherAndPet(Box, Text, columns) {
  const now = readings[readings.length - 1];
  const f = forecastFor(now.percent);
  const trend = trendWord();

  // === 第 1 行: 气象横幅与多阶彩色进度条 ===
  const line1Parts = [
    // 1. 天气图标与状态词 (高亮阶梯色)
    Text({ color: f.color, bold: true, children: `${f.icon}  ${f.word}` }),
  ];

  // 2. 多阶彩色进度条 (按百分比区间独立着色: 绿 -> 青 -> 黄 -> 洋红 -> 红)
  const barParts = renderProgressBar(Text, now.percent, now.tokens);
  line1Parts.push(...barParts);

  // 3. 上下文百分比 (高亮阶梯色 + context 标签)
  line1Parts.push(Text({ color: f.color, bold: true, children: `  ${now.percent}%` }));
  line1Parts.push(Text({ children: " context" }));

  // 4. 当前/上限数值 (暗灰)
  line1Parts.push(Text({ dimColor: true, children: `  ${short(now.tokens)} / ${short(now.window)}` }));

  // 中等宽度及以上展示丰富累计与速率
  if (columns >= 65) {
    if (totalInput > 0 || totalOutput > 0) {
      line1Parts.push(Text({ dimColor: true, children: "  ∑ 累计输入 " }));
      line1Parts.push(Text({ color: "cyan", bold: true, children: short(totalInput) }));
      line1Parts.push(Text({ dimColor: true, children: " 累计输出 " }));
      line1Parts.push(Text({ color: "green", bold: true, children: short(totalOutput) }));

      if (totalThinking > 0) {
        line1Parts.push(Text({ dimColor: true, children: " 推理 " }));
        line1Parts.push(Text({ color: "magenta", bold: true, children: short(totalThinking) }));
      }
      if (totalInput > 0) {
        const hitRate = Math.round((totalCacheRead / totalInput) * 100);
        line1Parts.push(Text({ dimColor: true, children: " 命中 " }));
        line1Parts.push(Text({ color: "cyan", children: `${hitRate}%` }));
      }
    }
    if (lastRate !== null && lastRate > 0) {
      line1Parts.push(Text({ color: "yellow", bold: true, children: `  ⚡ ${rate(lastRate)}/s` }));
    }
  }

  // 宽屏额外展示趋势走势图与上一轮增量
  if (columns >= 90) {
    line1Parts.push(Text({ dimColor: true, children: "   近几轮 " }));
    line1Parts.push(Text({ color: f.color, children: chart() }));
    if (trend) {
      line1Parts.push(Text({ dimColor: true, children: `  ${trend}` }));
    }
  }

  const row1 = Box({ flexDirection: "row", children: line1Parts });

  // === 第 2 行: 桌面宠物伴生行 (Desk Pet) ===
  // 窄屏仅在中屏及宽屏渲染伴生行，避免挤压终端高度
  if (columns < 60) {
    return Box({ flexDirection: "column", paddingX: 1, children: [row1] });
  }

  const line2Parts = [];
  if (petAlert) {
    // 触发颜色变动！高亮提示气泡与建议
    line2Parts.push(Text({ color: petAlert.color, bold: true, children: `🦀 ${petAlert.face} 小蟹播报 [气象变动]: ` }));
    line2Parts.push(Text({ color: petAlert.color, children: `${petAlert.from} ➔ ${petAlert.to} (${petAlert.percent}% · ${short(petAlert.tokens)}/${short(petAlert.window)}) ` }));
    line2Parts.push(Text({ dimColor: true, children: `💡 建议: ${petAlert.advice}` }));
  } else {
    // 常态守护与状态伴随
    const defaultFace = "(V ◕‿◕ V)";
    line2Parts.push(Text({ color: f.color, children: `🦀 ${defaultFace} 小蟹守护: ` }));
    line2Parts.push(Text({ dimColor: true, children: `${lastToolAction} · 当前天气${f.word}` }));
    if (now.percent >= 75) {
      line2Parts.push(Text({ color: f.color, bold: true, children: " (注意控制上下文体积)" }));
    }
  }

  const row2 = Box({ flexDirection: "row", children: line2Parts });

  return Box({ flexDirection: "column", paddingX: 1, children: [row1, row2] });
}

// 多阶彩色进度条生成器: 按槽位对应阶梯独立上色
function renderProgressBar(Text, percent, tokens) {
  const parts = [Text({ dimColor: true, children: "  [" })];
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
          parts.push(Text({ color: currentColor, children: "█".repeat(currentRun) }));
        }
        currentColor = color;
        currentRun = 1;
      }
    }
    if (currentColor !== null && currentRun > 0) {
      parts.push(Text({ color: currentColor, children: "█".repeat(currentRun) }));
    }
  }

  const emptyCount = BAR_WIDTH - filledCount;
  if (emptyCount > 0) {
    parts.push(Text({ dimColor: true, children: "░".repeat(emptyCount) }));
  }

  parts.push(Text({ dimColor: true, children: "]" }));
  return parts;
}

function forecastFor(percent) {
  return FORECAST.find((band) => percent < band.upTo) ?? FORECAST[FORECAST.length - 1];
}

// 块状柱形按视口内最高轮次自动缩放
function chart() {
  const top = Math.max(...readings.map((r) => r.tokens), 1);
  const bars = readings.map((r) => BARS[Math.min(BARS.length - 1, Math.floor((r.tokens / top) * (BARS.length - 1)))]);
  return bars.join("");
}

function trendWord() {
  if (readings.length < 2) {
    return "";
  }
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
