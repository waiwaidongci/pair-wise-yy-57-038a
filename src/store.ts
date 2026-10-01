import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ExecutionRecord, ExecutionResult, OutboxRequest, RecordState,
  StationDevice, TestCase, TestStep, VersionSnapshot,
} from './types'
import {
  devices as seedDevices, routes as seedRoutes, seedCases, seedExecutions,
  SNAPSHOT_PREV, SNAPSHOT_PREV_ID,
} from './mock'
import { primeWriteFailure, saveExecution } from './server'

const STORAGE_KEY = 'yy57-interlocking-snapshot-v2'

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}
function clockText() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
let reqSeq = 1
function genRequestId() {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  return `REQ-${day}-${String(reqSeq++).padStart(3, '0')}`
}

/** 设备↔进路关系指纹：设备隶属进路 + 进路包含设备，任一边变化指纹即变 */
function relationFingerprint(devices: StationDevice[], routeList: { id: string; devices: string[] }[]) {
  const lines: string[] = []
  devices.forEach((d) => lines.push(`D:${d.id}:[${[...d.routeIds].sort().join(',')}]`))
  routeList.forEach((r) => lines.push(`R:${r.id}:[${[...r.devices].sort().join(',')}]`))
  // 32 位 FNV-1a
  let hash = 0x811c9dc5
  const text = lines.sort().join('|')
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `FP-${hash.toString(16).padStart(8, '0')}`
}

