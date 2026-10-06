// Copyright 2026 Anthropic PBC / atri404
// SPDX-License-Identifier: Apache-2.0
//
// Token Weather 汉化增强版: 上下文窗口实时天气预报（显示在提示符上方）
//
// turn.complete: 每轮主循环结束后读取 $.session.usage() 更新上下文占用;
//                并从 e.usage 累计输入、输出、推理、缓存读取, 计算命中率与输出速率。
// session.start: 会话启动时先采样一次, 保证首轮前即有预报。
// ui.render (AbovePrompt): 单行渲染:
//                天气图标 + 预报词 + 上下文百分比 + 占用/上限
//                + 累计输入/输出/推理/命中率 + 模型输出速率 + 近期趋势图 + 变动差值。

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";

// 天气分档: 按上下文占用百分比。全部采用单宽文本符号以保证终端对齐。
const FORECAST = [
  { upTo: 25, icon: "☀", word: "晴朗", color: "yellow" },
  { upTo: 50, icon: "☁", word: "多云", color: "cyan" },
  { upTo: 75, icon: "☂", word: "阵雨", color: "blue" },
  { upTo: 90, icon: "☇", word: "风暴", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "亟待压缩", color: "red" },
];

// 历史占用读数: { tokens, window, percent }, 旧 -> 新
let readings = [];
// 会话累计统计
let totalInput = 0;       // 总输入 = 未缓存输入 + 缓存写入 + 缓存读取
let totalOutput = 0;      // 总输出
let totalThinking = 0;    // 推理思考 token
let totalCacheRead = 0;   // 缓存命中的输入
// 最新一轮的模型输出速率 (tokens/s)
let lastRate = null;

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    readings = [];
    totalInput = 0;
    totalOutput = 0;
    totalThinking = 0;
    totalCacheRead = 0;
    lastRate = null;
    await takeReading($);
    return result;
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

      // 推理/思考 token：优先从 output_tokens_details.thinking_tokens 取，否则看 thinking_tokens
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
    await takeReading($);
    return result;
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (e.hasSurvey || readings.length === 0) {
      return next(e);
    }
    const { Box, Text } = $.ui.resolve(e);
    return band(Box, Text, e.bodyColumns ?? 80);
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
    $.ui.invalidate("ui.render");
  } catch {
    // 忽略取值异常，保留现有读数
  }
}

function band(Box, Text, columns) {
  const now = readings[readings.length - 1];
  const f = forecastFor(now.percent);
  const trend = trendWord();

  const parts = [
    Text({ color: f.color, bold: true, children: `${f.icon}  ${f.word}` }),
    Text({ children: `  ${now.percent}% 上下文` }),
    Text({ dimColor: true, children: `  ${short(now.tokens)} / ${short(now.window)}` }),
  ];

  // 中等宽度及以上展示累计和速率
  if (columns >= 68) {
    if (totalInput > 0 || totalOutput > 0) {
      let statStr = `  ∑ 输入 ${short(totalInput)} 输出 ${short(totalOutput)}`;
      if (totalThinking > 0) {
        statStr += ` 推理 ${short(totalThinking)}`;
      }
      if (totalInput > 0) {
        const hitRate = Math.round((totalCacheRead / totalInput) * 100);
        statStr += ` 命中 ${hitRate}%`;
      }
      parts.push(Text({ dimColor: true, children: statStr }));
    }
    if (lastRate !== null && lastRate > 0) {
      parts.push(Text({ dimColor: true, children: `  ⚡ ${rate(lastRate)}/s` }));
    }
  }

  // 宽屏额外展示趋势走势图
  if (columns >= 95) {
    parts.push(Text({ dimColor: true, children: "   近几轮 " }));
    parts.push(Text({ color: f.color, children: chart() }));
    if (trend) {
      parts.push(Text({ dimColor: true, children: `  ${trend}` }));
    }
  }

  return Box({ flexDirection: "row", paddingX: 1, children: parts });
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
