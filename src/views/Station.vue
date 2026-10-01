<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const canvas = ref<HTMLCanvasElement>()
const zoom = ref(1)
let ctx: CanvasRenderingContext2D | undefined
let resizeObserver: ResizeObserver | undefined

function draw() {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  element.width = rect.width * ratio
  element.height = rect.height * ratio
  const context = element.getContext('2d')
  if (!context) return
  ctx = context
  context.scale(ratio, ratio)
  context.clearRect(0, 0, rect.width, rect.height)
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, rect.width, rect.height)
  const unitX = rect.width / 100 * zoom.value
  const unitY = rect.height / 100 * zoom.value
  const offsetX = (rect.width - 100 * unitX) / 2
  const offsetY = (rect.height - 100 * unitY) / 2
  context.strokeStyle = '#e2e8f0'; context.lineWidth = 1
  for (let i=0;i<=100;i+=5) { context.beginPath(); context.moveTo(offsetX+i*unitX,offsetY); context.lineTo(offsetX+i*unitX,offsetY+100*unitY); context.stroke(); context.beginPath(); context.moveTo(offsetX,offsetY+i*unitY); context.lineTo(offsetX+100*unitX,offsetY+i*unitY); context.stroke() }
  context.lineCap = 'round'; context.lineJoin = 'round'
  store.routes.forEach((route) => {
    const selected = store.selectedRouteIds.includes(route.id)
    context.beginPath(); route.points.forEach((point,index)=>{ const x=offsetX+point[0]*unitX, y=offsetY+point[1]*unitY; if(index===0)context.moveTo(x,y); else context.lineTo(x,y) })
    context.strokeStyle = selected ? route.color : '#94a3b8'; context.lineWidth = selected ? 7 : 3; context.globalAlpha = selected ? 1 : .42; context.stroke(); context.globalAlpha = 1
  })
  store.devices.forEach((device) => {
    const active = store.selectedCase?.routeIds.some((routeId) => device.routeIds.includes(routeId))
    const changed = store.activeSnapshot.changedDeviceIds.includes(device.id)
    context.beginPath(); context.arc(offsetX+device.x*unitX, offsetY+device.y*unitY, active ? 12 : 8, 0, Math.PI*2)
    context.fillStyle = changed ? '#dc2626' : device.kind === '道岔' ? (active ? '#d97706' : '#94a3b8') : device.kind === '信号机' ? (active ? '#16a34a' : '#64748b') : (active ? '#2563eb' : '#cbd5e1'); context.fill(); context.strokeStyle='#fff'; context.lineWidth=changed && !active ? 4 : 3; context.stroke()
    context.fillStyle = '#0f172a'; context.font = '600 12px sans-serif'; context.fillText(device.id, offsetX+device.x*unitX+13, offsetY+device.y*unitY-10)
  })
}
function hitTest(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const unitX = rect.width / 100 * zoom.value
  const unitY = rect.height / 100 * zoom.value
  const offsetX = (rect.width - 100 * unitX) / 2
  const offsetY = (rect.height - 100 * unitY) / 2
  const x=event.offsetX, y=event.offsetY
  let closest = store.routes[0]!; let distance = Infinity
  store.routes.forEach((route)=>{ route.points.forEach((point)=>{ const d=Math.hypot(offsetX+point[0]*unitX-x,offsetY+point[1]*unitY-y); if(d<distance){distance=d;closest=route} }) })
  if (distance < 45) store.selectedRouteIds=[closest.id]
}
onMounted(async()=>{ await nextTick(); draw(); resizeObserver=new ResizeObserver(draw); resizeObserver.observe(canvas.value!) })
onBeforeUnmount(()=>resizeObserver?.disconnect())
watch(()=>store.selectedCaseId, draw)
watch(()=>store.selectedRouteIds, draw, { deep:true })
watch(()=>store.devices, draw, { deep:true })
watch(()=>store.activeSnapshot.fingerprint, draw)

const selectedRoutes = computed(() => store.routes.filter((r) => store.selectedRouteIds.includes(r.id)))
const impactAlerts = computed(() =>
  selectedRoutes.value.flatMap((route) =>
    store.activeSnapshot.changedDeviceIds
      .map((id) => store.devices.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => !!d && route.devices.includes(d.id))
      .map((d) => `${route.id} ${route.name}：${d.id} ${d.name} 已在本轮变更，用例证据失效需重测`)))
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">站场与进路关系（同一版本快照）</p>
      <h1>Canvas 站场示意</h1>
      <p>红色设备为本轮变更设备；调整设备↔进路关系后，受影响用例与证据立即失效重算，快照指纹同步更新。</p>
    </div>
    <n-space>
      <n-button @click="zoom=Math.max(.7,zoom-.1); draw()">缩小</n-button>
      <span>{{Math.round(zoom*100)}}%</span>
      <n-button @click="zoom=Math.min(1.5,zoom+.1); draw()">放大</n-button>
    </n-space>
  </section>

  <n-alert type="info" class="snap-line" :bordered="false">
    <template #title>
      活动快照 {{ store.activeSnapshot.id }} · 指纹 {{ store.activeSnapshot.fingerprint }}
      <span v-if="store.activeSnapshot.fingerprint === store.prevSnapshot.fingerprint">（与锁定基线 {{ store.prevSnapshot.id }} 相同）</span>
      <span v-else class="fp-drift">（已偏离基线 {{ store.prevSnapshot.fingerprint }}）</span>
    </template>
    {{ store.activeSnapshot.changeNote }} · 受影响用例 {{ store.affectedCases.length }} 条 · 失效 {{ store.invalidCases.length }} 条
  </n-alert>

  <div class="station-grid">
    <article class="card canvas-card">
      <div class="canvas-head"><span>海州站 · 计算机联锁平面示意</span><span>红圈=变更设备 · 高亮=当前用例进路</span></div>
      <canvas ref="canvas" class="station-canvas" @click="hitTest" />
    </article>
    <aside class="card">
      <div class="panel-head"><div><h2>进路关系</h2><p>点击高亮，勾选设备调整归属</p></div><n-tag>{{store.selectedRouteIds.length}} 条</n-tag></div>
      <button v-for="route in store.routes" :key="route.id" class="route-row" :class="{active:store.selectedRouteIds.includes(route.id)}" @click="store.selectedRouteIds=[route.id]">
        <i :style="{background:route.color}"></i>
        <div><b>{{route.id}} · {{route.name}}</b><small>{{route.devices.join(' → ')}}</small></div>
      </button>
      <n-divider />
      <h3>编辑设备↔进路关系</h3>
      <p class="muted" v-if="!selectedRoutes.length">先选择一条进路</p>
      <div v-for="route in selectedRoutes" :key="route.id" class="route-edit">
        <b>{{ route.id }} 上的设备（{{ route.devices.length }}）</b>
        <n-checkbox
          v-for="device in store.devices" :key="device.id"
          :checked="device.routeIds.includes(route.id)"
          @update:checked="store.toggleDeviceRoute(device.id, route.id)">
          {{ device.id }} {{ device.name }}
          <n-tag v-if="store.activeSnapshot.changedDeviceIds.includes(device.id)" size="small" type="error" style="margin-left:6px">变更</n-tag>
        </n-checkbox>
      </div>
      <n-divider />
      <h3>变更影响</h3>
      <n-alert v-for="(item, idx) in impactAlerts" :key="idx" type="error" :title="item" class="issue" />
      <n-empty v-if="!impactAlerts.length" description="选中进路无变更设备" size="small" />
    </aside>
  </div>
</template>
