import { describe, expect, test } from 'claude-code/testing'

// 插件的 register(on) 已由测试运行器自动加载。
// 测试函数内的 on(...) 注册在插件下方，作为模拟底座。

describe('token-weather-zh', () => {
  test('主循环各轮填入横幅:读数、累计输入输出、缓存命中率、输出速率', async ($, on) => {
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
    on('turn.complete', ($e, e) => ({ text: e.answer }))
    on('ui.render', ($e, e) => null)
    on('ui.invalidate', ($e, e, next) => {
      invalidates.push(e.event)
      return next(e)
    })

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    tokens = 30_000
    // 第 1 轮: 输入 20k(其中 15k 来自缓存命中), 输出 5k, 耗时 10s
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
        model: 'claude-sonnet-4-6',
      },
    })
    tokens = 80_000
    // 第 2 轮: 输入 80k(其中 65k 来自缓存命中), 输出 25k, 耗时 20s
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
        model: 'claude-sonnet-4-6',
      },
    })

    expect(invalidates).toContain('ui.render')

    // 宽屏 (100 列)
    const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', bodyColumns: 100, props: {} })
    const texts = JSON.stringify(tree)

    // 总输入: 20k + 80k = 100k
    // 总输出: 5k + 25k = 30k
    // 总缓存读取: 15k + 65k = 80k -> 命中率 80%
    expect(texts).toContain('40% 上下文')
    expect(texts).toContain('80k / 200k')
    expect(texts).toContain('∑ 入 100k 出 30k 命中 80%')
    expect(texts).toContain('⚡')
    expect(texts).toContain('/s')
    expect(texts).toContain('近几轮')
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

    // 窄屏 (55 列)
    const narrowTree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', bodyColumns: 55, props: {} })
    const narrowTexts = JSON.stringify(narrowTree)

    expect(narrowTexts).toContain('晴朗')
    expect(narrowTexts).toContain('20% 上下文')
    expect(narrowTexts).not.toContain('近几轮')
    expect(narrowTexts).not.toContain('∑ 入')
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

    expect(texts).not.toContain('∑ 入')
  })
})
