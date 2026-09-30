/**
 * DeepSeekGUI (2026-09-29): the logic behind the `acl-helper` entry — a
 * workspace's sandbox marks, changed out of process. Granting or taking back
 * a workspace grant rewrites the root's DACL and label and Windows propagates
 * it through the whole tree: seconds for an ordinary repository, tens of
 * seconds for one with a large `node_modules`. Done inside the Harness that
 * would stall every session for as long, so the sandbox seam spawns the entry
 * and awaits it.
 *
 * `grant` adds the standing workspace grant (the call the seam used to make in
 * process); `revoke` takes it back ({@link AclWriteGrant.revokeStanding});
 * `purge` removes every mark whatever SID made it ({@link AclWriteGrant.purge}).
 * @module @deepseek-ai/dsh-sandbox-windows-acl/helper
 */

import { existsSync, statSync } from 'node:fs'
import { AclWriteGrant } from './grant.ts'
import { workspaceWriteSid } from './workspace-sid.ts'

/** The helper's commands. */
export const ACL_HELPER_COMMANDS = ['grant', 'revoke', 'purge'] as const

/** One helper command. */
export type AclHelperCommand = typeof ACL_HELPER_COMMANDS[number]

/** Parsed helper argv. */
export interface AclHelperArgs {
  command: AclHelperCommand
  workspace: string
  readOnly: string[]
}

/**
 * Parse `<command> --workspace <dir> [--read-only <dir>]...`.
 * @param raw - argv after the script.
 * @returns the parsed arguments; throws on anything else.
 */
export function parseHelperArgs(raw: readonly string[]): AclHelperArgs {
  const [command, ...rest] = raw
  const known = ACL_HELPER_COMMANDS.find(name => name === command)
  if (known === undefined) throw new Error(`unknown command: ${String(command)}`)
  let workspace: string | undefined
  const readOnly: string[] = []
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (value === undefined) throw new Error(`missing value after ${String(flag)}`)
    if (flag === '--workspace') workspace = value
    else if (flag === '--read-only') readOnly.push(value)
    else throw new Error(`unknown argument: ${String(flag)}`)
  }
  if (workspace === undefined) throw new Error('missing --workspace')
  if (known === 'revoke' && readOnly.length > 0) throw new Error('revoke does not accept --read-only')
  return { command: known, workspace, readOnly }
}

/**
 * Run one command against the real ACLs.
 * @param args - the parsed arguments.
 * @returns whether anything changed (`grant` reports true: its exact-ACE skip is internal).
 */
export function runHelper(args: AclHelperArgs): boolean {
  if (!existsSync(args.workspace) || !statSync(args.workspace).isDirectory()) {
    throw new Error(`--workspace is not an existing directory: ${args.workspace}`)
  }
  const grant = AclWriteGrant.create(workspaceWriteSid(args.workspace))
  try {
    switch (args.command) {
      case 'grant':
        // Standing: dispose() below frees the SIDs and leaves the grant in place.
        grant.add(args.workspace, true, args.readOnly)
        return true
      case 'revoke': return grant.revokeStanding(args.workspace)
      case 'purge': return grant.purge(args.workspace, args.readOnly)
    }
  } finally {
    grant.dispose()
  }
}
