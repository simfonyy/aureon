import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { coverPaletteStyle, getCoverPalette, type CoverPalette } from '@/lib/coverPalette';

export function useCoverPalette(source: MaybeRefOrGetter<string | null | undefined>) {
  const palette = ref<CoverPalette | null>(null);
  const pending = ref(false);
  let revision = 0;
  let disposed = false;
  watch(() => toValue(source), async value => {
    const request = ++revision;
    palette.value = null;
    const url = value?.trim();
    pending.value = Boolean(url);
    if (!url) return;
    const next = await getCoverPalette(url);
    if (disposed || request !== revision) return;
    palette.value = next;
    pending.value = false;
  }, { immediate: true });
  onScopeDispose(() => { disposed = true; revision++; pending.value = false; });
  return { palette, pending, style: computed(() => coverPaletteStyle(palette.value)) };
}
