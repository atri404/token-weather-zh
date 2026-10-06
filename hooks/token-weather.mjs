// Copyright 2026 Anthropic PBC / atri404
// SPDX-License-Identifier: Apache-2.0
//
// Token Weather 汉化增强版 + Claude 橙色小方蟹 (Claw'd Desk Pet):
// 1. 上下文窗口实时天气预报、多阶分段彩色进度条 (参考 claude-deck segments 样式: ▰ ▱ 与暗轨色)、
//    全会话累计输入/输出/推理/命中率、真实模型输出速率 (基于流式 step 纯生成耗时)、历史趋势走势图。
// 2. 融入《crab-theater》Claude 官方橙色方块吉祥物 (Claw'd): 100% 本地 0 Token 额外开销状态机。
//    - 采用 Anthropic 官方 Terracotta 暖橙色 (#de7356) 与方块小蟹专属字符造型;
//    - 原作者同款 6 大场景主题与专属色谱 (meadow, forge, rail, cave, space, sea);
//    - 步伐姿态与微表情随轮次交替;
//    - 一旦上下文颜色/阶梯发生变动，宠物立即弹出专属警报/喜讯看板，播报占用并给出专业针对性建议！

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const BAR_WIDTH = 10;
const TRACK_COLOR = "#3a3936"; // 参考 claude-deck 深度暗轨底色

// Claude 官方标志性 Terracotta 陶土暖橙色 (Anthropic Brand Mascot)
const CLAUDE_CRAB_COLOR = "#de7356";

// 原作者《crab-theater》6 大场景专属标牌调色盘 (SIGN palette)
const SCENE_PALETTE = {
  meadow: { border: "#9aa0a6", text: "#e6c07b" }, // 草原采风: 银灰草茎 / 麦浪暖金
  forge:  { border: "#ff6a2a", text: "#ffb066" }, // 熔炉锻造: 炽烈炉火 / 锻打灼金
  rail:   { border: "#ff5577", text: "#ff8fa8" }, // 铁道工坊: 工坊轨道 / 霓虹粉光
  cave:   { border: "#b07a4a", text: "#e0b33a" }, // 洞窟探宝: 岩壁深赭 / 矿脉原金
  space:  { border: "#8d6be8", text: "#b9a3ff" }, // 星际穿梭: 星轨深紫 / 跃迁淡紫
  sea:    { border: "#4aa3d8", text: "#9fd3f0" }, // 远洋扬帆: 蔚蓝海潮 / 浪花透青
  camp:   { border: "#9aa0a6", text: "#e6c07b" }, // 营地小憩: 营帐银灰 / 篝火暖金
};

// 天气分档与阶梯色彩映射: 按上下文占用百分比 (<25% 绿, <50% 青, <75% 黄, <90% 洋红, ≥90% 红)
const FORECAST = [
  { upTo: 25, icon: "☀", word: "晴朗", color: "green" },
  { upTo: 50, icon: "☁", word: "多云", color: "cyan" },
  { upTo: 75, icon: "☂", word: "阵雨", color: "yellow" },
  { upTo: 90, icon: "☇", word: "风暴", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "亟待压缩", color: "red" },
];

// 本地建议与 Claude 橙色方块小蟹表情字典（纯本地，0 Token 开销）
const PET_ADVICE = {
  "晴朗": {
    up: "空间极度充裕！尽情思考与编写，无需顾虑上下文负担~",
    down: "乌云散去，晴空万里！上下文精炼释放回绿区健康水位，轻装上阵！",
    faceUp: "(\\/)[•‿•](\\/)",
    faceDown: "٩(\\/)[◕‿◕](\\/)۶",
  },
  "多云": {
    up: "状态平稳健康，记忆脉络清晰，探索与多文件协作正常推进。",
    down: "呼~ 内存大扫除成功！上下文降回到多云安全区，记忆整齐。",
    faceUp: "(\\/)[•‿•](\\/)",
    faceDown: "٩(\\/)[^‿^](\\/)و",
  },
  "阵雨": {
    up: "降雨警觉！占用已过半。避免全量倾倒超大文件或冗余日志，多用精准定位与局部阅读。",
    down: "水位回落至阵雨区，注意继续保持节奏，按需读取资料。",
    faceUp: "(\\/)[°o°](\\/)",
    faceDown: "(\\/)[•-•](\\/)",
  },
  "风暴": {
    up: "强风暴来袭！上下文较为紧张，建议尽快收尾交付当前子任务，防范信息过载。",
    down: "从红区回落至风暴区，虽脱离极度危险，仍需注意控制上下文体量。",
    faceUp: "(\\/)[°д°](\\/)",
    faceDown: "(\\/)[•_•;](\\/)",
  },
  "亟待压缩": {
    up: "⚠️ 紧急红警！临近上下文上限，强烈建议输入 /compact 进行记忆精简压缩，防止早期关键信息被截断！",
    down: "⚠️ 依然处于临界红区，建议随时执行 /compact 压缩会话。",
    faceUp: "🚨(\\/)[°Д°](\\/)",
    faceDown: "🚨(\\/)[°Д°](\\/)",
  },
};

