/**
 * 模拟后端写入服务：
 * - 请求号幂等：同一 requestId 的补传/重试永远返回第一次的处理结果
 * - 并发：同一用例的两个在途保存，先到者拿锁生效，后到者返回冲突、内容留给前端登记复核
 * - 可登记一次性失败，用于演示“写入失败后重试沿用首次结果”
 */

export interface SaveRequest {
  requestId: string
  caseId: string
  operator: string
  result: string
}

export interface SaveOutcome {
  status: '生效' | '待复核'
  recordId: string
  requestId: string
  conflictsWith?: string
  replayed: boolean
}

interface AppliedEntry extends SaveOutcome {
  caseId: string
}

const applied = new Map<string, AppliedEntry>()
const inflight = new Map<string, Promise<AppliedEntry>>()
/** 登记了一次性网络失败的请求号 */
const failOnce = new Set<string>()

function genRecordId() {
  return `EX-${new Date().toISOString().slice(0, 10).replace(/-/g, '').slice(2)}-${Math.floor(1000 + Math.random() * 9000)}`
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 让某个请求号的下一次写入失败（不占用首次结果） */
export function primeWriteFailure(requestId: string) {
  failOnce.add(requestId)
}

export async function saveExecution(req: SaveRequest): Promise<SaveOutcome> {
  await delay(260 + Math.random() * 300)

  // 幂等：请求号已处理过，无论补传多少次都沿用首次结果
  const cached = applied.get(req.requestId)
  if (cached) return { ...cached, replayed: true }

  if (failOnce.delete(req.requestId)) {
    throw new Error(`请求 ${req.requestId} 写入失败：网络中断，服务端未落库`)
  }

  // 并发：同一用例已有在途写入，后到者不生效，挂为先到记录的复核项
  const pending = inflight.get(req.caseId)
  if (pending) {
    const winner = await pending
    const outcome: AppliedEntry = {
      status: '待复核',
      recordId: genRecordId(),
      requestId: req.requestId,
      conflictsWith: winner.recordId,
      replayed: false,
      caseId: req.caseId,
    }
    applied.set(req.requestId, outcome)
    return { ...outcome }
  }

  const promise = (async (): Promise<AppliedEntry> => {
    await delay(180 + Math.random() * 240)
    const entry: AppliedEntry = {
      status: '生效',
      recordId: genRecordId(),
      requestId: req.requestId,
      replayed: false,
      caseId: req.caseId,
    }
    applied.set(req.requestId, entry)
    inflight.delete(req.caseId)
    return entry
  })()
  inflight.set(req.caseId, promise)
  return promise.then((entry) => ({ ...entry }))
}
