<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import ReviewBadge from '../components/ReviewBadge.vue'

const store = useTestStore()
const failureReason = ref('模拟 3G 占用后，S2 信号未立即关闭，联锁日志出现 126ms 延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')
const reviewComment = ref('')
const actingId = ref<string>('')

const stepTag = (result: string) => result === '通过' ? 'success' : result === '失败' ? 'error' : 'info'
const stateTag = (state: string) =>
  state === '生效' ? 'success'
    : state === '待复核' ? 'warning'
      : state === '已复核采纳' ? 'success'
        : state === '已复核驳回' ? 'default' : 'info'
const sourceTag = (source: string) =>
  source === '在线' ? 'info' : source === '断线补传' ? 'warning' : 'default'

async function commit(result: '通过' | '失败') {
  const item = store.selectedCase
  const step = item?.steps.find((entry) => entry.result === '未执行')
  if (!item || !step) return
  if (result === '失败' && !failureReason.value.trim()) return
  store.setStepResult(item.id, step.id, result, result === '失败' ? failureReason.value : '预期结果一致，证据已归档')
  const evidenceList = evidence.value.split(/[、,，\s]+/).filter(Boolean)
  if (result === '失败') item.failureReason = failureReason.value
  if (store.connection === '重连中') {
    store.registerOffline({ caseId: item.id, result, evidence: evidenceList, reason: failureReason.value })
    return
  }
  actingId.value = item.id
  await store.saveExecutionRecord({ caseId: item.id, operator: '当前用户', result, evidence: evidenceList })
  actingId.value = ''
}
const passStep = () => commit('通过')
const failStep = () => commit('失败')

