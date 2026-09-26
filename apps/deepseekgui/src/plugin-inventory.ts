/**
 * 读取 profile 清单里已安装的插件（只读）。
 *
 * 插件的安装、更新与卸载都走官方插件管理页；DeepSeekGUI 自己的插件写操作
 * 与事务恢复链已在 2026-09 撤掉（官方 0.1.7 自带插件兼容检查与安装中断后的
 * 恢复）。这里只剩反馈诊断需要的一件事：列出每个 profile 的 dependencies。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/plugin-inventory
 */

/** manifest 读取的结果：dependencies 或明确错误（绝不部分采纳）。 */
export type ManifestDependenciesResult =
  | { ok: true; dependencies: Record<string, string> }
  | { ok: false; error: string }

/**
 * 严格读取 profile 目录 package.json 的 dependencies 字段（只读文档）。
 * 未知结构（非对象、dependencies 非字符串记录）一律明确报错，绝不猜测。
 * @param raw - package.json 的原始文本。
 * @param profileDir - profile 目录（诊断用）。
 * @param zh - 错误文案是否用中文。
 * @returns dependencies 或明确错误。
 */
export function parseManifestDependencies(raw: string, profileDir: string, zh = true): ManifestDependenciesResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error)
    return { ok: false, error: zh ? `profile manifest 不是有效 JSON: ${detail}` : `The profile manifest is not valid JSON: ${detail}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: zh ? `profile manifest 必须是 JSON 对象（${profileDir}）` : `The profile manifest must be a JSON object (${profileDir})` }
  }
  const record = parsed as Record<string, unknown>
  const rawDeps = record.dependencies
  if (rawDeps === undefined) return { ok: true, dependencies: {} }
  if (typeof rawDeps !== 'object' || rawDeps === null || Array.isArray(rawDeps)) {
    return { ok: false, error: zh ? 'profile manifest 的 dependencies 必须是对象' : 'The profile manifest dependencies must be an object' }
  }
  const dependencies: Record<string, string> = {}
  for (const [name, spec] of Object.entries(rawDeps)) {
    if (typeof spec !== 'string') {
      return { ok: false, error: zh ? `dependency ${JSON.stringify(name)} 的 spec 必须是字符串` : `The spec of dependency ${JSON.stringify(name)} must be a string` }
    }
    dependencies[name] = spec
  }
  return { ok: true, dependencies }
}
