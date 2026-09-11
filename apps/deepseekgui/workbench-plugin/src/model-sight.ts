/**
 * Tell the model whether the model it is running as can see images
 * (莉莉丝 2026-09-11 manual test #24).
 *
 * The user switches models inside one conversation. A text-only model has
 * no way to notice that from the inside: the official composer refuses an
 * image attachment for it ("this model does not support image input"), but
 * the browser screenshot tool still captures and saves the file, and the
 * model then "looks" at it several times, reads the error, and concludes
 * the tool is broken. The capability fact already exists — the catalog's
 * `inputModalities`, the same field that composer gate reads — so this
 * module puts it in front of the model instead of keeping a model list of
 * its own.
 *
 * Delivery: one dynamic prompt context, decided per step from the model the
 * step will actually use. The host assembles the prompt before every model
 * step; the selected provider/model pair lands in `assembly.variables` from
 * the agent-scoped selection listener, which runs INSIDE this one (waterfall
 * listeners compose in registration order and this plugin registers at
 * load, before any agent exists). Runtime contexts are projected into the
 * history as a user-role snapshot only when their text changes, so the note
 * is written once, and again right after a switch — never every step.
 *
 * Capability lookups are asynchronous; the listener reads a cache filled
 * from the catalogs at load and from `resolveModelInfo` on the first miss.
 * A step that misses says nothing rather than guessing; the next one says it.
 * @module @see-sol-lab/deepseekgui-workbench/model-sight
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/** Name of the projected context (shows up in the runtime-context sections). */
export const MODEL_SIGHT_CONTEXT_NAME = 'deepseekgui:model-sight'

/** What one lookup established about a model. */
export interface ModelSight {
  /** Display name from the catalog (the id when the provider names it so). */
  readonly name: string
  /**
   * Whether the model accepts image input; `undefined` when the provider
   * declares no modalities (the composer gate lets images through then, so
   * this note stays silent rather than claiming blindness).
   */
  readonly seesImages: boolean | undefined
}

/** The catalog fields this module reads per model. */
export interface CatalogModelSight {
  readonly id: string
  readonly name: string
  readonly inputModalities?: readonly string[]
}

/** The slice of the LLM runtime this module reads. */
export interface ModelSightSource {
  listProviders(): readonly { readonly id: string }[]
  listModels(provider: string): Promise<readonly CatalogModelSight[]>
  resolveModelInfo(provider: string, model: string): Promise<{ readonly name: string; readonly inputModalities?: readonly string[] }>
}

const keyOf = (provider: string, model: string): string => `${provider}\n${model}`

/**
 * The note for one model. Text-only models are told how to act, not just
 * what they lack: the failing behaviour was retrying, and the fix is asking.
 * @param sight - the model's capability.
 * @param sighted - catalog names of models that do accept images, for the hint.
 * @returns the context text, or '' when nothing is known.
 */
export function modelSightText(sight: ModelSight, sighted: readonly string[]): string {
  if (sight.seesImages === undefined) return ''
  if (sight.seesImages) {
    return `Current model: ${sight.name} — it accepts images. Screenshots and image attachments are readable to you.`
  }
  const alternatives = sighted.length === 0 ? '' : ` (in this setup: ${sighted.join(', ')})`
  // 莉莉丝 2026-09-11 第三轮：光"知道自己看不了"不够——它知道了却接着用文本
  // 工具往下干，用户根本没机会换模型。看网站/看图这类请求要先停下来问。
  return [
    `Current model: ${sight.name} — it does NOT accept images (text only).`,
    'A browser screenshot still saves a file, but you cannot read its content; image attachments are rejected for this model.',
    `If the user asks you to look at a website, a page, a screenshot or a picture, STOP before touching the browser: say in one sentence that this model cannot see images and ask whether to switch to a model with image input${alternatives}. Only continue with text tools (browser_snapshot) if the user says text is enough.`,
    'Do not retry the screenshot.',
  ].join(' ')
}

/**
 * Register the per-step model-sight context.
 * @param ctx - plugin host context with `systemPrompt` and `llm` available.
 * @param llm - the LLM runtime slice (injectable for tests).
 * @returns disposer removing the listener.
 */
export function registerModelSight(ctx: Context, llm: ModelSightSource): () => void {
  const known = new Map<string, ModelSight | null>()
  const sightedByProvider = new Map<string, string[]>()
  const pending = new Set<string>()

  const learnCatalog = async (provider: string): Promise<void> => {
    try {
      const models = await llm.listModels(provider)
      const sighted: string[] = []
      for (const model of models) {
        const seesImages = model.inputModalities === undefined ? undefined : model.inputModalities.includes('image')
        known.set(keyOf(provider, model.id), { name: model.name, seesImages })
        if (seesImages === true) sighted.push(model.name)
      }
      sightedByProvider.set(provider, sighted)
    } catch {
      // A provider that cannot list stays unknown; per-model lookups still run.
    }
  }
  const learnModel = async (provider: string, model: string): Promise<void> => {
    const key = keyOf(provider, model)
    if (pending.has(key)) return
    pending.add(key)
    try {
      const info = await llm.resolveModelInfo(provider, model)
      known.set(key, {
        name: info.name,
        seesImages: info.inputModalities === undefined ? undefined : info.inputModalities.includes('image'),
      })
    } catch {
      // Unknown model: say nothing rather than guess; retry on a later step.
      known.set(key, null)
      setTimeout(() => { known.delete(key) }, 60_000).unref()
    } finally {
      pending.delete(key)
    }
  }

  for (const provider of llm.listProviders()) void learnCatalog(provider.id)

  return ctx.on('system-prompt/assemble', async (_assembly, _context, next): Promise<PromptAssembly> => {
    const assembled = await next()
    const { provider, model } = assembled.variables
    if (provider === undefined || model === undefined) return assembled
    const key = keyOf(provider, model)
    if (!known.has(key)) {
      void learnModel(provider, model)
      return assembled
    }
    const sight = known.get(key)
    if (sight === null || sight === undefined) return assembled
    const text = modelSightText(sight, sightedByProvider.get(provider) ?? [])
    if (text === '') return assembled
    return { ...assembled, contexts: [...assembled.contexts, { name: MODEL_SIGHT_CONTEXT_NAME, text }] }
  })
}
