<script setup lang="ts">
import { ref } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const failureReason = ref('模拟 3G 占用后，S2 信号未立即关闭，联锁日志出现 126ms 延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')

function failStep() {
  const item = store.selectedCase
  const step = item?.steps.find((entry) => entry.result === '未执行')
  if (item && step && failureReason.value.trim()) store.saveStepResult(item.id, step.id, '失败', failureReason.value, evidence.value)
}
function passStep() {
  const item = store.selectedCase
  const step = item?.steps.find((entry) => entry.result === '未执行')
  if (item && step) store.saveStepResult(item.id, step.id, '通过', '预期结果一致，证据已归档', evidence.value)
}
function simulateDisconnect() { store.simulateDisconnect() }
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">实时执行与证据</p><h1>回归执行记录</h1><p>每次执行关联同一份版本快照、证据附件与请求号；并发保存先到生效、后到转复核，断网补传不覆盖状态。</p></div><n-space><n-button @click="simulateDisconnect">模拟断线</n-button><n-button type="info" @click="store.simulateConcurrentSave">模拟两名操作员同时保存</n-button><n-button type="success" @click="passStep">记录通过</n-button><n-button type="error" @click="failStep">记录失败</n-button></n-space></section>

  <n-alert v-if="store.pendingReviewCount" type="warning" class="review-alert" :title="`${store.pendingReviewCount} 项并发保存待复核（未处理不得锁定基线）`">
    <div v-for="r in store.reviewRecords.filter((x)=>x.status==='待复核')" :key="r.id" class="review-row">
      <div><b>{{r.id}} · {{r.operator}}</b><small>{{r.reason}}</small><small>后到结果：<n-tag :type="r.result==='通过'?'success':'error'" size="small">{{r.result}}</n-tag> {{r.actual}}</small></div>
      <n-space><n-button size="small" type="success" @click="store.resolveReview(r.id,true)">采纳后到内容</n-button><n-button size="small" @click="store.resolveReview(r.id,false)">驳回维持先到</n-button></n-space>
    </div>
  </n-alert>
  <n-alert v-if="store.lastRetryNote" type="info" class="review-alert" :title="store.lastRetryNote" />

  <div class="execution-grid"><article class="card"><div class="panel-head"><div><h2>{{store.selectedCase?.id}} 执行面板</h2><p>{{store.selectedCase?.name}}</p></div><n-space><n-tag v-if="store.selectedCase?.stale" type="warning">证据失效 · 待重算</n-tag><n-tag :type="store.connection==='在线'?'success':'warning'">{{store.connection}} · {{store.liveMessage}}</n-tag></n-space></div><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="step.result"><div><b>{{step.id}} · {{step.action}}<n-tag v-if="step.snapshot && step.snapshot!==store.snapshot.id" size="tiny" type="warning" style="margin-left:6px">旧快照</n-tag></b><small>预期：{{step.expected}}</small><small v-if="step.actual">实测：{{step.actual}}</small></div><n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'info'">{{step.result}}</n-tag></div><n-form label-placement="top"><n-form-item label="失败原因与设备快照"><n-input v-model:value="failureReason" type="textarea" :rows="3" /></n-form-item><n-form-item label="证据附件"><n-input v-model:value="evidence" /></n-form-item></n-form></article>
    <aside class="card"><div class="panel-head"><div><h2>执行历史</h2><p>失败与重测记录不可覆盖</p></div><n-tag v-if="store.pendingOutboxCount" type="info">待补传 {{store.pendingOutboxCount}}</n-tag></div><n-timeline><n-timeline-item v-for="record in store.executions" :key="record.id" :type="record.result==='通过'?'success':record.result==='失败'?'error':'info'" :title="`${record.caseId} · ${record.result}`" :content="`${record.operator} ${record.startedAt}${record.finishedAt ? ' → '+record.finishedAt : ''}\n${record.snapshot ?? '版本待补齐'}${record.source ? ' · '+record.source : ''}${record.requestId ? ' · 请求号 '+record.requestId : ''}\n证据：${record.evidence.join('、') || '采集中'}${record.stale ? '\n⚠ 证据失效待重算' : ''}`" /></n-timeline><n-divider v-if="store.outbox.length" /><h3 v-if="store.outbox.length">断网登记（请求号不变）</h3><div v-for="o in store.outbox" :key="o.requestId" class="outbox-row"><n-tag :type="o.status==='已确认'?'success':'info'" size="small">{{o.status}}</n-tag><code>{{o.requestId}}</code><small>{{o.caseId}} · {{o.operator}} · {{o.result}}</small></div><n-button block>导出执行报告</n-button></aside></div>
</template>
