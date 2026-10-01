<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'
import ReviewBadge from '../components/ReviewBadge.vue'

const store = useTestStore()
const tagFor = (pass: boolean) => pass ? 'success' as const : 'error' as const

const reportVersion = computed(() => store.activeSnapshot.version)
function exportPackage() {
  const report = {
    station: '海州站 CS',
    version: reportVersion.value,
    snapshot: {
      id: store.activeSnapshot.id,
      label: store.activeSnapshot.label,
      fingerprint: store.activeSnapshot.fingerprint,
      currentFingerprint: store.relationFingerprint(),
      verified: store.activeSnapshot.verified,
      verifiedAt: store.activeSnapshot.verifiedAt,
      changedDeviceIds: store.activeSnapshot.changedDeviceIds,
      changedRouteIds: store.activeSnapshot.changedRouteIds,
      changeNote: store.activeSnapshot.changeNote,
    },
    locked: store.baselineLocked,
    gateChecks: store.gateChecks,
    pendingReviews: store.reviews.map((r) => ({ id: r.id, caseId: r.caseId, operator: r.operator, reason: r.reviewReason })),
    cases: store.cases.map((item) => ({
      id: item.id, name: item.name, snapshotId: item.snapshotId, valid: item.valid,
      invalidReason: item.invalidReason, status: item.status, steps: item.steps.length,
      failureReason: item.failureReason,
    })),
    executions: store.executions.map((r) => ({
      id: r.id, requestId: r.requestId, caseId: r.caseId, operator: r.operator,
      snapshot: r.snapshot, snapshotId: r.snapshotId, result: r.result, state: r.state,
      source: r.source, evidenceValid: r.evidenceValid, sourceFilled: r.sourceFilled,
      reviewDecision: r.reviewDecision, attempts: r.attempts,
    })),
    generatedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `联锁测试报告-${store.activeSnapshot.version}-${store.activeSnapshot.id}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>锁定前重新核对当前快照：指纹一致、受影响用例重测完成、复核项清零，才能锁定并导出可追溯报告。</p></div>
    <n-space>
      <ReviewBadge size="medium" />
      <n-button @click="exportPackage">导出测试报告</n-button>
      <n-button type="primary" :disabled="!store.releaseReady || store.baselineLocked" @click="store.lockBaseline">重新核对并锁定</n-button>
    </n-space>
  </section>

  <n-alert :type="store.releaseReady ? 'success' : 'error'"
    :title="store.baselineLocked ? `基线 ${store.activeSnapshot.id} 已锁定` : store.releaseReady ? '门禁全部通过，可锁定发布基线' : '发布门禁未通过，未处理项挡住发布'"
    :description="store.baselineLocked
      ? `快照 ${store.activeSnapshot.fingerprint} 只读，报告与证据已签章（${store.activeSnapshot.verifiedAt}）。`
      : store.releaseReady
        ? '当前设备/进路关系指纹与活动快照一致，复核队列已清零。'
        : `阻断项：${store.gateChecks.filter((g) => !g.pass).map((g) => g.label).join('、')}。`"
    style="margin-bottom:16px" />

  <div class="grid-2">
    <article class="card">
      <div class="panel-head"><div><h2>发布门禁清单</h2><p>锁定动作会再次核对当前快照，不能人工绕过</p></div><n-tag :type="store.releaseReady?'success':'error'">{{store.releaseReady?'可发布':'阻断'}}</n-tag></div>
      <div v-for="gate in store.gateChecks" :key="gate.key" class="gate">
        <div><b>{{ gate.label }}</b><small>{{ gate.detail }}</small></div>
        <n-tag :type="tagFor(gate.pass)">{{ gate.pass ? '通过' : '挡住发布' }}</n-tag>
      </div>

      <n-divider />
      <h2>用例与证据状态（{{ store.invalidCases.length }} 条失效）</h2>
      <div v-for="item in store.cases" :key="item.id" class="gate">
        <div>
          <b>{{item.id}} · {{item.name}}</b>
          <small>{{ item.valid ? (item.failureReason || '执行记录完整') : item.invalidReason }}</small>
          <small>归属快照：{{ item.snapshotId || '无' }}</small>
        </div>
        <n-tag :type="item.valid ? (item.status==='通过'?'success':item.status==='失败'?'error':'warning') : 'warning'">
          {{ item.valid ? item.status : '待重测' }}
        </n-tag>
      </div>
    </article>

    <article class="card">
      <div class="panel-head"><div><h2>差异与影响范围</h2><p>{{store.prevSnapshot.version}} → {{store.activeSnapshot.version}}</p></div><n-tag>{{ store.activeSnapshot.changedDeviceIds.length }} 项设备变更</n-tag></div>
      <div class="diff"><b>P-02 转辙机更换</b><p>影响 R-01、R-02、R-03；新增转辙机动作时序与锁闭反馈差异。</p></div>
      <div class="diff"><b>T-03 绝缘节调整</b><p>影响 R-02、R-04；轨道区段占用边界和信号关闭时机需重测。</p></div>

      <n-divider />
      <h2>快照核对</h2>
      <div class="gate"><div><b>活动快照指纹</b><small>{{ store.activeSnapshot.id }} · {{ store.activeSnapshot.label }}</small></div><n-tag>{{ store.activeSnapshot.fingerprint }}</n-tag></div>
      <div class="gate"><div><b>当前关系指纹</b><small>按设备↔进路关系实时重算</small></div><n-tag :type="store.relationFingerprint() === store.activeSnapshot.fingerprint ? 'success' : 'error'">{{ store.relationFingerprint() }}</n-tag></div>

      <n-divider />
      <h2>待复核项（{{ store.pendingReviewCount }}）</h2>
      <n-empty v-if="!store.reviews.length" description="复核队列已清空，不再挡住发布" size="small" />
      <div v-for="rec in store.reviews" :key="rec.id" class="gate">
        <div><b>{{ rec.id }} · {{ rec.caseId }} · {{ rec.operator }}</b><small>{{ rec.reviewReason }}</small></div>
        <n-tag type="warning">待复核</n-tag>
      </div>

      <n-divider />
      <h3>基线状态</h3>
      <n-result :status="store.baselineLocked ? 'success' : 'info'"
        :title="store.baselineLocked ? `${store.activeSnapshot.version} 已锁定` : '等待门禁全部通过'"
        :description="store.baselineLocked ? `快照 ${store.activeSnapshot.id} 已签章只读；再改关系将另开新快照。` : '锁定时生成只读版本快照，关系再变会自动作废并要求重算。'" />
    </article>
  </div>
</template>