async function failOnceThenRetry(req: { requestId: string }) {
  store.primeOutboxFailure(req.requestId)
  await store.replayOutbox(req.requestId)
}
async function resolve(rec: { id: string }, decision: '采纳' | '驳回') {
  const recFull = store.reviews.find((r) => r.id === rec.id)
  if (recFull) store.resolveReview(recFull, decision, reviewComment.value)
  reviewComment.value = ''
}
const busy = computed(() => actingId.value === store.selectedCaseId)
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">实时执行与证据（请求号幂等 · 并发复核）</p><h1>回归执行记录</h1><p>在线保存先到生效、后到留复核；断线登记带回原请求号，补传重试沿用首次结果，旧证据随快照失效。</p></div>
    <n-space>
      <ReviewBadge />
      <n-button :type="store.connection === '在线' ? 'warning' : 'success'" @click="store.connection === '在线' ? store.simulateDisconnect() : store.reconnect()">
        {{ store.connection === '在线' ? '模拟断线' : '恢复连接' }}
      </n-button>
      <n-button type="info" :loading="busy" @click="store.simulateConcurrentSave()">两名操作员同时保存</n-button>
      <n-button type="success" :disabled="store.baselineLocked" @click="passStep">记录通过</n-button>
      <n-button type="error" :disabled="store.baselineLocked" @click="failStep">记录失败</n-button>
    </n-space>
  </section>

  <div class="execution-grid">
    <article class="card">
      <div class="panel-head">
        <div><h2>{{store.selectedCase?.id}} 执行面板</h2><p>{{store.selectedCase?.name}} · 快照 {{store.activeSnapshot.id}}（{{store.activeSnapshot.fingerprint}}）</p></div>
        <n-tag :type="store.connection==='在线'?'success':'warning'">{{store.connection}} · {{store.liveMessage}}</n-tag>
      </div>
      <n-progress type="line" :percentage="store.progress" :height="12" />
      <div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="step.result">
        <div>
          <b>{{step.id}} · {{step.action}}</b>
          <small>预期：{{step.expected}}</small>
          <small v-if="step.actual">实测：{{step.actual}}</small>
          <small v-if="step.evidence && step.evidenceValid === false" class="stale">证据 {{ step.evidence }} 已随关系变更失效，需重测</small>
        </div>
        <n-tag :type="stepTag(step.result)">{{step.result}}</n-tag>
      </div>
      <n-form label-placement="top">
        <n-form-item label="失败原因与设备快照"><n-input v-model:value="failureReason" type="textarea" :rows="3" /></n-form-item>
        <n-form-item label="证据附件"><n-input v-model:value="evidence" /></n-form-item>
      </n-form>

      <n-divider />
      <h3>断线补传队列（{{ store.outbox.length }}）</h3>
      <n-empty v-if="!store.outbox.length" description="无断网登记，记录均已落服务端" size="small" />
      <div v-for="req in store.outbox" :key="req.requestId" class="outbox-row">
        <div>
          <b>{{ req.requestId }}</b>
          <small>{{ req.caseId }} · {{ req.result }} · 登记于 {{ req.registeredAt }} · 快照 {{ req.snapshotId }}</small>
          <small v-if="req.lastError" class="stale">最近失败：{{ req.lastError }}</small>
          <small v-else>断网期间本地登记，恢复后按原请求号补传</small>
        </div>
        <n-space>
          <n-button size="small" type="error" ghost @click="failOnceThenRetry(req)">先失败再试</n-button>
          <n-button size="small" type="primary" @click="store.replayOutbox(req.requestId)">补传/重试</n-button>
        </n-space>
      </div>
    </article>

    <aside class="card">
      <div class="panel-head">
        <div><h2>待复核（{{ store.pendingReviewCount }}）</h2><p>后到内容与失效证据保留可追溯</p></div>
        <ReviewBadge />
      </div>
      <n-empty v-if="!store.reviews.length" description="没有待复核项" size="small" />
      <div v-for="rec in store.reviews" :key="rec.id" class="review-card">
        <div class="review-head">
          <b>{{ rec.id }} · {{ rec.caseId }} · {{ rec.result }}</b>
          <n-space :size="4">
            <n-tag size="small" :type="sourceTag(rec.source)">{{ rec.source }}</n-tag>
            <n-tag size="small" :type="rec.evidenceValid ? 'success' : 'warning'">{{ rec.evidenceValid ? '证据有效' : '证据失效' }}</n-tag>
          </n-space>
        </div>
        <small>{{ rec.operator }} · 请求号 {{ rec.requestId || '无' }} · 快照 {{ rec.snapshotId || '旧记录' }}</small>
        <small class="reason">{{ rec.reviewReason }}</small>
        <n-input v-model:value="reviewComment" size="small" type="textarea" :rows="2" placeholder="复核批注（可选）" style="margin:6px 0" />
        <n-space>
          <n-button size="small" type="primary" @click="resolve(rec, '采纳')">采纳（取代先到）</n-button>
          <n-button size="small" @click="resolve(rec, '驳回')">驳回（维持先到）</n-button>
        </n-space>
      </div>

      <n-divider />
      <h2>执行历史</h2>
      <n-timeline>
        <n-timeline-item v-for="record in store.executions" :key="record.id"
          :type="record.result==='通过'?'success':record.result==='失败'?'error':'info'"
          :title="`${record.caseId} · ${record.result}`">
          <div class="tl-line">
            <n-tag size="small" :type="stateTag(record.state)">{{ record.state }}</n-tag>
            <n-tag size="small" :type="sourceTag(record.source)">{{ record.source }}</n-tag>
            <n-tag size="small" :type="record.evidenceValid ? 'success' : 'warning'">{{ record.evidenceValid ? '证据有效' : '证据失效' }}</n-tag>
          </div>
          <small>{{record.operator}} {{record.startedAt}}{{record.finishedAt ? ' → '+record.finishedAt : ''}}</small><br />
          <small>{{record.snapshot || '（旧记录无版本）'}}</small>
          <small v-if="record.sourceFilled" class="filled">补齐：{{ record.sourceFilled }}</small>
          <small v-if="record.requestId">请求号：{{ record.requestId }}{{ record.replayed ? '（幂等重放）' : '' }}{{ record.attempts && record.attempts > 1 ? ` · 尝试 ${record.attempts} 次` : '' }}</small>
          <small>证据：{{record.evidence.join('、') || '采集中'}}</small>
          <small v-if="record.reviewDecision" class="reason">复核：{{ record.reviewDecision }}</small>
        </n-timeline-item>
      </n-timeline>
    </aside>
  </div>
</template>
