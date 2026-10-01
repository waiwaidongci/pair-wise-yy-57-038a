<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const ready = computed(() => store.readyToRelease)
const blocking = computed(() => {
  const list: string[] = []
  store.staleCases.forEach((c) => list.push(`${c.id} 证据失效待重算`))
  store.reviewRecords.filter((r) => r.status === '待复核').forEach((r) => list.push(`复核项 ${r.id} 未处理`))
  if (store.pendingOutboxCount) list.push(`${store.pendingOutboxCount} 项断网登记未补传`)
  store.cases.filter((c) => c.status !== '通过').forEach((c) => list.push(`${c.id} 未通过（${c.status}）`))
  return list
})
function lockBaseline() { store.lockBaseline() }
function exportPackage() {
  const report = {
    station:'海州站 CS', snapshot:store.snapshot.id, software:store.snapshot.software, leu:store.snapshot.leu,
    locked:store.baselineLocked, cases:store.cases.map((item)=>({id:item.id,name:item.name,status:item.status,stale:item.stale,snapshot:item.snapshot,steps:item.steps.length,failureReason:item.failureReason})),
    executions:store.executions, reviewRecords:store.reviewRecords, outbox:store.outbox,
    generatedAt:new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'})
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download=`联锁测试报告-${store.snapshot.software}.json`; link.click(); URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>锁定前重新核对当前快照：失效证据、未处理复核项、未补传登记和未通过用例一律拦截。</p></div><n-space><n-button @click="exportPackage">导出测试报告</n-button><n-button type="primary" :disabled="!ready || store.baselineLocked" @click="lockBaseline">锁定发布基线</n-button></n-space></section>
  <n-alert :type="ready ? 'success' : 'error'" :title="ready ? '全部用例已通过，可锁定' : '发布门禁未通过'" :description="ready ? `已核对当前快照 ${store.snapshot.id}，设备快照、执行证据、复核与补传均完整。` : '存在失效证据、未处理复核、未补传或未通过项，任何人员不得无痕跳过。'" style="margin-bottom:16px" />
  <n-alert v-if="store.baselineError.length" type="error" title="基线锁定已拦截（重新核对当前快照）" style="margin-bottom:16px">
    <ul class="block-list"><li v-for="e in store.baselineError" :key="e">{{e}}</li></ul>
  </n-alert>
  <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>自动判断，不允许人工绕过</p></div><n-tag :type="ready?'success':'error'">{{ready?'可发布':'阻断'}}</n-tag></div><div v-for="item in store.cases" :key="item.id" class="gate"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.failureReason || (item.stale ? '证据失效待重算' : '执行记录完整')}}</small></div><n-space><n-tag v-if="item.stale" type="warning">失效</n-tag><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':'warning'">{{item.status}}</n-tag></n-space></div><n-divider /><div v-for="b in blocking" :key="b" class="gate"><div><b>{{b}}</b><small>锁定前必须闭环</small></div><n-tag type="error">阻断</n-tag></div></article>
    <article class="card"><div class="panel-head"><div><h2>差异与影响范围</h2><p>v26.09 → {{store.snapshot.software}}</p></div><n-tag>{{store.changes.length}} 项设备变更</n-tag></div><div v-for="ch in store.changes" :key="ch.id" class="diff"><b>{{ch.description}}</b><p>影响进路 {{store.affectedRouteNames.join('、')}}；{{store.affectedCases.length}} 条用例需重算。</p></div><n-divider /><h3>基线状态</h3><n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? `${store.snapshot.id} 已锁定` : '等待全部用例通过与复核闭环'" :description="store.baselineLocked ? '报告与证据哈希已签章。' : '锁定时重新核对当前快照，未处理复核项挡住发布。'" /></article></div>
</template>
