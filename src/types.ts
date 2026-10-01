export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'

// 版本快照：设备、进路、用例、执行记录与发布基线共同引用同一份快照
export interface VersionSnapshot {
  id: string
  software: string
  leu: string
}

// 设备 / 进路关系变更
export interface RelationChange {
  id: string
  targetKind: '设备' | '进路'
  targetId: string
  description: string
  appliedAt: string
}

export interface StationDevice {
  id: string
  name: string
  kind: '道岔' | '信号机' | '轨道区段'
  x: number
  y: number
  routeIds: string[]
  snapshot: string
}

export interface RouteRelation {
  id: string
  name: string
  color: string
  points: [number, number][]
  devices: string[]
  affectedBy: string[]
  snapshot: string
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: '未执行' | '通过' | '失败'
  actual?: string
  evidence?: string
  snapshot?: string
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  snapshot: string
  status: TestStatus
  steps: TestStep[]
  failureReason?: string
  stale?: boolean
}

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  startedAt: string
  finishedAt?: string
  snapshot?: string
  source?: string          // 来源：执行记录 / 按设备关系补齐
  requestId?: string       // 断网登记带回的原请求号
  result: TestStatus
  evidence: string[]
  stale?: boolean
}

// 复核记录：两名操作员同时保存时先到结果生效，后到内容保留为复核项
export interface ReviewRecord {
  id: string
  requestId: string
  caseId: string
  stepId?: string
  operator: string
  savedAt: string
  result: TestStep['result']
  actual?: string
  reason: string
  status: '待复核' | '已采纳' | '已驳回'
}

// 断网登记（发件箱）：请求号不变，重试沿用首次结果
export interface PendingWrite {
  requestId: string
  caseId: string
  stepId: string
  result: TestStep['result']
  actual?: string
  evidence?: string
  operator: string
  createdAt: string
  status: '待补传' | '已确认'
}
