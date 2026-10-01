import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ExecutionRecord, PendingWrite, RelationChange, ReviewRecord, TestCase, TestStep } from './types'
import { currentSnapshot, legacySnapshotId, routes, seedCases, seedChanges, seedExecutions } from './mock'

const STORAGE_KEY = 'yy57-interlocking-draft-v2'

function genRequestId() { return `REQ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*1e4).toString(36).toUpperCase()}` }
function genReviewId() { return `REV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*1e3).toString(36).toUpperCase()}` }
function nowTime() { return new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}) }

interface CommitPayload { requestId: string; caseId: string; stepId: string; result: TestStep['result']; actual?: string; evidence?: string; operator: string }

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  const changes = ref<RelationChange[]>(structuredClone(seedChanges))
  const reviewRecords = ref<ReviewRecord[]>([])
  const outbox = ref<PendingWrite[]>([])
  // 服务端按请求号去重：首次写入受理后缓存结果，重试沿用，不覆盖
  const processedRequests = ref<Record<string, CommitPayload & { finishedAt: string }>>({})
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const baselineSnapshot = ref('')
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')
  const lastRetryNote = ref('')
  const baselineError = ref<string[]>([])
  const filledSources = ref(0)

  const snapshot = currentSnapshot
  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))

  // 受影响进路：由设备关系图推导（设备变更→途经该设备的进路；进路变更→该进路）
  const affectedRouteIds = computed(() => {
    const set = new Set<string>()
    for (const ch of changes.value) {
      if (ch.targetKind === '进路') set.add(ch.targetId)
      if (ch.targetKind === '设备') {
        for (const r of routes) if (r.devices.includes(ch.targetId)) set.add(r.id)
      }
    }
    return set
  })
  // 受影响用例：用例关联进路与受影响进路求交（不再写死用例）
  const affectedCases = computed(() =>
    cases.value.filter((item) => item.routeIds.some((routeId) => affectedRouteIds.value.has(routeId)))
  )
  const affectedRouteNames = computed(() =>
    routes.filter((r) => affectedRouteIds.value.has(r.id)).map((r) => r.id)
  )
  const changeDescriptions = computed(() => changes.value.map((c) => c.description))
  const staleCases = computed(() => cases.value.filter((item) => item.stale))
  const pendingReviewCount = computed(() => reviewRecords.value.filter((r) => r.status === '待复核').length)
  const pendingOutboxCount = computed(() => outbox.value.filter((o) => o.status !== '已确认').length)

  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })

  // 发布门禁：全部通过、无失效、快照一致、复核项清零、断网补传完成
  const readyToRelease = computed(() =>
    cases.value.every((item) => item.status === '通过')
    && cases.value.every((item) => !item.stale)
    && cases.value.every((item) => item.snapshot === currentSnapshot.id)
    && reviewRecords.value.every((r) => r.status !== '待复核')
    && outbox.value.every((o) => o.status === '已确认')
  )

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cases: cases.value, executions: executions.value, changes: changes.value,
      reviewRecords: reviewRecords.value, outbox: outbox.value, processedRequests: processedRequests.value,
      baselineLocked: baselineLocked.value, baselineSnapshot: baselineSnapshot.value,
    }))
  }

  // 加载时：受影响且快照落后的用例 / 证据失效（按设备关系推导，而非写死）
  function recomputeStaleness() {
    const affectedIds = new Set(affectedCases.value.map((c) => c.id))
    for (const c of cases.value) c.stale = affectedIds.has(c.id) && c.snapshot !== currentSnapshot.id
    for (const e of executions.value) e.stale = affectedIds.has(e.caseId) && e.snapshot !== currentSnapshot.id
  }

  // 旧记录缺少版本时按设备关系补齐来源：用例→进路→设备→变更
  function inferSnapshot(caseId: string): string {
    const affected = affectedCases.value.some((c) => c.id === caseId)
    return affected ? legacySnapshotId : currentSnapshot.id
  }
  function ensureSnapshotSources(): number {
    let filled = 0
    for (const c of cases.value) if (!c.snapshot) { c.snapshot = inferSnapshot(c.id); filled++ }
    for (const e of executions.value) if (!e.snapshot) { e.snapshot = inferSnapshot(e.caseId); e.source = '按设备关系补齐'; filled++ }
    return filled
  }

  function init() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const draft = JSON.parse(raw)
      if (Array.isArray(draft.cases)) cases.value = draft.cases
      if (Array.isArray(draft.executions)) executions.value = draft.executions
      if (Array.isArray(draft.changes)) changes.value = draft.changes
      if (Array.isArray(draft.reviewRecords)) reviewRecords.value = draft.reviewRecords
      if (Array.isArray(draft.outbox)) outbox.value = draft.outbox
      if (draft.processedRequests) processedRequests.value = draft.processedRequests
      baselineLocked.value = !!draft.baselineLocked
      baselineSnapshot.value = draft.baselineSnapshot ?? ''
    } else {
      recomputeStaleness()
    }
    filledSources.value = ensureSnapshotSources()
  }

  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  // 低级别提交：把结果落到步骤上，并在用例当前快照下重算、清除失效标记
  function commitSave(p: CommitPayload) {
    const item = cases.value.find((entry) => entry.id === p.caseId)
    const step = item?.steps.find((entry) => entry.id === p.stepId)
    if (!item || !step) return
    step.result = p.result
    step.actual = p.actual ?? step.actual
    if (p.evidence) step.evidence = p.evidence
    step.snapshot = currentSnapshot.id
    item.snapshot = currentSnapshot.id
    item.stale = false
    // 重新核对后该用例证据刷新，失效标记清除
    for (const e of executions.value) if (e.caseId === p.caseId) e.stale = false
    item.status = item.steps.some((entry) => entry.result === '失败')
      ? '失败'
      : item.steps.every((entry) => entry.result === '通过') ? '通过' : '执行中'
  }

  // 保存执行记录：在线直接生效；断网先登记发件箱（请求号不变，重试沿用首次结果）
  function saveStepResult(caseId: string, stepId: string, result: TestStep['result'], actual?: string, evidence?: string) {
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，记录只读'; return }
    const item = cases.value.find((entry) => entry.id === caseId)
    const step = item?.steps.find((entry) => entry.id === stepId)
    if (!item || !step) return
    if (step.dependency && item.steps.find((entry) => entry.id === step.dependency)?.result !== '通过') {
      liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过`
      return
    }
    const requestId = genRequestId()
    if (connection.value === '重连中') {
      outbox.value.push({ requestId, caseId, stepId, result, actual, evidence, operator:'当前用户', createdAt:nowTime(), status:'待补传' })
      pendingRetry.value = pendingOutboxCount.value
      liveMessage.value = `断网登记成功，请求号 ${requestId}，恢复后按原号补传`
      persist()
      return
    }
    commitSave({ requestId, caseId, stepId, result, actual, evidence, operator:'当前用户' })
    liveMessage.value = `执行结果已保存（请求号 ${requestId}）`
    persist()
  }

  // 两名操作员同时保存：先到结果生效，后到内容保留为复核记录（不覆盖）
  function simulateConcurrentSave() {
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，记录只读'; return }
    const item = selectedCase.value
    if (!item) return
    const step = item.steps.find((entry) => entry.result === '未执行') ?? item.steps[item.steps.length - 1]
    if (!step) return
    const a: CommitPayload = { requestId:genRequestId(), caseId:item.id, stepId:step.id, operator:'操作员A·周敏', result:'通过', actual:'A 实测：预期结果一致，证据已归档' }
    const b: CommitPayload = { requestId:genRequestId(), caseId:item.id, stepId:step.id, operator:'操作员B·李强', result:'失败', actual:'B 实测：信号关闭延迟 126ms，与 A 结果不一致' }
    commitSave(a) // 先到结果生效
    reviewRecords.value.unshift({
      id:genReviewId(), requestId:b.requestId, caseId:b.caseId, stepId:b.stepId, operator:b.operator, savedAt:nowTime(),
      result:b.result, actual:b.actual,
      reason:`与 ${a.operator} 同时保存（请求号 ${a.requestId} 先到），先到结果已生效，后到内容待复核`,
      status:'待复核',
    })
    liveMessage.value = '并发保存：先到结果已生效，后到内容已转复核记录，不覆盖执行状态'
    persist()
  }

  // 复核处理：采纳后到内容（按后到结果重算）或驳回（维持先到结果）
  function resolveReview(id: string, adopt: boolean) {
    const r = reviewRecords.value.find((entry) => entry.id === id)
    if (!r || r.status !== '待复核') return
    if (adopt) {
      if (r.stepId) commitSave({ requestId:r.requestId, caseId:r.caseId, stepId:r.stepId, result:r.result, actual:r.actual, operator:r.operator })
      r.status = '已采纳'
      liveMessage.value = `复核项 ${r.id} 已采纳，执行结果已按后到内容重算`
    } else {
      r.status = '已驳回'
      liveMessage.value = `复核项 ${r.id} 已驳回，维持先到结果`
    }
    persist()
  }

  function startExecution() {
    const item = selectedCase.value
    if (!item || baselineLocked.value) return
    item.status = '执行中'
    item.snapshot = currentSnapshot.id
    item.stale = false
    executions.value.unshift({
      id:`EX-${Date.now().toString().slice(-6)}`, caseId:item.id, operator:'当前用户', startedAt:nowTime(),
      snapshot:currentSnapshot.id, source:'执行记录', requestId:genRequestId(), result:'执行中', evidence:[], stale:false,
    })
    persist()
  }

  // 实时同步：只更新进度，不覆盖执行状态
  function updateLiveProgress(value: number) {
    liveMessage.value = value >= 100 ? '全部用例执行完成，等待审核锁定' : `实时同步：已完成 ${value}%`
  }

  function simulateDisconnect() {
    connection.value = '重连中'
    pendingRetry.value = pendingOutboxCount.value
    liveMessage.value = '连接中断：期间保存将断网登记，请求号不变，恢复后补传'
  }

  // 重试补传：沿用首次请求号；服务端按请求号去重，首次结果不覆盖
  function retry() {
    connection.value = '在线'
    const pending = outbox.value.filter((o) => o.status !== '已确认')
    if (!pending.length) {
      pendingRetry.value = 0
      liveMessage.value = '断线期间执行记录已补传'
      persist()
      return
    }
    const first = pending[0]!
    if (!processedRequests.value[first.requestId]) {
      // 模拟首次写入已被服务端受理、但应答丢失
      processedRequests.value[first.requestId] = { ...first, finishedAt:nowTime() }
      lastRetryNote.value = `请求号 ${first.requestId} 首次写入应答丢失，已按原号重试`
    }
    let applied = 0
    for (const p of pending) {
      const cached = processedRequests.value[p.requestId]
      if (cached) {
        // 幂等：沿用首次结果，仅应用一次，不覆盖执行状态
        commitSave({ requestId:p.requestId, caseId:p.caseId, stepId:p.stepId, result:cached.result, actual:cached.actual, evidence:cached.evidence, operator:cached.operator })
        p.status = '已确认'
        applied++
      } else {
        commitSave(p)
        processedRequests.value[p.requestId] = { ...p, finishedAt:nowTime() }
        p.status = '已确认'
        applied++
      }
    }
    pendingRetry.value = 0
    liveMessage.value = `补传完成：${applied} 条已按首次结果确认（请求号不变，未覆盖执行状态）`
    persist()
  }

  // 设备 / 进路关系一变：受影响用例与证据失效重算
  function applyChange(targetKind: '设备' | '进路', targetId: string, description: string) {
    changes.value.push({
      id:`CHG-${String(changes.value.length + 1).padStart(2,'0')}`, targetKind, targetId, description,
      appliedAt:new Date().toISOString().slice(0,10),
    })
    const affected = affectedCases.value
    for (const c of cases.value) if (affected.some((a) => a.id === c.id)) c.stale = true
    for (const e of executions.value) if (affected.some((a) => a.id === e.caseId)) e.stale = true
    liveMessage.value = `关系变更已生效：${description}，${affected.length} 条用例证据失效待重算`
    persist()
  }

  // 锁定基线前重新核对当前快照：失效 / 错快照 / 未处理复核 / 未补传 / 未通过 全部挡住
  function lockBaseline() {
    const errors: string[] = []
    const stale = cases.value.filter((c) => c.stale)
    const wrongSnapshot = cases.value.filter((c) => c.snapshot !== currentSnapshot.id)
    const pending = reviewRecords.value.filter((r) => r.status === '待复核')
    const openOutbox = outbox.value.filter((o) => o.status !== '已确认')
    const notPassed = cases.value.filter((c) => c.status !== '通过')
    if (stale.length) errors.push(`${stale.length} 条用例证据已失效需重算：${stale.map((c) => c.id).join('、')}`)
    if (wrongSnapshot.length) errors.push(`${wrongSnapshot.length} 条用例未核对当前快照 ${currentSnapshot.id}：${wrongSnapshot.map((c) => c.id).join('、')}`)
    if (pending.length) errors.push(`${pending.length} 项并发保存复核未处理：${pending.map((r) => r.id).join('、')}`)
    if (openOutbox.length) errors.push(`${openOutbox.length} 项断网登记未补传`)
    if (notPassed.length) errors.push(`${notPassed.length} 条用例未通过：${notPassed.map((c) => c.id).join('、')}`)
    if (errors.length) {
      baselineError.value = errors
      liveMessage.value = '发布门禁未通过：已拦截基线锁定'
      return
    }
    baselineError.value = []
    baselineLocked.value = true
    baselineSnapshot.value = currentSnapshot.id
    liveMessage.value = `基线 ${currentSnapshot.id} 已锁定，报告与证据只读`
    persist()
  }

  init()

  return {
    snapshot, cases, executions, changes, reviewRecords, outbox, selectedCaseId, selectedRouteIds,
    selectedCase, progress, baselineLocked, baselineSnapshot, connection, pendingRetry, liveMessage,
    lastRetryNote, baselineError, filledSources,
    affectedCases, affectedRouteIds, affectedRouteNames, changeDescriptions, staleCases,
    pendingReviewCount, pendingOutboxCount, readyToRelease,
    selectCase, saveStepResult, simulateConcurrentSave, resolveReview, startExecution,
    updateLiveProgress, simulateDisconnect, retry, applyChange, lockBaseline,
  }
})
