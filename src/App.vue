<script setup lang="ts">
import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NBadge, NTag } from 'naive-ui'
import { useTestStore } from './store'

const route = useRoute()
const router = useRouter()
const store = useTestStore()
const nav = computed(() => [
  { name:'overview', label:'回归总览' },
  { name:'station', label:'站场与进路' },
  { name:'cases', label:'测试用例' },
  { name:'execution', label:'执行记录', badge:store.pendingReviewCount },
  { name:'release', label:'基线与报告', badge:store.pendingReviewCount + store.pendingOutboxCount },
])
const menuOptions = computed(() => nav.value.map((item) => ({ key:item.name, label:item.label, badge:item.badge })))
function renderMenuLabel(option: { label: string; badge?: number }) {
  return h('span', { style:'display:inline-flex;align-items:center;gap:8px' }, [
    option.label,
    option.badge ? h(NBadge, { value:option.badge, type:'warning', max:99 }, { default:() => h(NTag, { size:'small', type:'warning' }, { default:() => '待复核' }) }) : null,
  ])
}
</script>

<template>
  <n-layout class="shell">
    <n-layout-sider :width="230" class="sider">
      <div class="brand"><span>联</span><div><b>信号联锁测试台</b><small>INTERLOCKING QA</small></div></div>
      <n-menu :value="String(route.name || 'overview')" :options="menuOptions" :render-label="renderMenuLabel" @update:value="(key: string) => router.push({ name:key })" />
      <div class="station-card"><i :class="store.connection === '在线' ? 'online' : 'offline'"></i><div><b>海州站 CS</b><small>快照 {{store.snapshot.software}} · {{store.connection}}</small></div></div>
    </n-layout-sider>
    <n-layout>
      <n-layout-header class="topbar"><div><b>海州站软件升级回归</b><small>联锁版本 {{store.snapshot.id}} · 计划发布 2026-10-03</small></div><div class="top-actions"><n-badge v-if="store.pendingReviewCount" :value="store.pendingReviewCount" type="warning" :max="99"><n-tag type="warning">待复核</n-tag></n-badge><n-badge v-if="store.pendingOutboxCount" :value="store.pendingOutboxCount" type="info" :max="99"><n-tag type="info">待补传</n-tag></n-badge><n-tag :type="store.connection === '在线' ? 'success' : 'warning'">{{ store.liveMessage }}</n-tag><n-button v-if="store.pendingRetry" type="warning" @click="store.retry">重试 {{store.pendingRetry}} 项</n-button><n-button type="primary" @click="store.startExecution">开始执行当前用例</n-button></div></n-layout-header>
      <n-layout-content class="main"><router-view /></n-layout-content>
    </n-layout>
  </n-layout>
</template>