// 历史占用读数: { tokens, window, percent }, 旧 -> 新
let readings = [];
// 会话累计统计
let totalInput = 0;       // 总输入 = 未缓存输入 + 缓存写入 + 缓存读取
let totalOutput = 0;      // 总输出
let totalThinking = 0;    // 推理思考 token
let totalCacheRead = 0;   // 缓存命中的输入

// 模型输出速率统计
let lastRate = null;              // 供渲染展示的 tokens/s
let activeTurnPureTokens = 0;      // 当前轮次内各 step 实际生成的纯 token 累加
let activeTurnPureMs = 0;          // 当前轮次内各 step 实际流式消耗的纯毫秒数累加

// 上一次记录的天气等级对象
let lastForecastWord = null;
// 宠物变动提醒对象: { from, to, color, direction, percent, tokens, window, advice, face, remainingTurns }
let petAlert = null;
// 宠物当前场景状态: { key, scene, face, action, sign }
let currentPetStatus = {
  key: "camp",
  scene: "营地小憩",
  face: "(\\/)[–‿–]旦(\\/)",
  action: "守望天色 · 待命中",
  sign: "",
};
// 轮次计数器，用于伴生宠物步态交替
let turnCounter = 0;

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    readings = [];
    totalInput = 0;
    totalOutput = 0;
    totalThinking = 0;
    totalCacheRead = 0;
    lastRate = null;
    activeTurnPureTokens = 0;
    activeTurnPureMs = 0;
    lastForecastWord = null;
    petAlert = null;
    turnCounter = 0;
    currentPetStatus = {
      key: "camp",
      scene: "营地小憩",
      face: "(\\/)[–‿–]旦(\\/)",
      action: "守望天色 · 待命中",
      sign: "",
    };
    await takeReading($);
    return result;
  });

  on("tool.call", async ($, e, next) => {
    try {
      currentPetStatus = parseToolToScene(e, turnCounter);
    } catch {
      // 忽略解析异常
    }
    return next(e).catch((err) => {
      throw err;
    });
  });

  // 监听纯模型流式生成步骤，通过 chunk 时间戳精准计算纯流式速率，彻底剥离网络握手、TTFT、思考延迟与工具执行
  on("turn.step", async function* ($, e, next) {
    const t0 = Date.now();
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
      const now = Date.now();
      if (val && (val.kind === "text" || val.kind === "thinking" || val.kind === "input" || val.kind === "tool")) {
        if (firstTokenTime === null) {
          firstTokenTime = now;
        }
        lastTokenTime = now;
        chunkCount++;
      }
      yield val;
    }

    if (r && r.usage && typeof r.usage.output_tokens === "number" && r.usage.output_tokens > 0) {
      const tokens = r.usage.output_tokens;
      // 优先从首个 token 到末尾 token 的纯流式跨度计算（彻底排除 TTFT 与网络首包握手延迟）
      if (firstTokenTime !== null && lastTokenTime !== null && (lastTokenTime - firstTokenTime) >= 30 && chunkCount > 1) {
        const streamMs = lastTokenTime - firstTokenTime;
        activeTurnPureTokens += tokens;
        activeTurnPureMs += streamMs;
      } else {
        // 若单包返回未产生足够多 chunk 间隔，则回退到当前 step 本身的总耗时（仍完全排除任何工具调用与外部命令）
        const stepMs = Date.now() - t0;
        if (stepMs >= 30) {
          activeTurnPureTokens += tokens;
          activeTurnPureMs += stepMs;
        }
      }
    }

    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) {
      return result;
    }
    turnCounter++;

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

      // 速率计算: 优先采用当前轮次内流式 step 精确测得的加权纯生成吞吐，否则优雅回退
      if (activeTurnPureTokens > 0 && activeTurnPureMs > 0) {
        lastRate = activeTurnPureTokens / (activeTurnPureMs / 1000);
      } else if (out > 0 && typeof e.durationMs === "number" && e.durationMs > 0) {
        lastRate = out / (e.durationMs / 1000);
      }
      activeTurnPureTokens = 0;
      activeTurnPureMs = 0;
    }

    // 变色告警提示保留 2 轮后自动平稳转为常态
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

