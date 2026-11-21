<template>
  <section class="home-shelf" :aria-labelledby="headingId">
    <div class="home-shelf-heading">
      <h2 :id="headingId" class="home-section-title">{{ label }}</h2>
      <div class="home-shelf-actions">
        <button v-if="moreLabel" class="more-link" type="button" @click="emit('more')">
          <span>{{ moreLabel }}</span>
          <Icon name="chevronRight" :size="14" />
        </button>
        <div v-if="overflow" class="home-shelf-arrows">
          <button
            class="home-shelf-arrow"
            type="button"
            :disabled="!canPrevious"
            :aria-label="`Назад: ${label}`"
            :aria-controls="viewportId"
            @click="previous"
          >
            <Icon name="chevronLeft" :size="17" />
          </button>
          <button
            class="home-shelf-arrow"
            type="button"
            :disabled="!canNext"
            :aria-label="`Дальше: ${label}`"
            :aria-controls="viewportId"
            @click="next"
          >
            <Icon name="chevronRight" :size="17" />
          </button>
        </div>
      </div>
    </div>
    <div
      :id="viewportId"
      ref="emblaRef"
      class="home-shelf-viewport"
      :class="{ 'is-draggable': overflow, 'is-dragging': dragging }"
      :data-home-shelf-ready="ready ? '' : null"
      :tabindex="overflow ? 0 : -1"
      :aria-label="label"
      @keydown="onKeydown"
    >
      <div class="home-shelf-track"><slot /></div>
    </div>
  </section>
</template>

<script lang="ts">
// A shelf returns to the same page after visiting an album. This belongs to the
// current app session, rather than the user's permanent preferences.
const rememberedSnaps = new Map<string, number>();
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import emblaCarouselVue from 'embla-carousel-vue';
import Icon from '@/components/Icon.vue';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{ id: string; label: string; moreLabel?: string }>();
const emit = defineEmits<{ more: [] }>();
const ui = useUiStore();
const reducedMotion = ref(false);
const instant = computed(() => !ui.settings.animations || reducedMotion.value);
const headingId = computed(() => `home-shelf-${props.id}-heading`);
const viewportId = computed(() => `home-shelf-${props.id}-viewport`);
const ready = ref(false);
const dragging = ref(false);
const canPrevious = ref(false);
const canNext = ref(false);
const overflow = ref(false);
const options = computed(() => ({
  align: 'start' as const,
  containScroll: 'trimSnaps' as const,
  slidesToScroll: 'auto' as const,
  skipSnaps: true,
  duration: instant.value ? 0 : 28,
}));
const [emblaRef, emblaApi] = emblaCarouselVue(options);
type ShelfApi = NonNullable<typeof emblaApi.value>;
let restoring = false;
let disposed = false;
let reducedQuery: MediaQueryList | undefined;

function update(api: ShelfApi) {
  canPrevious.value = api.canScrollPrev();
  canNext.value = api.canScrollNext();
  overflow.value = api.scrollSnapList().length > 1;
  if (!restoring) rememberedSnaps.set(props.id, api.selectedScrollSnap());
}

async function restore(api: ShelfApi) {
  ready.value = false;
  restoring = true;
  const maximum = Math.max(0, api.scrollSnapList().length - 1);
  const saved = Math.min(maximum, rememberedSnaps.get(props.id) ?? 0);
  api.scrollTo(saved, true);
  update(api);
  restoring = false;
  rememberedSnaps.set(props.id, api.selectedScrollSnap());
  await nextTick();
  if (!disposed && emblaApi.value === api) ready.value = true;
}

function pointerDown() { dragging.value = true; }
function pointerUp() { dragging.value = false; }
function previous() { emblaApi.value?.scrollPrev(instant.value); }
function next() { emblaApi.value?.scrollNext(instant.value); }
function onKeydown(event: KeyboardEvent) {
  if (event.target !== emblaRef.value || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft') previous();
  else if (event.key === 'ArrowRight') next();
  else if (event.key === 'Home') emblaApi.value?.scrollTo(0, instant.value);
  else if (event.key === 'End') emblaApi.value?.scrollTo((emblaApi.value.scrollSnapList().length ?? 1) - 1, instant.value);
  else return;
  event.preventDefault();
}

function removeListeners(api: ShelfApi) {
  api.off('select', update).off('settle', update).off('reInit', restore)
    .off('pointerDown', pointerDown).off('pointerUp', pointerUp);
}

watch(emblaApi, (api, previousApi) => {
  if (previousApi) removeListeners(previousApi);
  if (!api) return;
  api.on('select', update).on('settle', update).on('reInit', restore)
    .on('pointerDown', pointerDown).on('pointerUp', pointerUp);
  void restore(api);
}, { flush: 'post' });

const updateReducedMotion = () => { reducedMotion.value = reducedQuery?.matches ?? false; };
onMounted(() => {
  reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  updateReducedMotion();
  reducedQuery.addEventListener('change', updateReducedMotion);
});
onBeforeUnmount(() => {
  disposed = true;
  if (emblaApi.value) {
    rememberedSnaps.set(props.id, emblaApi.value.selectedScrollSnap());
    removeListeners(emblaApi.value);
  }
  reducedQuery?.removeEventListener('change', updateReducedMotion);
});
</script>

<style scoped>
.home-shelf { min-width: 0; margin-top: var(--home-section-space, 36px); }
.home-shelf-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.home-shelf-heading h2 { margin: 0; }
.home-shelf-actions { display: flex; flex-shrink: 0; align-items: center; gap: 14px; }
.home-shelf-arrows { display: flex; gap: 5px; }
.home-shelf-arrow { display: grid; width: 29px; height: 29px; place-items: center; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--fg); cursor: pointer; transition: background 140ms ease, opacity 140ms ease; }
.home-shelf-arrow:hover:not(:disabled) { background: var(--hover); }
.home-shelf-arrow:disabled { opacity: .26; cursor: default; }
.home-shelf-arrow:focus-visible, .home-shelf-viewport:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.home-shelf-viewport { min-width: 0; overflow: hidden; touch-action: pan-y pinch-zoom; border-radius: 2px; }
.home-shelf-viewport.is-draggable { cursor: grab; }
.home-shelf-viewport.is-dragging { cursor: grabbing; }
.home-shelf-track { display: flex; gap: var(--home-shelf-gap, 20px); align-items: flex-start; }
.home-shelf-track :deep(> *) { min-width: 0; }
.home-shelf-track :deep(img) { user-select: none; -webkit-user-drag: none; }
@media (max-width: 760px) { .home-shelf-actions { gap: 8px; } }
@media (prefers-reduced-motion: reduce) { .home-shelf-arrow { transition: none; } }
</style>
