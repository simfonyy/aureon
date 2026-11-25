<template>
  <button type="button" class="extra-source" :class="{ on: selected }" aria-haspopup="menu"
    :aria-expanded="opened" :aria-label="selected ? 'Другие источники: ' + selected.label : 'Другие источники'">
    {{ selected?.label ?? 'Другие' }}
    <Icon name="chevronDown" :size="12" />
    <q-menu v-model="opened" class="menu" :offset="[0, 4]">
      <q-list role="menu" dense>
        <q-item v-for="source in extraSources" :key="source.id" clickable v-close-popup
          role="menuitemradio" :aria-checked="source.id === modelValue" @click="emit('select', source.id)">
          <q-item-section>{{ source.label }}</q-item-section>
          <q-item-section v-if="source.id === modelValue" side><Icon name="check" :size="14" /></q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import type { LyricsSource } from '@/stores/ui/defaults';

const extraSources = [
  { id: 'netease', label: 'NetEase' },
  { id: 'kugou', label: 'KuGou' },
  { id: 'qqmusic', label: 'QQ Music' },
] as const;

const props = defineProps<{ modelValue: LyricsSource }>();
const emit = defineEmits<{ select: [source: typeof extraSources[number]['id']] }>();
const opened = ref(false);
const selected = computed(() => extraSources.find(source => source.id === props.modelValue));
</script>

<style scoped>
.extra-source { display: inline-flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap; }
</style>