export const useTestStore = defineStore('interlocking', () => {
  /* ---------------- 同一份版本快照承载的五个部分 ---------------- */
  const devices = ref<StationDevice[]>(structuredClone(seedDevices))
  const routes = ref(structuredClone(seedRoutes))
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  const outbox = ref<OutboxRequest[]>([])
  const reviews = ref<ExecutionRecord[]>([])

  // 升级前基线（锁定态），其指纹按种子关系重算，保持与旧记录引用一致
  const prevFingerprint = relationFingerprint(seedDevices, seedRoutes)
  const prevSnapshot = ref<VersionSnapshot>({
    ...SNAPSHOT_PREV, fingerprint: prevFingerprint,
  })
  // 当前活动快照：v26.10 升级后尚未锁定的版本，初始关系指纹与旧基线相同，
  // 设备/进路关系一旦改动指纹立即更新
  const activeSnapshot = ref<VersionSnapshot>({
    id: 'SNP-2610-01',
    version: 'v26.10',
    label: 'CS-LEU-09 升级回归快照',
    fingerprint: prevFingerprint,
    createdAt: '2026-09-30 08:30',
    changedDeviceIds: ['P-02', 'T-03'],
    changedRouteIds: ['R-01', 'R-02', 'R-03', 'R-04'],
    changeNote: 'P-02 转辙机更换、T-03 绝缘节调整（升级引入）',
    caseIds: seedCases.map((c) => c.id),
    executionIds: [],
    verified: false,
  })

  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')

  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])

  /* ---------------- 旧记录缺少版本：按设备关系补齐来源 ---------------- */
  function backfillLegacyRecords(snapshot: VersionSnapshot) {
    executions.value.forEach((rec) => {
      if (rec.snapshot || rec.snapshotId) return
      const tc = cases.value.find((c) => c.id === rec.caseId)
      const routeIds = tc?.routeIds ?? []
      const deviceIds = new Set(
        routes.value.filter((r) => routeIds.includes(r.id)).flatMap((r) => r.devices),
      )
      const sourceNames = routes.value
        .filter((r) => routeIds.includes(r.id))
        .flatMap((r) => r.affectedBy)
      rec.snapshotId = snapshot.id
      rec.snapshot = `${snapshot.version} / ${snapshot.label}（旧记录按设备关系反推补齐）`
      rec.source = '旧记录补齐'
      rec.sourceFilled = `旧记录未登记版本，按 ${rec.caseId} 关联进路 ${routeIds.join('、') || '无'} `
        + `上的设备 ${[...deviceIds].join('、') || '无'} 反推归属${sourceNames.length ? `；涉及变更：${[...new Set(sourceNames)].join('、')}` : ''}`
      rec.evidenceValid = !affectedCaseIdsFor(routeIds).size
    })
  }

  /** 给定进路集合，按当前活动快照的变更设备/进路推导受影响用例 id */
  function affectedCaseIdsFor(routeIds: string[]) {
    const snap = activeSnapshot.value
    const hitRoutes = new Set(
      routes.value
        .filter((r) =>
          routeIds.includes(r.id)
          && (snap.changedRouteIds.includes(r.id)
            || r.devices.some((d) => snap.changedDeviceIds.includes(d))),
        )
        .map((r) => r.id),
    )
    return new Set(
      cases.value.filter((c) => c.routeIds.some((r) => hitRoutes.has(r))).map((c) => c.id),
    )
  }

  /* ---------------- 设备或进路关系一变：用例与证据失效重算 ---------------- */
  function invalidateForChange(changedRouteId: string, changedDeviceIds: string[], note: string) {
    if (baselineLocked.value) {
      // 锁定后再改关系：冻结已锁基线，另开一份新快照
      prevSnapshot.value = { ...activeSnapshot.value }
      activeSnapshot.value = {
        id: `SNP-${Date.now().toString().slice(-8)}`,
        version: activeSnapshot.value.version,
        label: `${activeSnapshot.value.label}（锁后修订）`,
        fingerprint: relationFingerprint(devices.value, routes.value),
        createdAt: nowText(),
        changedDeviceIds: [...changedDeviceIds],
        changedRouteIds: [changedRouteId],
        changeNote: note,
        caseIds: cases.value.map((c) => c.id),
        executionIds: [],
        verified: false,
      }
      baselineLocked.value = false
    } else {
      const snap = activeSnapshot.value
      snap.fingerprint = relationFingerprint(devices.value, routes.value)
      snap.changedDeviceIds = [...new Set([...snap.changedDeviceIds, ...changedDeviceIds])]
      snap.changedRouteIds = [...new Set([...snap.changedRouteIds, changedRouteId])]
      snap.changeNote = note
      snap.verified = false
      snap.verifiedAt = undefined
    }

    const affected = affectedCaseIdsFor([changedRouteId])
    affected.forEach((caseId) => {
      const tc = cases.value.find((c) => c.id === caseId)
      if (!tc) return
      tc.snapshotId = activeSnapshot.value.id
      tc.valid = false
      tc.invalidReason = `${note}：关联进路 ${changedRouteId} 关系已变，旧结果与证据失效，需重测`
      tc.status = '待重测'
      tc.steps.forEach((step) => {
        if (step.evidence) step.evidenceValid = false
      })
      executions.value.forEach((rec) => {
        if (rec.caseId === caseId && rec.state !== '已被取代') {
          rec.evidenceValid = false
          if (rec.state === '生效') rec.state = '待复核'
          rec.reviewReason = rec.reviewReason
            ?? `版本快照变更（${changedRouteId} 关系），旧证据失效，需复核确认`
        }
      })
    })
    liveMessage.value = `关系变更：${note}，${affected.size} 条用例及证据已失效重算`
    persist()
  }

  /** 站场页编辑：把设备挂进/移出某条进路（设备与进路关系同步双向更新） */
  function toggleDeviceRoute(deviceId: string, routeId: string) {
    const device = devices.value.find((d) => d.id === deviceId)
    const route = routes.value.find((r) => r.id === routeId)
    if (!device || !route) return
    const inRoute = device.routeIds.includes(routeId)
    if (inRoute) {
      device.routeIds = device.routeIds.filter((id) => id !== routeId)
      route.devices = route.devices.filter((id) => id !== deviceId)
    } else {
      device.routeIds = [...device.routeIds, routeId]
      route.devices = [...route.devices, deviceId]
    }
    invalidateForChange(
      routeId, [deviceId],
      `${deviceId} ${device.name} ${inRoute ? '移出' : '纳入'} ${routeId} ${route.name}`,
    )
  }

  /* ---------------- 派生视图 ---------------- */
  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })
  const changedDeviceNames = computed(() =>
    activeSnapshot.value.changedDeviceIds
      .map((id) => devices.value.find((d) => d.id === id))
      .filter(Boolean)
      .map((d) => `${d!.id} ${d!.name}`))
  const affectedCases = computed(() =>
    cases.value.filter((item) => affectedCaseIdsFor(item.routeIds).has(item.id)))
  const invalidCases = computed(() => cases.value.filter((c) => !c.valid))
  const pendingReviews = computed(() =>
    [...reviews.value, ...executions.value.filter((r) => r.state === '待复核')])
  const pendingReviewCount = computed(() => pendingReviews.value.length)
  const pendingOutboxCount = computed(() => outbox.value.length)

  /* ---------------- 选择与执行 ---------------- */
  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  function recomputeCaseStatus(item: TestCase) {
    item.status = item.steps.some((s) => s.result === '失败')
      ? '失败'
      : item.steps.every((s) => s.result === '通过')
        ? '通过'
        : '执行中'
  }

  /** 步骤结果同时决定用例在活动快照上的有效性与新证据有效性 */
  function setStepResult(caseId: string, stepId: string, result: TestStep['result'], actual?: string) {
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，只读，不能再登记步骤'; return }
    const item = cases.value.find((entry) => entry.id === caseId)
    const step = item?.steps.find((entry) => entry.id === stepId)
    if (!item || !step) return
    if (step.dependency && item.steps.find((entry) => entry.id === step.dependency)?.result !== '通过') {
      liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过`
      return
    }
    step.result = result
    step.actual = actual ?? step.actual
    // 重测写入的证据对当前快照有效
    step.evidence = step.evidence ?? (result === '通过' ? '执行记录自动归档' : undefined)
    step.evidenceValid = true
    recomputeCaseStatus(item)
    persist()
  }

  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    item.status = '执行中'
    const rec: ExecutionRecord = {
      id: `EX-LOCAL-${Date.now().toString().slice(-6)}`,
      caseId: item.id,
      operator: '当前用户',
      startedAt: clockText(),
      snapshot: `${activeSnapshot.value.version} / ${activeSnapshot.value.label}`,
      snapshotId: activeSnapshot.value.id,
      result: '执行中',
      evidence: [],
      evidenceValid: true,
      source: '在线',
      state: '生效',
    }
    executions.value.unshift(rec)
    liveMessage.value = `已在快照 ${activeSnapshot.value.id} 下开始执行 ${item.id}`
    persist()
  }

  /* ---------------- 写入：在线保存（含并发先到生效） ---------------- */
  async function saveExecutionRecord(payload: {
    caseId: string; operator: string; result: ExecutionResult;
    evidence: string[]; reason?: string;
  }): Promise<void> {
    const requestId = genRequestId()
    const outcome = await saveExecution({
      requestId, caseId: payload.caseId, operator: payload.operator, result: payload.result,
    })
    const base: ExecutionRecord = {
      id: outcome.recordId,
      requestId,
      caseId: payload.caseId,
      operator: payload.operator,
      startedAt: clockText(),
      finishedAt: clockText(),
      snapshot: `${activeSnapshot.value.version} / ${activeSnapshot.value.label}`,
      snapshotId: activeSnapshot.value.id,
      result: payload.result,
      evidence: payload.evidence,
      evidenceValid: true,
      source: '在线',
      state: outcome.status === '生效' ? '生效' : '待复核',
      replayed: false,
      attempts: 1,
    }
    if (outcome.status === '待复核') {
      base.conflictsWith = outcome.conflictsWith
      base.reviewReason = `两名操作员并发保存 ${payload.caseId}：先到请求已生效（${outcome.conflictsWith}），后到内容保留为复核记录`
      reviews.value.unshift(base)
      // 先到生效记录标记存在待复核对手
      const winner = executions.value.find((r) => r.id === outcome.conflictsWith)
      if (winner) winner.reviewReason = winner.reviewReason ?? `存在并发后到的复核记录 ${outcome.recordId}`
      liveMessage.value = `并发冲突：${outcome.conflictsWith} 先到生效，${outcome.recordId} 保留为复核`
    } else {
      executions.value.unshift(base)
      liveMessage.value = `执行记录 ${outcome.recordId} 已生效（请求号 ${requestId}）`
    }
    persist()
  }

  /** 演示两名操作员同时保存同一条用例 */
  async function simulateConcurrentSave() {
    const item = selectedCase.value
    if (!item) return
    liveMessage.value = '两名操作员正在同时提交……'
    const evidenceNow = item.steps.filter((s) => s.result === '失败').map((s) => s.evidence ?? '')
    await Promise.all([
      saveExecutionRecord({
        caseId: item.id, operator: '操作员甲（陆晨）',
        result: item.status === '失败' ? '失败' : '通过',
        evidence: evidenceNow.length ? evidenceNow : ['陆晨终端记录'],
      }),
      saveExecutionRecord({
        caseId: item.id, operator: '操作员乙（方瑜）',
        result: '通过',
        evidence: ['方瑜终端复核记录', '执行画面截图 XS-LIVE'],
      }),
    ])
  }

  /* ---------------- 断网登记 + 补传重试（沿用首次结果） ---------------- */
  function registerOffline(payload: {
    caseId: string; result: ExecutionResult; evidence: string[]; reason: string
  }) {
    const req: OutboxRequest = {
      requestId: genRequestId(),
      caseId: payload.caseId,
      operator: '当前用户',
      result: payload.result,
      evidence: payload.evidence,
      reason: payload.reason,
      snapshotId: activeSnapshot.value.id,
      registeredAt: nowText(),
      attempts: 0,
    }
    outbox.value.unshift(req)
    pendingRetry.value = outbox.value.length
    liveMessage.value = `断网登记 ${req.requestId}：已本地留存，恢复后按原请求号补传`
    persist()
  }

  function simulateDisconnect() {
    connection.value = '重连中'
    liveMessage.value = '与执行服务连接中断，执行记录改走本地登记'
  }

  /** 对某条补传请求制造一次写入失败（服务端未落库，重试仍是同一请求号） */
  function primeOutboxFailure(requestId: string) {
    primeWriteFailure(requestId)
  }

  async function replayOutbox(requestId?: string) {
    if (connection.value !== '在线') {
      liveMessage.value = '仍处于断网状态，无法补传'
      return
    }
    const targets = outbox.value.filter((q) => !requestId || q.requestId === requestId)
    for (const req of targets) {
      req.attempts += 1
      try {
        const outcome = await saveExecution({
          requestId: req.requestId, caseId: req.caseId, operator: req.operator, result: req.result,
        })
        outbox.value = outbox.value.filter((q) => q.requestId !== req.requestId)
        pendingRetry.value = outbox.value.length
        // 服务端幂等返回首次结果：若该请求号的记录已在本地（典型：上次响应丢失后重试），不再重复入库
        const known = executions.value.find((r) => r.requestId === req.requestId)
          ?? reviews.value.find((r) => r.requestId === req.requestId)
        if (known) {
          known.replayed = true
          known.attempts = Math.max(known.attempts ?? 1, req.attempts)
          liveMessage.value = `请求号 ${req.requestId} 幂等确认：沿用首次结果 ${known.id}，未重复落库（尝试 ${req.attempts} 次）`
          persist()
          continue
        }
        const rec: ExecutionRecord = {
          id: outcome.recordId,
          requestId: req.requestId,
          caseId: req.caseId,
          operator: req.operator,
          startedAt: req.registeredAt.slice(11) || clockText(),
          finishedAt: clockText(),
          snapshot: `${activeSnapshot.value.version} / ${activeSnapshot.value.label}`,
          snapshotId: req.snapshotId,
          result: req.result,
          evidence: req.evidence,
          evidenceValid: req.snapshotId === activeSnapshot.value.id && !invalidCases.value.some((c) => c.id === req.caseId),
          source: '断线补传',
          state: outcome.status === '待复核' ? '待复核' : '生效',
          conflictsWith: outcome.conflictsWith,
          attempts: req.attempts,
          replayed: outcome.replayed,
          reviewReason: outcome.status === '待复核'
            ? `断线补传落后于在线保存：先到记录 ${outcome.conflictsWith} 已生效，补传内容保留为复核`
            : (req.attempts > 1 ? `断网登记后第 ${req.attempts} 次补传成功，请求号 ${req.requestId} 全程未变` : undefined),
        }
        if (rec.state === '待复核') reviews.value.unshift(rec)
        else executions.value.unshift(rec)
        liveMessage.value = outcome.replayed
          ? `请求号 ${req.requestId} 命中首次结果 ${outcome.recordId}（服务端幂等返回，未重复落库）`
          : `补传成功：${outcome.recordId}（原请求号 ${req.requestId}${req.attempts > 1 ? `，历经 ${req.attempts} 次尝试` : ''}）`
      } catch (error) {
        req.lastError = error instanceof Error ? error.message : String(error)
        liveMessage.value = `${req.requestId} 第 ${req.attempts} 次写入失败：${req.lastError}；将沿用原请求号重试，首次结果不变`
      }
    }
    persist()
  }

  function reconnect() {
    connection.value = '在线'
    liveMessage.value = '连接已恢复，可按原请求号补传断网期间的登记'
  }

  /* ---------------- 复核处理 ---------------- */
  function resolveReview(rec: ExecutionRecord, decision: '采纳' | '驳回', comment: string) {
    const target = reviews.value.find((r) => r.id === rec.id)
      ?? executions.value.find((r) => r.id === rec.id)
    if (!target) return
    target.reviewDecision = `${decision}：${comment || '无批注'}`
    if (decision === '采纳') {
      // 后到内容经复核采纳：取代先到结果，先到记录保留为“已被取代”
      target.state = '已复核采纳'
      target.evidenceValid = target.snapshotId === activeSnapshot.value.id
      if (target.conflictsWith) {
        const winner = executions.value.find((r) => r.id === target.conflictsWith)
        if (winner) {
          winner.state = '已被取代'
          winner.reviewDecision = `并发复核后被 ${target.id}（${target.operator}）取代`
        }
      }
      if (!executions.value.some((r) => r.id === target.id)) executions.value.unshift(target)
      reviews.value = reviews.value.filter((r) => r.id !== target.id)
      const tc = cases.value.find((c) => c.id === target.caseId)
      if (tc && target.result !== '执行中') {
        tc.status = target.result === '通过' ? '通过' : target.result === '失败' ? '失败' : '阻塞'
        tc.valid = target.evidenceValid
      }
    } else {
      target.state = '已复核驳回'
      reviews.value = reviews.value.filter((r) => r.id !== target.id)
      if (!executions.value.some((r) => r.id === target.id)) executions.value.push(target)
    }
    liveMessage.value = `复核${decision}：记录 ${target.id}`
    persist()
  }

  /* ---------------- 锁定前核对与发布门禁 ---------------- */
  type GateItem = { key: string; label: string; pass: boolean; detail: string }
  const gateChecks = computed<GateItem[]>(() => {
    const currentFingerprint = relationFingerprint(devices.value, routes.value)
    const unfinished = cases.value.filter((c) => ['未执行', '执行中', '阻塞'].includes(c.status))
    const failed = cases.value.filter((c) => c.status === '失败')
    return [
      {
        key: 'fingerprint',
        label: '快照指纹重新核对',
        pass: currentFingerprint === activeSnapshot.value.fingerprint,
        detail: currentFingerprint === activeSnapshot.value.fingerprint
          ? `当前关系指纹 ${currentFingerprint} 与快照一致`
          : `当前 ${currentFingerprint} ≠ 快照 ${activeSnapshot.value.fingerprint}，关系又有变动`,
      },
      {
        key: 'invalid',
        label: '受影响用例已重测',
        pass: invalidCases.value.length === 0,
        detail: invalidCases.value.length
          ? `${invalidCases.value.length} 条用例因关系变更失效待重测：${invalidCases.value.map((c) => c.id).join('、')}`
          : '无失效用例',
      },
      {
        key: 'review',
        label: '待复核项已闭环',
        pass: pendingReviewCount.value === 0,
        detail: pendingReviewCount.value
          ? `${pendingReviewCount.value} 项待复核挡住发布`
          : '无待复核项',
      },
      {
        key: 'unfinished',
        label: '无未执行/阻塞用例',
        pass: unfinished.length === 0,
        detail: unfinished.length ? unfinished.map((c) => `${c.id}（${c.status}）`).join('、') : '全部用例均有结论',
      },
      {
        key: 'failed',
        label: '失败用例已闭环',
        pass: failed.length === 0,
        detail: failed.length ? failed.map((c) => `${c.id}：${c.failureReason ?? '失败'}`).join('；') : '无失败用例',
      },
      {
        key: 'outbox',
        label: '断网登记已补传',
        pass: outbox.value.length === 0,
        detail: outbox.value.length ? `${outbox.value.length} 条登记仍在本地，未补传` : '补传队列已清空',
      },
    ]
  })
  const releaseReady = computed(() => gateChecks.value.every((g) => g.pass))

  function lockBaseline() {
    // 锁定前重新核对当前快照
    const currentFingerprint = relationFingerprint(devices.value, routes.value)
    activeSnapshot.value.verified = currentFingerprint === activeSnapshot.value.fingerprint
    activeSnapshot.value.verifiedAt = nowText()
    if (!releaseReady.value) {
      liveMessage.value = `发布被挡下：${gateChecks.value.filter((g) => !g.pass).map((g) => g.label).join('、')}`
      return
    }
    activeSnapshot.value.caseIds = cases.value.map((c) => c.id)
    activeSnapshot.value.executionIds = executions.value
      .filter((r) => (r.state === '生效' || r.state === '已复核采纳') && r.evidenceValid)
      .map((r) => r.id)
    baselineLocked.value = true
    liveMessage.value = `基线 ${activeSnapshot.value.id} 已锁定，快照只读`
    persist()
  }

  function updateLiveProgress(value: number) {
    if (value < 100) {
      liveMessage.value = `实时同步：已完成 ${value}%`
      return
    }
    liveMessage.value = '全部用例执行完成，等待审核锁定'
  }

  /* ---------------- 持久化 ---------------- */
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      devices: devices.value,
      routes: routes.value,
      cases: cases.value,
      executions: executions.value,
      outbox: outbox.value,
      reviews: reviews.value,
      activeSnapshot: activeSnapshot.value,
      baselineLocked: baselineLocked.value,
    }))
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      backfillLegacyRecords(prevSnapshot.value)
      persist()
      return
    }
    try {
      const draft = JSON.parse(raw)
      if (draft.devices) devices.value = draft.devices
      if (draft.routes) routes.value = draft.routes
      if (draft.cases) cases.value = draft.cases
      if (draft.executions) executions.value = draft.executions
      if (draft.outbox) outbox.value = draft.outbox
      if (Array.isArray(draft.reviews)) reviews.value = draft.reviews
      if (draft.activeSnapshot) activeSnapshot.value = draft.activeSnapshot
      baselineLocked.value = !!draft.baselineLocked
      pendingRetry.value = outbox.value.length
      backfillLegacyRecords(prevSnapshot.value)
    } catch {
      backfillLegacyRecords(prevSnapshot.value)
    }
  }
  restore()

  const reviewList = computed(() => {
    const ids = new Set(reviews.value.map((r) => r.id))
    const fromExec = executions.value.filter((r) => r.state === '待复核' && !ids.has(r.id))
    return [...reviews.value, ...fromExec]
  })

  return {
    // 状态
    devices, routes, cases, executions, outbox, reviews: reviewList,
    prevSnapshot, activeSnapshot, baselineLocked,
    connection, pendingRetry, liveMessage,
    selectedCaseId, selectedRouteIds, selectedCase,
    // 派生
    progress, changedDeviceNames, affectedCases, invalidCases,
    pendingReviews, pendingReviewCount, pendingOutboxCount, gateChecks, releaseReady,
    // 动作
    selectCase, toggleDeviceRoute, setStepResult, startExecution,
    saveExecutionRecord, simulateConcurrentSave,
    registerOffline, simulateDisconnect, reconnect, replayOutbox, primeOutboxFailure,
    resolveReview, lockBaseline, updateLiveProgress,
    relationFingerprint: () => relationFingerprint(devices.value, routes.value),
  }
})

export type RecordStateType = RecordState
