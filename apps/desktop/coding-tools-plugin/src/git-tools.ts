/**
 * Git tool definitions (B5-P4): status/diff reads, index writes, guarded
 * commit, and push preview/push over `ctx.git`.
 *
 * Write actions (stage/unstage/revert/commit/push) refuse in a read-only
 * session; revert/commit/push additionally request explicit user approval
 * through the official approval service before any write. Every result is the
 * capability's canonical machine value; `output.render` produces the
 * model-facing text. Presenters are pure functions of the call args (they
 * never resolve the session cwd — display must stay replay-safe).
 * @module @see-sol-lab/deepseekgui-coding-tools/git-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffResult, PushPreview, RepoStatus } from '@deepseek-ai/dsh-git/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  cardTitle,
  cwdOf,
  writableCwd,
  json,
  requireApproval,
  text,
  type ToolExec,
} from './index.ts'

/**
 * Structured card projection for the status family.
 *
 * The official `presentationMeta` hook carries a replayable JSON projection of
 * the canonical value straight to the conversation card, so the client reads
 * fields instead of parsing the model-facing text `render` produced.
 * @param value - canonical capability value.
 * @returns Card fields: the head line plus per-entry state counts.
 */
function statusMeta(value: unknown): JsonValue {
  const v = value as RepoStatus
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflict: 0 }
  const entries = v.entries.map((e) => {
    counts[e.kind] += 1
    return { state: e.kind, path: e.path, origPath: e.origPath ?? null }
  })
  return {
    kind: 'git-status',
    clean: v.clean,
    head: `${v.head.kind === 'branch' ? 'on ' : `${v.head.kind} `}${v.head.name}`,
    upstream: v.upstream === undefined ? null : { ref: v.upstream.ref, ahead: v.upstream.ahead, behind: v.upstream.behind },
    counts: { ...counts, total: entries.length },
    entries,
  }
}

/**
 * Structured card projection for `git_diff`.
 * @param value - canonical capability value.
 * @returns Card fields: per-file line deltas.
 */
function diffMeta(value: unknown): JsonValue {
  const v = value as DiffResult
  return {
    kind: 'git-diff',
    files: v.files.map(f => ({
      path: f.path,
      origPath: f.origPath ?? null,
      binary: f.binary,
      added: f.addedLines ?? 0,
      deleted: f.deletedLines ?? 0,
    })),
  }
}

function statusText(value: unknown): string {
  const v = value as RepoStatus
  const head = v.head.kind === 'branch' ? `on ${v.head.name}` : `${v.head.kind} ${v.head.name}`
  const upstream = v.upstream === undefined ? '' : ` (upstream ${v.upstream.ref}, ahead ${v.upstream.ahead}, behind ${v.upstream.behind})`
  if (v.clean) return `clean ${head}${upstream}`
  return `${v.entries.length} changed path(s), ${head}${upstream}:\n${v.entries
    .map(e => `- ${e.kind} ${e.path}${e.origPath === undefined ? '' : ` (from ${e.origPath})`}`)
    .join('\n')}`
}

function diffText(value: unknown): string {
  const v = value as DiffResult
  const lines = v.files
    .map(f =>
      `- ${f.path}${f.origPath === undefined ? '' : ` (from ${f.origPath})`}`
      + (f.binary ? ' (binary)' : ` +${f.addedLines ?? 0} -${f.deletedLines ?? 0}`))
    .join('\n')
  const patch = v.patch === undefined
    ? ''
    : `\n\`\`\`diff\n${v.patch.replace(/```/gu, '\`\`\`')}\n\`\`\``
  return `${lines}${patch}`
}

function commitText(value: unknown): string {
  const v = value as { sha: string; treeMatchesExpected: boolean }
  return v.treeMatchesExpected
    ? `committed ${v.sha}`
    : `committed ${v.sha} (warning: committed tree differs from the reviewed snapshot — re-verify the repository state)`
}

function pushPreviewText(value: unknown): string {
  const v = value as PushPreview
  return [
    `remote ${v.remote.name}: ${v.remote.pushUrl ?? v.remote.fetchUrl}`,
    `local ${v.localBranch} (${v.sourceOid}) -> ${v.remoteBranch}`,
    `${v.aheadCommits.length} candidate commit(s)`,
    v.remoteRefExists === true ? 'remote ref exists' : v.remoteRefExists === false ? 'remote ref does NOT exist (push would create it)' : 'remote could not be queried (facts are local only)',
    v.credentialHelper === undefined ? 'no credential helper configured' : `credential helper: ${v.credentialHelper}`,
  ].join('\n')
}

