export type TestStatus = '未执行' | '执行中' | '待重测' | '通过' | '失败' | '阻塞'

export interface StationDevice {
  id: string
  name: string
  kind: '道岔' | '信号机' | '轨道区段'
  x: number
  y: number
  routeIds: string[]
}

export interface RouteRelation {
  id: string
  name: string
  color: string
  points: [number, number][]
  devices: string[]
  affectedBy: string[]
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: '未执行' | '通过' | '失败'
  actual?: string
  evidence?: string
  /** 关系变更后，步骤上挂接的旧证据即失效，重测通过后才恢复 */
  evidenceValid?: boolean
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  version: string
  /** 当前用例所依据的版本快照；与活动快照不一致且关系受影响时需要重算 */
  snapshotId: string
  /** 用例及其证据是否仍对活动快照有效 */
  valid: boolean
  invalidReason?: string
  status: TestStatus
  steps: TestStep[]
  failureReason?: string
}

export type ExecutionResult = '执行中' | '通过' | '失败' | '阻塞'
export type RecordSource = '在线' | '断线补传' | '旧记录补齐'
export type RecordState = '生效' | '待复核' | '已复核采纳' | '已复核驳回' | '已被取代'

export interface ExecutionRecord {
  id: string
  /** 服务端幂等请求号，断网登记时即生成，补传/重试全程不变 */
  requestId?: string
  caseId: string
  operator: string
  startedAt: string
  finishedAt?: string
  snapshot: string
  snapshotId?: string
  result: ExecutionResult
  evidence: string[]
  /** 证据是否仍被当前快照承认（关系变更后旧证据失效，记录保留） */
  evidenceValid: boolean
  source: RecordSource
  /** 旧记录缺少版本时，按设备关系补齐来源的说明 */
  sourceFilled?: string
  state: RecordState
  reviewReason?: string
  reviewDecision?: string
  /** 并发保存时先到的生效记录 id，复核记录用它指向对手 */
  conflictsWith?: string
  attempts?: number
  replayed?: boolean
}

/** 断网期间本地登记、等待补传的写入请求 */
export interface OutboxRequest {
  requestId: string
  caseId: string
  operator: string
  result: ExecutionResult
  evidence: string[]
  reason: string
  snapshotId: string
  registeredAt: string
  attempts: number
  lastError?: string
}

/** 设备 + 进路 + 用例 + 执行记录 + 发布基线共用的同一份版本快照 */
export interface VersionSnapshot {
  id: string
  version: string
  label: string
  /** 设备↔进路关系指纹，锁定前据此重新核对 */
  fingerprint: string
  createdAt: string
  changedDeviceIds: string[]
  changedRouteIds: string[]
  changeNote: string
  /** 生成基线时引用的用例与生效记录 */
  caseIds: string[]
  executionIds: string[]
  /** 最近一次“锁定前核对”是否通过 */
  verified: boolean
  verifiedAt?: string
}
