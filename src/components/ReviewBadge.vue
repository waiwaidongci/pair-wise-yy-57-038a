<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'

const props = withDefaults(defineProps<{ size?: 'small' | 'medium' }>(), { size: 'small' })
const store = useTestStore()
const text = computed(() => `待复核 ${store.pendingReviewCount} 项`)
</script>

<template>
  <n-badge :value="store.pendingReviewCount" :max="99" :show="store.pendingReviewCount > 0">
    <n-tag :size="props.size" :type="store.pendingReviewCount ? 'warning' : 'success'" round>
      {{ store.pendingReviewCount ? text : '复核已清零' }}
    </n-tag>
  </n-badge>
</template>
