<template>
  <section class="creative-cassette" :class="{ 'is-playing': player.isPlaying && creative.motionAllowed, preview }" :style="{ '--cassette-h': preview ? `${ui.settings.miniHeight}px` : '100vh' }" @mousedown="drag" @dblclick.self="restore">
    <div class="cassette-label" @dblclick="restore">
      <img v-if="player.current?.cover_url" :src="player.current.cover_url" alt="" />
      <div><strong>{{ player.current?.title || 'Ничего не играет' }}</strong><small>{{ artistNames(player.current?.artists || []) || 'Aureon' }}</small></div>
      <button data-no-drag type="button" aria-label="Обычный плеер" @click.stop="restore"><Icon name="restore" :size="15" /></button>
    </div>
    <svg class="cassette-mechanism" viewBox="0 0 400 84" aria-hidden="true">
      <rect x="35" y="6" width="330" height="72" rx="28" class="cassette-window" />
      <path d="M98 18h204v48H98Z" class="cassette-tape" />
      <g v-for="cx in [98, 302]" :key="cx" :transform="`translate(${cx} 42)`"><circle :r="cx === 98 ? 31 - percent * .11 : 20 + percent * .11" class="cassette-roll" /><g class="cassette-reel"><circle r="14" /><path v-for="angle in [0,60,120,180,240,300]" :key="angle" :transform="`rotate(${angle})`" d="M0-8v-7" /></g></g>
      <path d="M129 42h142" class="cassette-guideline" />
    </svg>
    <input class="cassette-seek" data-no-drag type="range" :value="player.progress" :max="Math.max(player.duration, 1)" step=".1" min="0" aria-label="Позиция трека" :disabled="!player.current" @input="player.seek(Number(($event.target as HTMLInputElement).value))" />
    <div class="cassette-bottom" data-no-drag>
      <span class="creative-time">{{ formatDuration(player.progress * 1000) }}</span>
      <div class="cassette-controls">
        <button type="button" aria-label="Предыдущий трек" :disabled="!player.current" @click.stop="player.prev()"><Icon name="prev" :size="17" /></button>
        <motion.button type="button" class="cassette-play" :aria-label="player.isPlaying ? 'Пауза' : 'Играть'" :disabled="!player.current || player.loading" :while-press="creative.motionAllowed ? { scale: .9 } : undefined" @click.stop="player.toggle()"><Icon :name="player.isPlaying ? 'pause' : 'play'" :size="18" /></motion.button>
        <button type="button" aria-label="Следующий трек" :disabled="!player.current" @click.stop="player.next(false)"><Icon name="next" :size="17" /></button>
        <button type="button" :aria-label="liked ? 'Убрать из любимых' : 'В любимые'" :aria-pressed="liked" :disabled="!player.current" @click.stop="player.like()"><FeedbackHeart :active="liked" :size="16" /></button>
      </div>
      <label class="cassette-volume"><Icon name="volume" :size="13" /><input type="range" min="0" max="1" step=".01" :value="player.muted ? 0 : player.volume" aria-label="Громкость" @input="player.setVolume(Number(($event.target as HTMLInputElement).value))" /></label>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { motion } from 'motion-v';
import Icon from '@/components/Icon.vue';
import FeedbackHeart from './FeedbackHeart.vue';
import { useCreativeStore } from '@/stores/creative';
import { usePlayerStore } from '@/stores/player/index';
import { useLibraryStore } from '@/stores/library';
import { usePanelsStore } from '@/stores/panels';
import { useUiStore } from '@/stores/ui/index';
import { artistNames, formatDuration } from '@/lib/format';
import { startWindowDrag } from '@/lib/window';
import { api } from '@/api/client';
const props = withDefaults(defineProps<{ preview?: boolean }>(), { preview: false });
const player = usePlayerStore(), library = useLibraryStore(), creative = useCreativeStore(), panels = usePanelsStore(), ui = useUiStore();
const liked = computed(() => player.current ? library.liked(player.current.id) : false);
const percent = computed(() => Math.min(100, Math.max(0, player.duration ? player.progress / player.duration * 100 : 0)));
function drag(event: MouseEvent) { if (!props.preview) startWindowDrag(event); }
function restore() { if (!props.preview) void panels.exitMini(); }
function key(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); restore(); } }
onMounted(() => { if (props.preview) return; document.documentElement.dataset.mini = '1'; window.addEventListener('keydown', key); void api.resizeMiniPlayer(ui.settings.miniWidth, ui.settings.miniHeight); });
onBeforeUnmount(() => { window.removeEventListener('keydown', key); if (!props.preview) delete document.documentElement.dataset.mini; });
</script>
<style scoped>
.creative-cassette{height:var(--cassette-h);width:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;padding:10px 16px;background:var(--surface);color:var(--fg);border:1px solid var(--line);overflow:hidden;user-select:none}.cassette-label{display:flex;align-items:center;gap:10px;min-height:38px}.cassette-label img{height:34px;width:34px;border-radius:5px;object-fit:cover}.cassette-label div{min-width:0;flex:1}.cassette-label strong,.cassette-label small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.cassette-label strong{font-size:12px;font-weight:600}.cassette-label small{font-size:10px;color:var(--fg-dim);margin-top:3px}.creative-cassette button{background:transparent;border:0;color:inherit;display:inline-flex;align-items:center;justify-content:center;padding:6px;border-radius:7px;cursor:pointer}.creative-cassette button:focus-visible,.creative-cassette input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.creative-cassette button:hover{background:var(--hover)}.creative-cassette button:disabled{opacity:.4;cursor:default}.cassette-mechanism{display:block;width:100%;min-height:30px;max-height:70px;flex:1;color:var(--fg-dim)}.cassette-window{fill:var(--bg);stroke:var(--line)}.cassette-tape{fill:var(--surface-2)}.cassette-roll{fill:none;stroke:var(--fg-faint);stroke-width:7;opacity:.5}.cassette-reel{fill:var(--surface-2);stroke:var(--fg-dim);stroke-width:2;transform-box:fill-box;transform-origin:center;animation:cassette-spin 4s linear infinite;animation-play-state:paused}.is-playing .cassette-reel{animation-play-state:running}.cassette-guideline{fill:none;stroke:var(--line);stroke-width:2}.cassette-seek{width:100%;height:3px;margin:3px 0 6px;accent-color:var(--fg);cursor:pointer}.cassette-bottom{display:flex;align-items:center;gap:8px;justify-content:space-between}.creative-time{font-size:10px;color:var(--fg-dim);min-width:28px}.cassette-controls{display:flex;align-items:center;gap:2px}.cassette-volume{display:flex;align-items:center;gap:4px;width:62px;color:var(--fg-dim)}.cassette-volume input{width:42px;height:3px;accent-color:var(--fg)}.cassette-play{background:var(--surface-2)!important}.preview{pointer-events:none}@keyframes cassette-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.cassette-reel{animation:none}}@media(max-height:155px){.cassette-mechanism{max-height:36px}.creative-cassette{padding:5px 12px}.cassette-label{min-height:28px}.cassette-label img{width:25px;height:25px}}@media(max-width:310px){.cassette-volume{display:none}}
</style>
