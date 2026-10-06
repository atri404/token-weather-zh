// Copyright 2026 Anthropic PBC / atri404
// SPDX-License-Identifier: Apache-2.0
//
// Token Weather 汉化增强版: 上下文窗口实时天气预报（显示在提示符上方）
//
// turn.complete: 每轮主循环结束后读取 $.session.usage() 更新上下文占用;
//                并从 e.usage 累计会话生成 token, 按 e.durationMs 测量模型输出速率。
// session.start: 会话启动时先采样一次, 保证首轮前即有预报。
// ui.render (AbovePrompt): 单行渲染:
//                天气图标 + 预报词 + 上下文百分比 + 占用/上限
//                + 会话累计 token + 模型输出速率 + 近期趋势图 + 变动差值。

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
// 会话累计输出 token 数 (每轮 output_tokens 累加)
let totalOutput = 0;
// 最新一轮的模型输出速率 (tokens/s)
let lastRate = null;

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    readings = [];
    totalOutput = 0;
    lastRate = null;
    await takeReading($);
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) {
      return result;
    }
    if (e.usage && typeof e.usage.output_tokens === "number" && e.usage.output_tokens > 0) {
      totalOutput += e.usage.output_tokens;
      if (typeof e.durationMs === "number" && e.durationMs > 0) {
        lastRate = e.usage.output_tokens / (e.durationMs / 1000);
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
  if (columns >= 65) {
    if (totalOutput > 0) {
      parts.push(Text({ dimColor: true, children: `  ∑ 累计 ${short(totalOutput)}` }));
    }
    if (lastRate !== null && lastRate > 0) {
      parts.push(Text({ dimColor: true, children: `  ⚡ ${rate(lastRate)}/s` }));
    }
  }

  // 宽屏额外展示趋势走势图
  if (columns >= 85) {
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
