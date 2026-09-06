/**
 * Pull-request tools (B5-P4): availability, duplicate guard, and creation
 * over `ctx.pullRequest` (the provider capability — the user's logged-in gh,
 * never a token). Creation is an explicit external write: it requires user
 * approval and a writable session. Presenters are pure functions of args.
 * @module @see-sol-lab/deepseekgui-coding-tools/pr-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  cardTitle,
  cwdOf,
  writableCwd,
  json,
  requireApproval,
  text,
  type ToolExec,
} from './index.ts'

function availabilityText(value: unknown): string {
  const v = value as { available?: boolean; auth?: { host?: string; account?: string }; reason?: string }
  return v.available === true
    ? `pull requests available: ${String(v.auth?.account ?? '')} @ ${String(v.auth?.host ?? '')}`
    : `pull requests unavailable: ${String(v.reason ?? 'unknown')}`
}

function existingText(value: unknown): string {
  const v = value as { found?: boolean; url?: string; number?: number }
  if (v.found !== true) return 'no existing pull request for this head'
  return `existing pull request #${String(v.number ?? '')}: ${v.url ?? ''}`
}

function createdText(value: unknown): string {
  const v = value as { url?: string; number?: number }
  return `pull request created: #${String(v.number ?? '')} ${v.url ?? ''}`
}

/** Register the pull-request toolset. */
export function registerPrTools(ctx: Context): void {
  const pullRequest = ctx.pullRequest

  ctx.tools.register(defineTool({
    name: 'pr_availability',
    description: 'Report whether pull requests can be created from the repository containing `cwd`: the provider login facts (host and account —'
      + 'never a token) or the reason creation is unavailable. Read-only.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(availabilityText(value)),
    },
    presentCall(args: { cwd?: string }) {
      return { card: 'generic', title: cardTitle('pr_availability', args.cwd) }
    },
    async execute(args: { cwd?: string }, exec: ToolExec) {
      return json(await pullRequest.availability(cwdOf(args.cwd, exec)))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pr_existing',
    description: 'Find an existing pull request whose head is the given branch in the repository containing `cwd` (duplicate-creation guard).'
      + 'Read-only; resolves to nothing when no PR exists.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      head: { type: 'string', required: true, description: 'The head branch to look up' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(existingText(value)),
    },
    presentCall(args: { cwd?: string; head?: string }) {
      return { card: 'generic', title: cardTitle('pr_existing', args.cwd, String(args.head ?? '')) }
    },
    async execute(args: { cwd?: string; head: string }, exec: ToolExec) {
      const existing = await pullRequest.existing(cwdOf(args.cwd, exec), args.head)
      return existing === undefined ? { found: false } : json({ found: true, url: existing.url, number: existing.number })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pr_create',
    description: 'Create a pull request from the repository containing `cwd` through the logged-in provider. Explicit external write: refused'
      + 'without explicit user approval, in read-only sessions, when the provider is unavailable, or when the head branch already has a'
      + 'PR. Never sends a token.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      title: { type: 'string', required: true, description: 'Pull request title (the user approves this exact text)' },
      body: { type: 'string', required: true, description: 'Pull request body' },
      base: { type: 'string', required: true, description: 'Base branch (the target of the pull request)' },
      head: { type: 'string', required: true, description: 'Head branch (your changes)' },
      draft: { type: 'boolean', description: 'Create as a draft pull request' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(createdText(value)),
    },
    presentCall(args: { cwd?: string; title?: string }) {
      return { card: 'generic', title: cardTitle('pr_create', args.cwd, String(args.title ?? '')) }
    },
    async execute(args: { cwd?: string; title: string; body: string; base: string; head: string; draft?: boolean }, exec: ToolExec) {
      const cwd = await writableCwd(ctx, exec, args.cwd, 'pr_create')
      await requireApproval(ctx, exec, 'pr_create', `Create pull request "${args.title}" (${args.base} <- ${args.head}) in ${cwd}?`)
      return json(await pullRequest.create(cwd, {
        title: args.title,
        body: args.body,
        base: args.base,
        head: args.head,
        draft: args.draft === true,
      }))
    },
  }))
}
