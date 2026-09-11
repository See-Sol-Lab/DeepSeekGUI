/**
 * DeepSeekGUI coding-tools plugin (B5-P4): Git status/diff, index writes,
 * guarded commit, push preview/push, and pull-request tools over the dsh git
 * and pull-request capabilities.
 *
 * Ownership rules:
 * - Every tool calls an existing capability (`ctx.git` / `ctx.pullRequest`);
 *   no git, process, or provider logic is re-implemented here.
 * - Model-visible parameters and results flow through the official tool
 *   registry, so they land in the DSH Session log.
 * - Index writes (stage/unstage) and repository writes (revert/commit/push)
 *   and PR creation refuse in a read-only session and request explicit user
 *   approval before any write; the model can prepare and explain, never
 *   authorize.
 * @module @see-sol-lab/deepseekgui-coding-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { relative, isAbsolute, resolve, sep } from 'node:path'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
// Type-only: pulls the service merges into this program (ctx.git,
// ctx.pullRequest, ctx.sandboxPolicy, ctx.approval).
import type {} from '@deepseek-ai/dsh-git'
import type {} from '@deepseek-ai/dsh-pull-request'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import { registerGitTools } from './git-tools.ts'
import { registerPrTools } from './pr-tools.ts'

/** Execution identity available inside a tool body. */
export type ToolExec = { agent?: Agent; callId: ToolCallId; signal: AbortSignal }

/** Effective sandbox mode; a missing policy service fails safe to read-only. */
/**
 * Resolve a repository whose root is writable under the calling session policy.
 * @param ctx - Git and sandbox policy services.
 * @param exec - Calling session and cancellation signal.
 * @param explicitCwd - Optional addressed directory.
 * @param toolName - Tool named in a refusal.
 * @returns the canonical repository root used by the write.
 */
export async function writableCwd(ctx: Context, exec: ToolExec, explicitCwd: string | undefined, toolName: string): Promise<string> {
  exec.signal.throwIfAborted()
  let policy = ctx.sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
  if (policy === undefined || policy.mode === 'read-only') {
    throw new Error(`${toolName} refused: this session is read-only`)
  }
  const repo = await ctx.git.repoIdentity(cwdOf(explicitCwd, exec))
  policy = ctx.sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
  if (policy === undefined || policy.mode === 'read-only') throw new Error(`${toolName} refused: this session is read-only`)
  const root = canonicalPath(repo.root)
  if (policy.mode === 'workspace-write' && !writableRoots(policy).some((grant) => {
    const suffix = relative(grant, root)
    return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  })) throw new Error(`${toolName} refused: repository ${root} is outside the writable workspace`)
  exec.signal.throwIfAborted()
  return root
}

/**
 * Resolve the addressed repository working directory: an explicit `cwd`
 * argument (a relative one is taken against the Session cwd, not the
 * Harness process cwd), else the agent's Session header cwd; a session
 * without one refuses so the caller passes an explicit cwd. A directory
 * that does not exist is refused here by name: Node reports a missing cwd
 * as `spawn git ENOENT`, which the git seam would otherwise misreport as
 * "git is unavailable" (acceptance 2026-09-06).
 * @param cwd - the tool's optional cwd argument.
 * @param exec - execution identity.
 * @param exists - directory probe (injectable for tests).
 * @returns the working directory.
 */
export function cwdOf(cwd: string | undefined, exec: ToolExec, exists: (path: string) => boolean = existsSync): string {
  const sessionCwd = exec.agent?.session?.header?.cwd
  let target: string
  if (cwd !== undefined && cwd !== '') {
    target = isAbsolute(cwd) || sessionCwd === undefined ? cwd : resolve(sessionCwd, cwd)
  } else {
    if (sessionCwd === undefined) {
      throw new Error('no working directory: pass cwd, or run inside a session that has one')
    }
    target = sessionCwd
  }
  if (!exists(target)) throw new Error(`working directory does not exist: ${target}`)
  return target
}

/** One model-facing text block. */
export function text(value: string): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: value }]
}

/** Capability results are JSON-safe machine values; the tool output face is a JSON record. */
export function json(value: unknown): Record<string, JsonValue> {
  return value as Record<string, JsonValue>
}

/** Short human title for call/result cards (pure: only args; an unset cwd shows as `<session-cwd>`). */
export function cardTitle(tool: string, cwd: string | undefined, detail = ''): string {
  return `${tool} ${cwd ?? '<session-cwd>'}${detail === '' ? '' : ` ${detail}`}`
}

/**
 * Request one explicit user approval for a writing action. Missing approval
 * service or agent fails closed (throws), exactly like a rejection.
 * @param ctx - plugin context carrying the approval service.
 * @param exec - execution identity.
 * @param toolName - the tool asking.
 * @param reason - human-readable action summary the approval card shows.
 * @returns resolution after the user approved.
 */
export async function requireApproval(ctx: Context, exec: ToolExec, toolName: string, reason: string, cwd: string): Promise<void> {
  exec.signal.throwIfAborted()
  const approval = ctx.approval
  if (approval === undefined || exec.agent === undefined) {
    throw new Error(`${toolName} refused: no approval channel is available (fail closed)`)
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(`${toolName} refused: the user did not approve this action`)
  }
  exec.signal.throwIfAborted()
  if (await writableCwd(ctx, exec, cwd, toolName) !== canonicalPath(cwd)) {
    throw new Error(`${toolName} refused: the repository changed while approval was pending`)
  }
}

/** Required services. */
export const inject = ['tools', 'git', 'pullRequest', 'sandboxPolicy', 'approval']

/**
 * Register the coding toolset.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  registerGitTools(ctx)
  registerPrTools(ctx)
}
