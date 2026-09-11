/**
 * Model-sight note (2026-09-11 manual test #24): the prompt tells the model
 * whether the model of THIS step accepts images, follows a mid-conversation
 * switch, and stays silent rather than guessing.
 * @module @see-sol-lab/deepseekgui-workbench/tests/model-sight
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { SystemPrompt, renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import { MODEL_SIGHT_CONTEXT_NAME, modelSightText, registerModelSight, type ModelSightSource } from '../src/model-sight.ts'

const catalog = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', inputModalities: ['text', 'image'] },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text'] },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision-Exp', inputModalities: ['text', 'image'] },
]

function fakeLlm(): ModelSightSource & { resolveModelInfo: ReturnType<typeof vi.fn> } {
  return {
    listProviders: () => [{ id: 'deepseek' }],
    listModels: async () => catalog,
    resolveModelInfo: vi.fn(async (_provider: string, model: string) => {
      if (model === 'mystery') return { name: 'mystery' }
      if (model === 'boom') throw new Error('no such model')
      return { name: model, inputModalities: ['text'] }
    }),
  }
}

async function harness() {
  const ctx = new Context()
  const promptFiber = await ctx.plugin(SystemPrompt, {})
  const llm = fakeLlm()
  const dispose = registerModelSight(ctx, llm)
  // Let the catalog pre-warm settle.
  await new Promise(resolve => setTimeout(resolve, 0))
  // The selection listener writes the route into the assembly's variables;
  // two plain variables stand in for it here.
  const route: { provider?: string; model?: string } = {}
  ctx.systemPrompt.variable('provider', () => route.provider)
  ctx.systemPrompt.variable('model', () => route.model)
  const assemble = async (model: string, provider = 'deepseek') => {
    route.provider = provider
    route.model = model
    const sections = renderContextSections(await ctx.systemPrompt.assemble())
    return sections.find(section => section.name === MODEL_SIGHT_CONTEXT_NAME)?.text
  }
  return { ctx, llm, assemble, dispose, promptFiber }
}

describe('modelSightText', () => {
  it('names the sighted alternatives for a text-only model and says not to retry', () => {
    const text = modelSightText({ name: 'DeepSeek-V4-Flash', seesImages: false }, ['DeepSeek V4.1 Flash'])
    expect(text).toContain('does NOT accept images')
    expect(text).toContain('DeepSeek V4.1 Flash')
    expect(text).toContain('Do not retry')
    expect(text).toContain('STOP before touching the browser')
    expect(text).toContain('browser_snapshot')
  })
  it('is short and positive for a sighted model, and empty when unknown', () => {
    expect(modelSightText({ name: 'DeepSeek V4.1 Flash', seesImages: true }, [])).toContain('accepts images')
    expect(modelSightText({ name: 'x', seesImages: undefined }, [])).toBe('')
  })
})

describe('registerModelSight', () => {
  it('reads the route selected by the real Agent waterfall and follows a model switch', async () => {
    const { ctx, dispose, promptFiber } = await harness()
    const selection: ModelSelectionRef = { current: { provider: 'deepseek', model: 'deepseek-v4-flash' }, assembled: undefined }
    const disposeSelection = installModelSelection(ctx, selection)
    const disposePrepended = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembled = await next()
      return { ...assembled, contexts: [...assembled.contexts, { name: 'test:third-party', text: 'extra context' }] }
    }, { prepend: true })
    try {
      const first = await ctx.systemPrompt.assemble()
      expect(first.variables.model).toBe('deepseek-v4-flash')
      expect(first.contexts.some(section => section.name === 'test:third-party')).toBe(true)
      expect(first.contexts.find(section => section.name === MODEL_SIGHT_CONTEXT_NAME)?.text).toContain('does NOT accept images')
      selection.current = { provider: 'deepseek', model: 'deepseek-flash' }
      const next = await ctx.systemPrompt.assemble()
      expect(next.contexts.find(section => section.name === MODEL_SIGHT_CONTEXT_NAME)?.text).toContain('DeepSeek V4.1 Flash — it accepts images')
    } finally {
      disposePrepended()
      disposeSelection()
      dispose()
      await promptFiber.dispose()
    }
  })
  it('follows the model of each step from the catalog without a per-step lookup', async () => {
    const { llm, assemble, dispose, promptFiber } = await harness()
    try {
      expect(await assemble('deepseek-v4-flash')).toContain('DeepSeek-V4-Flash — it does NOT accept images')
      expect(await assemble('deepseek-v4-flash')).toContain('DeepSeek V4.1 Flash, DeepSeek-V4-Flash-Vision-Exp')
      expect(await assemble('deepseek-flash')).toContain('DeepSeek V4.1 Flash — it accepts images')
      expect(llm.resolveModelInfo).not.toHaveBeenCalled()
    } finally {
      dispose()
      await promptFiber.dispose()
    }
  })

  it('looks an uncatalogued model up once, says nothing on the miss, and stays silent for unknown modalities', async () => {
    const { llm, assemble, dispose, promptFiber } = await harness()
    try {
      expect(await assemble('custom-text')).toBeUndefined()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await assemble('custom-text')).toContain('custom-text — it does NOT accept images')
      expect(llm.resolveModelInfo).toHaveBeenCalledTimes(1)
      // No declared modalities: the composer gate lets images through, so no claim either way.
      expect(await assemble('mystery')).toBeUndefined()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await assemble('mystery')).toBeUndefined()
      // A failed lookup is not a claim.
      expect(await assemble('boom')).toBeUndefined()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await assemble('boom')).toBeUndefined()
    } finally {
      dispose()
      await promptFiber.dispose()
    }
  })

  it('contributes nothing without a selected route and nothing after dispose', async () => {
    const { ctx, assemble, dispose, promptFiber } = await harness()
    try {
      const sections = renderContextSections(await ctx.systemPrompt.assemble())
      expect(sections.some(section => section.name === MODEL_SIGHT_CONTEXT_NAME)).toBe(false)
      dispose()
      expect(await assemble('deepseek-v4-flash')).toBeUndefined()
    } finally {
      await promptFiber.dispose()
    }
  })
})