function pushText(value: unknown): string {
  const v = value as { remote: string; remoteBranch: string; pushedSha: string }
  return `pushed ${v.remote}/${v.remoteBranch} -> ${v.pushedSha}`
}

/** Register the Git toolset. */
export function registerGitTools(ctx: Context): void {
  const git = ctx.git

  ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Read the complete work-tree state of the repository containing `cwd` (defaults to the session working directory): clean flag,'
      + 'HEAD, upstream, and every changed path (staged / unstaged / untracked / conflict). Read-only.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(statusText(value)),
      presentationMeta: (_args, value) => statusMeta(value),
    },
    presentCall(args: { cwd?: string }) {
      return { card: 'generic', title: cardTitle('git_status', args.cwd) }
    },
    async execute(args: { cwd?: string }, exec: ToolExec) {
      return json(await git.status(cwdOf(args.cwd, exec)))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Read the diff of one scope in the repository containing `cwd`: `unstaged` (work tree against index) or `staged` (index against'
      + 'HEAD). Optionally limit to one path and request the unified patch (bounded; ask for it after reviewing the summary). Read-only.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      scope: { type: 'string', enum: ['staged', 'unstaged'], required: true, description: 'Which side of the index to diff' },
      path: { type: 'string', description: 'Optional path relative to the repo root, limiting the diff to one path' },
      wantPatch: { type: 'boolean', description: 'When true, return the unified patch for the requested scope/path' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(diffText(value)),
      presentationMeta: (_args, value) => diffMeta(value),
    },
    presentCall(args: { cwd?: string; scope?: string; path?: string }) {
      const detail = [args.scope ?? 'unstaged', args.path ?? ''].filter(Boolean).join(' ')
      return { card: 'generic', title: cardTitle('git_diff', args.cwd, detail) }
    },
    async execute(args: { cwd?: string; scope: 'staged' | 'unstaged'; path?: string; wantPatch?: boolean }, exec: ToolExec) {
      const cwd = cwdOf(args.cwd, exec)
      return json(await git.diff(
        cwd,
        args.scope,
        args.path,
        args.wantPatch === true,
        args.wantPatch === true ? 512 * 1024 : undefined,
      ))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_stage',
    description: 'Stage one whole path into the index of the repository containing `cwd` (`git add` semantics: tracked modifications, renames, and'
      + 'untracked files alike). Returns the fresh authoritative status after the write. Refused in a read-only session.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      path: { type: 'string', required: true, description: 'Path relative to the repo root' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(`staged; ${statusText(value)}`),
      presentationMeta: (_args, value) => statusMeta(value),
    },
    presentCall(args: { cwd?: string; path?: string }) {
      return { card: 'generic', title: cardTitle('git_stage', args.cwd, String(args.path ?? '')) }
    },
    async execute(args: { cwd?: string; path: string }, exec: ToolExec) {
      const cwd = await writableCwd(ctx, exec, args.cwd, 'git_stage')
      await git.stageFile(cwd, args.path)
      return json(await git.status(cwd))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_unstage',
    description: 'Unstage one whole path: the index moves back toward HEAD and the work tree is untouched. A path with no staged changes is a'
      + 'no-op. Returns the fresh authoritative status. Refused in a read-only session.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      path: { type: 'string', required: true, description: 'Path relative to the repo root' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(`unstaged; ${statusText(value)}`),
      presentationMeta: (_args, value) => statusMeta(value),
    },
    presentCall(args: { cwd?: string; path?: string }) {
      return { card: 'generic', title: cardTitle('git_unstage', args.cwd, String(args.path ?? '')) }
    },
    async execute(args: { cwd?: string; path: string }, exec: ToolExec) {
      const cwd = await writableCwd(ctx, exec, args.cwd, 'git_unstage')
      await git.unstageFile(cwd, args.path)
      return json(await git.status(cwd))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_revert',
    description: 'Discard the unstaged modifications of one TRACKED path (restore from the index). Destructive: the work-tree changes are lost.'
      + 'Refused for untracked and conflict paths, in read-only sessions, and without explicit user approval. Returns the fresh status'
      + 'after the write.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      path: { type: 'string', required: true, description: 'Path relative to the repo root' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(`reverted; ${statusText(value)}`),
      presentationMeta: (_args, value) => statusMeta(value),
    },
    presentCall(args: { cwd?: string; path?: string }) {
      return { card: 'generic', title: cardTitle('git_revert', args.cwd, String(args.path ?? '')) }
    },
    async execute(args: { cwd?: string; path: string }, exec: ToolExec) {
      const cwd = await writableCwd(ctx, exec, args.cwd, 'git_revert')
      await requireApproval(ctx, exec, 'git_revert', `Revert ${args.path} in ${cwd}? Unstaged changes to this tracked file will be discarded.`)
      await git.revertFile(cwd, args.path)
      return json(await git.status(cwd))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_commit',
    description: 'Commit the staged tree of the repository containing `cwd` with the given message (delivered through stdin; any characters are'
      + 'safe). Refused without explicit user approval, and by git itself when conflicts are unresolved, the index is empty, or no author'
      + 'identity is configured. Returns the new commit SHA and whether its tree matches the pre-commit snapshot.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      message: { type: 'string', required: true, description: 'The commit message (the user approves this exact text)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(commitText(value)),
    },
    presentCall(args: { cwd?: string }) {
      return { card: 'generic', title: cardTitle('git_commit', args.cwd) }
    },
    async execute(args: { cwd?: string; message: string }, exec: ToolExec) {
      const cwd = await writableCwd(ctx, exec, args.cwd, 'git_commit')
      const expectedTree = await git.stagedTree(cwd)
      await requireApproval(ctx, exec, 'git_commit', `Commit staged tree ${expectedTree} in ${cwd} with message: ${args.message}`)
      return json(await git.commit(cwd, args.message, expectedTree))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_push_preview',
    description: 'Preview a push from the repository containing `cwd` without writing anything: remote URL, local branch, target remote ref, ahead'
      + 'commits, whether the remote ref exists, the default branch, and the credential helper. Read-only.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      remote: { type: 'string', required: true, description: 'The remote that would receive the push (e.g. origin)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(pushPreviewText(value)),
      presentationMeta: (_args, value) => {
        const preview = value as unknown as PushPreview
        return { remote: preview.remote.name, localBranch: preview.localBranch, remoteBranch: preview.remoteBranch }
      },
    },
    presentCall(args: { cwd?: string; remote?: string }) {
      return { card: 'generic', title: cardTitle('git_push_preview', args.cwd, String(args.remote ?? '')) }
    },
    async execute(args: { cwd?: string; remote: string }, exec: ToolExec) {
      return json(await git.pushPreview(cwdOf(args.cwd, exec), args.remote))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_push',
    description: 'Push one local branch to one remote branch (`git push <remote> <local>:<remoteBranch>`). Explicit external write: refused'
      + 'without explicit user approval, in read-only sessions, and for refused pushes (classified by git, nothing retried). Never'
      + 'configures upstream. Returns the remote ref\'s new SHA.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory inside the repository; defaults to the session working directory' },
      remote: { type: 'string', required: true, description: 'The remote to push to (e.g. origin)' },
      localBranch: { type: 'string', required: true, description: 'The local branch to push' },
      remoteBranch: { type: 'string', required: true, description: 'The remote branch ref to update' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(pushText(value)),
    },
    presentCall(args: { cwd?: string; remote?: string; localBranch?: string; remoteBranch?: string }) {
      return { card: 'generic', title: cardTitle('git_push', args.cwd, `${String(args.localBranch ?? '')} -> ${String(args.remoteBranch ?? '')}@${String(args.remote ?? '')}`) }
    },
    async execute(args: { cwd?: string; remote: string; localBranch: string; remoteBranch: string }, exec: ToolExec) {
      const cwd = await writableCwd(ctx, exec, args.cwd, 'git_push')
      const preview = await git.pushPreview(cwd, args.remote, args.localBranch, args.remoteBranch)
      const ahead = preview.aheadCommits.length
      const pushUrl = preview.remote.pushUrl ?? preview.remote.fetchUrl
      await requireApproval(ctx, exec, 'git_push', `Push ${args.localBranch} (${preview.sourceOid}) to ${args.remote}/${args.remoteBranch} (${ahead} candidate commit(s), remote ${pushUrl})?`)
      return json(await git.push(cwd, args.remote, args.localBranch, args.remoteBranch, { sourceOid: preview.sourceOid, pushUrl }))
    },
  }))
}
