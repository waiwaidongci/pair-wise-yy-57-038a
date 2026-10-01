<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { fetchStation } from '../api'
import { useTestStore } from '../store'
import { useExecutionSocket } from '../realtime'
import ReviewBadge from '../components/ReviewBadge.vue'

const store = useTestStore()
const { data, isPending } = useQuery({ queryKey:['station'], queryFn:fetchStation })
useExecutionSocket((value) => store.updateLiveProgress(value), (state) => { store.connection = state })

const stats = computed(() => [
  { label:'测试用例', value:store.cases.length, note:`关联 ${store.routes.length} 条进路 · 同一快照 ${store.activeSnapshot.id}` },
  { label:'执行进度', value:`${store.progress}%`, note:`指纹 ${store.activeSnapshot.fingerprint}` },
  { label:'失败 / 阻塞 / 待重测', value:store.cases.filter((item)=>['失败','阻塞','待重测'].includes(item.status)).length, note:'发布前必须闭环' },
  { label:'受影响回归范围', value:store.affectedCases.length, note:'设备关系变更自动推导' },
])
const statusTag = (status: string) =>
  status === '通过' ? 'success' : status === '失败' ? 'error' : status === '阻塞' ? 'warning' : status === '待重测' ? 'warning' : 'info'
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">版本升级与回归范围</p><h1>联锁测试回归总览</h1><p>设备、进路、用例、执行记录与发布基线共用同一份版本快照；关系一变，受影响用例与证据失效重算。</p></div>
    <n-space><ReviewBadge /><n-button type="primary" @click="$router.push('/station')">查看站场受影响区域</n-button></n-space>
  </section>
  <n-spin :show="isPending">
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{item.label}}</span><strong>{{item.value}}</strong><small>{{item.note}}</small></article></div>
    <div class="grid-2">
      <article class="card">
        <div class="panel-head"><div><h2>本轮变更影响</h2><p>基于设备↔进路关系指纹自动计算</p></div><n-tag type="warning">{{data?.version ?? store.activeSnapshot.version}} · {{store.activeSnapshot.id}}</n-tag></div>
        <div v-for="change in store.changedDeviceNames" :key="change" class="change">
          <n-tag type="error">设备变更</n-tag>
          <div><b>{{change}}</b><small>影响 {{store.affectedCases.length}} 条用例 · 关系改动后证据自动失效，需重测失败路径与敌对互锁</small></div>
        </div>
        <n-alert type="warning" title="回归范围不能缩减" description="P-02 与 T-03 变更具有跨进路影响；关系再变会按新指纹重新推导，只有版本控制负责人可审批范围例外。" />
      </article>
      <article class="card">
        <div class="panel-head"><div><h2>执行状态</h2><p>按用例和失败步骤汇总</p></div><n-space><ReviewBadge /><n-tag>{{store.progress}}%</n-tag></n-space></div>
        <n-progress type="line" :percentage="store.progress" :height="12" />
        <div v-for="item in store.cases" :key="item.id" class="case-row" @click="store.selectCase(item.id); $router.push('/execution')">
          <div>
            <b>{{item.id}} · {{item.name}}</b>
            <small>{{item.steps.filter((step)=>step.result!=='未执行').length}}/{{item.steps.length}} 步骤 · 关联 {{item.routeIds.join(' / ')}} · 快照 {{ item.valid ? item.snapshotId : '已失效' }}</small>
          </div>
          <n-tag :type="statusTag(item.status)">{{item.status}}</n-tag>
        </div>
      </article>
    </div>
  </n-spin>
</template>
