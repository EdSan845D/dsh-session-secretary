/**
 * 会话标识：【项目·会话】。
 *
 * 投递收口（gateway deliver / 流式收口）在每个出站 IM 文本前缀上拼接该标识，
 * 让一个聊天里的多会话输出可以分辨来源。项目 = 会话 cwd 的目录基名，
 * 会话 = 会话标题（sessionController.list 的 projections.title），缺省回退 sessionId 前 8 位。
 * 列表结果缓存 30 秒；`session/title` 事件路径可调用 invalidate() 强制刷新。
 */

export interface SessionListRow {
  sessionId?: string
  cwd?: string
  projections?: { values?: { title?: string } }
}

export interface LabelDeps {
  list(): Promise<{ items?: SessionListRow[] } | null | undefined>
  now?(): number
}

interface SessionRow {
  cwd?: string
  title?: string
}

interface CacheEntry {
  at: number
  rows: Map<string, SessionRow>
}

const CACHE_TTL_MS = 30_000

/** 目录路径的末段（兼容正反斜杠，去空段）。 */
export function basenameOf(path: string | undefined): string {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split(/[\\/]/).filter(part => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

export function createLabelProvider(deps: LabelDeps) {
  const now = deps.now ?? Date.now
  let cache: CacheEntry | null = null
  let loading: Promise<Map<string, SessionRow>> | null = null

  async function loadRows(): Promise<Map<string, SessionRow>> {
    const listed = await deps.list().catch(() => null)
    const rows = new Map<string, SessionRow>()
    for (const item of listed?.items ?? []) {
      if (typeof item?.sessionId !== 'string' || item.sessionId === '') continue
      const rawTitle = item.projections?.values?.title
      rows.set(item.sessionId, {
        cwd: typeof item.cwd === 'string' ? item.cwd : undefined,
        title: typeof rawTitle === 'string' ? rawTitle : undefined,
      })
    }
    return rows
  }

  async function rowsOf(): Promise<Map<string, SessionRow> | null> {
    if (cache !== null && now() - cache.at < CACHE_TTL_MS) return cache.rows
    if (loading === null) {
      loading = loadRows()
        .then(rows => {
          cache = { at: now(), rows }
          return rows
        })
        .catch(() => new Map<string, SessionRow>())
        .finally(() => { loading = null })
    }
    return loading
  }

  return {
    async labelOf(sessionId: string): Promise<string> {
      if (typeof sessionId !== 'string' || sessionId === '') return ''
      const rows = await rowsOf()
      if (rows === null) return ''
      const row = rows.get(sessionId)
      if (row === undefined) return ''
      const project = basenameOf(row.cwd) || '未知项目'
      const title = typeof row.title === 'string' && row.title !== '' ? row.title : sessionId.slice(0, 8)
      return `【${project}·${title}】`
    },
    invalidate(): void {
      cache = null
    },
  }
}

export type LabelProvider = ReturnType<typeof createLabelProvider>
