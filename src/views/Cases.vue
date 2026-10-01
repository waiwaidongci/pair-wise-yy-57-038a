<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import ReviewBadge from '../components/ReviewBadge.vue'

const store = useTestStore()
const editMode = ref(false)
const selectedCase = computed(() => store.selectedCase)
const tagType = (status: string) =>
  status === '通过' ? 'success'
    : status === '失败' ? 'error'
      : status === '待重测' ? 'warning'
        : status === '阻塞' ? 'warning' : 'info'
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">步骤、预期与依赖（挂接版本快照）</p><h1>测试用例编排</h1><p>用例关联进路与设备快照；设备或进路关系变化时，受影响用例自动失效并重算回归范围。</p></div>
    <n-space><ReviewBadge /><n-switch v-model:value="editMode">批量编辑模式</n-switch><n-button type="primary" :disabled="store.baselineLocked">新增用例</n-button></n-space>
  </section>
  <div class="case-grid">
    <aside class="card case-list">
      <n-input placeholder="搜索用例、进路或设备" clearable />
      <button v-for="item in store.cases" :key="item.id" :class="{active:item.id===store.selectedCaseId}" @click="store.selectCase(item.id)">
        <div><b>{{item.id}}</b><small>{{item.name}}</small><small class="snap-line">{{ item.valid ? item.snapshotId : '快照失效' }} · {{item.routeIds.join('/')}}</small></div>
        <n-tag :type="tagType(item.status)">{{item.status}}</n-tag>
      </button>
    </aside>
    <article class="card detail" v-if="selectedCase">
      <div class="panel-head">
        <div><h2>{{selectedCase.id}} · {{selectedCase.name}}</h2><p>{{selectedCase.precondition}}</p></div>
        <n-space>
          <n-tag :type="selectedCase.snapshotId === store.activeSnapshot.id ? 'info' : 'default'">
            {{ selectedCase.snapshotId || '无快照' }}
          </n-tag>
          <n-tag :type="selectedCase.valid ? 'success' : 'error'">{{ selectedCase.valid ? '证据有效' : '已失效待重测' }}</n-tag>
        </n-space>
      </div>
      <n-alert v-if="!selectedCase.valid" type="warning" title="关系变更导致失效" :description="selectedCase.invalidReason" style="margin-bottom:10px" />
      <n-alert v-else-if="selectedCase.failureReason" type="error" title="当前阻塞 / 失败原因" :description="selectedCase.failureReason" />
      <h3>执行步骤与依赖</h3>
      <div v-for="(step,index) in selectedCase.steps" :key="step.id" class="step">
        <div class="step-index">{{index+1}}</div>
        <div class="step-main">
          <div class="step-head"><b>{{step.action}}</b>
            <n-space :size="6">
              <n-tag v-if="step.evidence && step.evidenceValid === false" size="small" type="warning">证据已失效</n-tag>
              <n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'info'">{{step.result}}</n-tag>
            </n-space>
          </div>
          <p>预期：{{step.expected}}</p>
          <small v-if="step.dependency">依赖步骤：{{step.dependency}}</small>
          <small v-if="step.actual">实测：{{step.actual}}</small>
          <small v-if="step.evidence">证据：{{step.evidence}}{{ step.evidenceValid === false ? '（随关系变更失效）' : '' }}</small>
        </div>
        <n-button v-if="editMode" size="small" type="primary" :disabled="store.baselineLocked" @click="store.setStepResult(selectedCase.id,step.id,'通过','批量编辑确认')">标记通过</n-button>
      </div>
      <n-divider />
      <div class="dependency"><b>依赖图</b><div class="nodes"><span v-for="step in selectedCase.steps" :key="step.id">{{step.id}}</span></div><div class="lines">→ 顺序执行 · 前一步未通过时不得跳过 · 重测证据自动挂当前快照</div></div>
    </article>
  </div>
</template>
