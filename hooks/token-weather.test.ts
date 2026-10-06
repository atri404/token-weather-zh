import { describe, expect, test } from 'claude-code/testing'

// 插件的 register(on) 已由测试运行器自动加载。
// 测试函数内的 on(...) 注册在插件下方，作为模拟底座。

describe('token-weather-zh', () => {
  test('主循环各轮填入横幅:多阶进度条、context、累计输入输出、推理、缓存命中率、输出速率与桌面宠物', async ($, on) => {
    let window = 200_000
    let tokens = 0
    const invalidates: string[] = []

    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window, tokens, percent: Math.round((tokens / window) * 100) },
        rateLimits: [],
      },
    }))
    on('session.start', ($e, e) => ({ cwd: e.cwd }))
    on('tool.call', ($e, e) => ({ result: { content: 'mock content' } }))
    on('turn.complete', ($e, e) => ({ text: e.answer }))
    on('ui.render', ($e, e) => null)
    on('ui.invalidate', ($e, e, next) => {
      invalidates.push(e.event)
      return next(e)
    })

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    // 模拟调用工具 Read
    await $.tool.call({ tool: 'Read', input: { file_path: '/tmp/test.ts' } })

    tokens = 30_000
    // 第 1 轮: 输入 20k(其中 15k 来自缓存命中), 输出 5k, 推理 1.5k, 耗时 10s
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 10_000,
      turnId: 't1',
      usage: {
        input_tokens: 5000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 15_000,
        output_tokens: 5000,
        output_tokens_details: {
          thinking_tokens: 1500,
        },
        model: 'claude-sonnet-4-6',
      },
    })
    tokens = 80_000
    // 第 2 轮: 输入 80k(其中 65k 来自缓存命中), 输出 25k, 推理 8k, 耗时 20s
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 20_000,
      turnId: 't2',
      usage: {
        input_tokens: 10_000,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 65_000,
        output_tokens: 25_000,
        output_tokens_details: {
          thinking_tokens: 8000,
        },
        model: 'claude-sonnet-4-6',
      },
    })

    expect(invalidates).toContain('ui.render')

    // 宽屏 (110 列)
    const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', bodyColumns: 110, props: {} })
    const texts = JSON.stringify(tree)

    // 进度条与 context
    expect(texts).toContain('[')
    expect(texts).toContain('█')
    expect(texts).toContain('░')
    expect(texts).toContain(']')
    expect(texts).toContain('40%')
    expect(texts).toContain('context')
    expect(texts).toContain('80k / 200k')

    // 彩色累计输入输出与推理
    expect(texts).toContain('∑ 累计输入')
    expect(texts).toContain('100k')
    expect(texts).toContain('累计输出')
    expect(texts).toContain('30k')
    expect(texts).toContain('推理')
    expect(texts).toContain('9.5k')
    expect(texts).toContain('命中')
    expect(texts).toContain('80%')
    expect(texts).toContain('⚡')
    expect(texts).toContain('/s')
    expect(texts).toContain('近几轮')

    // 桌面宠物伴生
    expect(texts).toContain('🦀')
    expect(texts).toContain('小蟹')
  })

  test('颜色阶梯改变时，桌面宠物触发气象变动告警与针对性建议', async ($, on) => {
    let window = 200_000
    let tokens = 20_000 // 10% (晴朗 green)

    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window, tokens, percent: Math.round((tokens / window) * 100) },
        rateLimits: [],
      },
    }))
    on('session.start', ($e, e) => ({ cwd: e.cwd }))
    on('turn.complete', ($e, e) => ({ text: e.answer }))
    on('ui.render', ($e, e) => null)

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    // 第一轮完成时，当前为晴朗 (10%)
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 2000,
      turnId: 't1',
      usage: { input_tokens: 1000, output_tokens: 500 },
    })

    // 下一轮剧烈增加到 120_000 (60% -> 阵雨 yellow，发生颜色改变！)
    tokens = 120_000
    await $.turn.complete({
      reason: 'answer',
      answer: 'heavy work done',
      durationMs: 5000,
      turnId: 't2',
      usage: { input_tokens: 50_000, output_tokens: 2000 },
    })

    const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', bodyColumns: 100, props: {} })
    const texts = JSON.stringify(tree)

    // 验证桌面宠物变色气象提醒与建议触发
    expect(texts).toContain('[气象变动]')
    expect(texts).toContain('阵雨')
    expect(texts).toContain('60%')
    expect(texts).toContain('120k / 200k')
    expect(texts).toContain('建议:')
    expect(texts).toContain('避免全量')
  })

  test('窄屏模式自适应降级显示', async ($, on) => {
    let window = 200_000
    let tokens = 40_000

    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window, tokens, percent: 20 },
        rateLimits: [],
      },
    }))
    on('session.start', ($e, e) => ({ cwd: e.cwd }))
    on('turn.complete', ($e, e) => ({ text: e.answer }))
    on('ui.render', ($e, e) => null)

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 5_000,
      turnId: 't1',
      usage: {
        input_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 2000,
        model: 'claude-sonnet-4-6',
      },
    })

    // 极窄屏 (55 列)
    const narrowTree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', bodyColumns: 55, props: {} })
    const narrowTexts = JSON.stringify(narrowTree)

    expect(narrowTexts).toContain('晴朗')
    expect(narrowTexts).toContain('20%')
    expect(narrowTexts).toContain('context')
    expect(narrowTexts).toContain('[')
    expect(narrowTexts).toContain(']')
    expect(narrowTexts).not.toContain('近几轮')
    expect(narrowTexts).not.toContain('∑ 累计输入')
  })

  test('子 agent 的轮次不改变横幅', async ($, on) => {
    const window = 200_000
    const tokens = 10_000

    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window, tokens, percent: 5 },
        rateLimits: [],
      },
    }))
    on('session.start', ($e, e) => ({ cwd: e.cwd }))
    on('turn.complete', ($e, e) => ({ text: e.answer }))
    on('ui.render', ($e, e) => null)

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    await $.turn.complete({
      reason: 'answer',
      answer: 'subagent report',
      durationMs: 5_000,
      turnId: 't-sub',
      agentId: 'agent-1',
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 9_999,
        model: 'claude-sonnet-4-6',
      },
    })

    const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', bodyColumns: 100, props: {} })
    const texts = JSON.stringify(tree)

    expect(texts).not.toContain('∑ 累计输入')
  })
})