// 融入《crab-theater》6 大场景主题与 Claude 橙色方块吉祥物动作映射
function parseToolToScene(e, count) {
  const stepMod = count % 2 === 0;
  if (!e || !e.tool) {
    return {
      key: "camp",
      scene: "营地小憩",
      face: stepMod ? "(\\/)[–‿–]旦(\\/)" : "(\\/)[•‿•]旦(\\/)",
      action: "营地小憩喝茶 · 守望气象",
      sign: "",
    };
  }

  const baseName = (p) => String(p ?? "").split("/").filter(Boolean).pop() || "";

  switch (e.tool) {
    case "Read": {
      const file = baseName(e.input?.file_path);
      return {
        key: "meadow",
        scene: "草原采风",
        face: stepMod ? "(\\/)[•‿•](\\/)" : "(\\/)[^‿^](\\/)",
        action: "翻阅草丛卷轴",
        sign: file ? `[${file}]` : "",
      };
    }
    case "Edit":
    case "Write":
    case "NotebookEdit": {
      const file = baseName(e.input?.file_path ?? e.input?.notebook_path);
      return {
        key: "forge",
        scene: "熔炉锻造",
        face: stepMod ? "(\\/)[•‿•]🔨(\\/)" : "(\\/)[^‿^](\\/)",
        action: "淬火锻打源码",
        sign: file ? `[${file}]` : "",
      };
    }
    case "Bash": {
      const rawCmd = String(e.input?.command ?? "").trim();
      const firstPart = rawCmd.split(/&&|\|\||;|\|/).map((s) => s.trim()).find((s) => s && !/^cd\s/.test(s)) || rawCmd;
      const cmd = firstPart.split(/\s+/).find((w) => w && !/^\w+=/.test(w)) || "sh";
      const shortCmd = baseName(cmd);
      return {
        key: "rail",
        scene: "铁道工坊",
        face: stepMod ? "(\\/)[•o•]⚡(\\/)" : "(\\/)[•‿•](\\/)",
        action: "操纵工坊矿车",
        sign: shortCmd ? `[${shortCmd}]` : "",
      };
    }
    case "Grep":
    case "Glob":
    case "ToolSearch": {
      const q = String(e.input?.pattern ?? e.input?.query ?? "").slice(0, 16);
      return {
        key: "cave",
        scene: "洞窟探宝",
        face: stepMod ? "(\\/)[•ω•]🔍(\\/)" : "(\\/)[•‿•](\\/)",
        action: "提灯探测矿脉",
        sign: q ? `["${q}"]` : "",
      };
    }
    case "WebSearch":
    case "WebFetch": {
      let host = String(e.input?.url ?? e.input?.query ?? "").replace(/^https?:\/\//, "").slice(0, 20);
      try {
        if (e.input?.url) host = new URL(e.input.url).hostname;
      } catch {}
      return {
        key: "space",
        scene: "星际穿梭",
        face: stepMod ? "(\\/)[^‿^]🌌(\\/)" : "(\\/)[•‿•](\\/)",
        action: "跃入星轨检索",
        sign: host ? `[${host}]` : "",
      };
    }
    case "Agent":
    case "Skill": {
      const sub = String(e.input?.subagent_type ?? e.input?.skill ?? "agent");
      return {
        key: "sea",
        scene: "远洋扬帆",
        face: stepMod ? "٩(\\/)[◕‿◕](\\/)۶" : "(\\/)[•‿•]⛵(\\/)",
        action: "乘风调度智能体",
        sign: `[${sub}]`,
      };
    }
    default:
      return {
        key: "meadow",
        scene: "工匠工坊",
        face: "(\\/)[•‿•](\\/)",
        action: `调度工具 ${e.tool}`,
        sign: "",
      };
  }
}

function renderWeatherAndPet(Box, Text, columns) {
  const now = readings[readings.length - 1];
  const f = forecastFor(now.percent);
  const trend = trendWord();

  // === 第 1 行: 气象横幅与多阶彩色进度条 (Segments 风格) ===
  const line1Parts = [
    // 1. 天气图标与状态词 (高亮阶梯色)
    Text({ color: f.color, bold: true, children: `${f.icon}  ${f.word}` }),
  ];

  // 2. 多阶分段彩色进度条 (参考 claude-deck segments 样式: ▰ ▱ 与暗轨色)
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

  // === 第 2 行: Claude 橙色方块吉祥物伴生看板 (Claw'd Desk Pet) ===
  // 极窄屏（< 60 列）精简为单行显示
  if (columns < 60) {
    return Box({ flexDirection: "column", paddingX: 1, children: [row1] });
  }

  const line2Parts = [];
  if (petAlert) {
    // 触发颜色变动！弹出高亮气象警报/喜讯看板与专业建议
    const isGoodNews = petAlert.direction === "down";
    const titleTag = isGoodNews ? "气象放晴喜讯" : "气象变动警报";
    // 官方 Claude 橙色吉祥物造型
    line2Parts.push(Text({ color: CLAUDE_CRAB_COLOR, bold: true, children: `${petAlert.face} ` }));
    line2Parts.push(Text({ color: petAlert.color, bold: true, children: `[${titleTag}]: ` }));
    line2Parts.push(Text({ color: petAlert.color, children: `${petAlert.from} ➔ ${petAlert.to} (${petAlert.percent}% · ${short(petAlert.tokens)}/${short(petAlert.window)}) ` }));
    line2Parts.push(Text({ color: petAlert.color, bold: true, children: "💡 建议: " }));
    line2Parts.push(Text({ dimColor: true, children: petAlert.advice }));
  } else {
    // 常态守护看板: Claude 橙色方块小蟹 + 原作场景色标牌 + 动作解说 + 专属高亮道具
    const palette = SCENE_PALETTE[currentPetStatus.key] || SCENE_PALETTE.meadow;
    line2Parts.push(Text({ color: CLAUDE_CRAB_COLOR, bold: true, children: `${currentPetStatus.face} ` }));
    line2Parts.push(Text({ color: palette.border, bold: true, children: `${currentPetStatus.scene}: ` }));
    line2Parts.push(Text({ dimColor: true, children: currentPetStatus.action }));
    if (currentPetStatus.sign) {
      line2Parts.push(Text({ color: palette.text, bold: true, children: ` ${currentPetStatus.sign}` }));
    }
    line2Parts.push(Text({ dimColor: true, children: ` · 气象${f.word}` }));
    if (now.percent >= 75) {
      line2Parts.push(Text({ color: f.color, bold: true, children: " (注意控制上下文体积)" }));
    }
  }

  const row2 = Box({ flexDirection: "row", children: line2Parts });

  return Box({ flexDirection: "column", paddingX: 1, children: [row1, row2] });
}

// 参考 claude-deck 的 segments 样式: ▰ ▱ 与暗轨底色 #3a3936，彻底告别刺眼灰色
function renderProgressBar(Text, percent, tokens) {
  // 两端括号采用暗轨色，优雅自然
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
    // 未占用部分使用暗轨色 TRACK_COLOR 与空心分段符 ▱，完美融入终端底色
    parts.push(Text({ color: TRACK_COLOR, children: "▱".repeat(emptyCount) }));
  }

  parts.push(Text({ color: TRACK_COLOR, children: "]" }));
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
