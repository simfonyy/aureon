<template>
  <q-dialog :model-value="modelValue" :persistent="tools.recordingActive" @update:model-value="emit('update:modelValue', $event)">
    <div class="audio-tools">
      <header><h2>Звук</h2><button class="icon-btn round" type="button" aria-label="Закрыть" :disabled="tools.recordingActive" @click="emit('update:modelValue', false)"><Icon name="close" :size="19" /></button></header>
      <section>
        <div class="audio-tools-heading"><h3>Темп и тональность</h3><button class="btn audio-tools-reset" type="button" @click="reset">Сбросить</button></div>
        <label class="audio-tools-control"><span>Темп <b>{{ player.playbackRate.toFixed(2) }}×</b></span><input aria-label="Темп" type="range" min="0.5" max="2" step="0.05" :value="player.playbackRate" @input="changeTempo" /></label>
        <label class="audio-tools-control"><span>Тональность <b>{{ tools.pitch > 0 ? '+' : '' }}{{ tools.pitch }} пт</b></span><input aria-label="Тональность в полутонах" type="range" min="-12" max="12" step="1" :disabled="tools.pitchBusy" :value="tools.pitch" @change="changePitch" /></label>
        <p class="audio-tools-note">Темп меняется без изменения тональности.</p>
        <p v-if="tools.pitchBusy" class="audio-tools-note" role="status">Подготовка звука…</p>
        <p v-if="tools.pitchError" class="audio-tools-error" role="alert">{{ tools.pitchError }}</p>
      </section>
      <section>
        <h3>Устройства</h3>
        <label class="audio-tools-control"><span>Выход</span><select aria-label="Звуковой выход" :value="tools.outputId" :disabled="!tools.outputSupported || tools.outputBusy" @change="changeOutput"><option value="">Системный выход</option><option v-for="(device, index) in tools.outputs" :key="device.deviceId" :value="device.deviceId">{{ device.label || `Выход ${index + 1}` }}</option></select></label>
        <p v-if="!tools.outputSupported" class="audio-tools-note">Выбери выход в настройках звука системы.</p>
        <div class="audio-tools-device-actions"><button class="btn" type="button" :disabled="tools.devicesBusy || !tools.recordingSupported" @click="tools.allowDevices">Разрешить устройства</button><button class="btn" type="button" @click="tools.refreshDevices">Обновить</button></div>
        <p class="audio-tools-note">Список устройств открывается с разрешением на микрофон. Эта кнопка ничего не записывает.</p>
        <p v-if="tools.deviceError" class="audio-tools-error" role="alert">{{ tools.deviceError }}</p>
      </section>
      <section>
        <div class="audio-tools-heading"><h3>Запись голоса</h3><span class="audio-tools-time" :class="{ active: tools.recordingState === 'recording' }">{{ clock(tools.duration) }}</span></div>
        <p class="audio-tools-note">Только микрофон, без музыки. До 15 минут.</p>
        <label v-if="!tools.recordingUrl" class="audio-tools-control"><span>Микрофон</span><select v-model="tools.microphoneId" aria-label="Микрофон" :disabled="tools.recordingActive"><option value="">Системный микрофон</option><option v-for="(device, index) in tools.microphones" :key="device.deviceId" :value="device.deviceId">{{ device.label || `Микрофон ${index + 1}` }}</option></select></label>
        <div v-if="!tools.recordingUrl" class="audio-tools-record-actions">
          <button v-if="!tools.recordingActive" class="btn-solid" type="button" :disabled="!tools.recordingSupported" @click="startRecording">Начать запись</button>
          <button v-else class="btn audio-tools-stop" type="button" :disabled="tools.recordingState === 'stopping'" @click="tools.stopRecording">{{ tools.recordingState === 'requesting' ? 'Отменить' : tools.recordingState === 'stopping' ? 'Остановка…' : 'Остановить' }}</button>
        </div>
        <div v-else class="audio-tools-result">
          <audio :src="tools.recordingUrl" controls preload="metadata" aria-label="Прослушать запись" />
          <input v-model="tools.recordingName" aria-label="Имя записи" maxlength="120" type="text" />
          <div class="audio-tools-record-actions"><button class="btn-solid" type="button" :disabled="tools.saving || !tools.recordingName.trim()" @click="tools.saveRecording">{{ tools.saving ? 'Сохранение…' : 'Сохранить' }}</button><button class="btn" type="button" :disabled="tools.saving" @click="tools.clearRecording">Удалить</button></div>
        </div>
        <p v-if="!tools.recordingSupported" class="audio-tools-note">Запись микрофона недоступна в этой версии приложения.</p>
        <p v-if="tools.recordingState === 'requesting'" class="audio-tools-note" role="status">Разреши доступ к микрофону в открывшемся окне.</p>
        <p v-if="tools.savedPath" class="audio-tools-note audio-tools-path" role="status">Сохранено: {{ tools.savedPath }}</p>
        <p v-if="tools.recordingError" class="audio-tools-error" role="alert">{{ tools.recordingError }}</p>
      </section>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { usePlayerStore } from '@/stores/player/index';
import { useAudioToolsStore } from '@/stores/audioTools';
import { artistNames } from '@/lib/format';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const player = usePlayerStore(), tools = useAudioToolsStore();
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
function changeTempo(event: Event) { player.setPlaybackRate(Number((event.target as HTMLInputElement).value)); }
function changePitch(event: Event) { void tools.changePitch(Number((event.target as HTMLInputElement).value)); }
function changeOutput(event: Event) { void tools.changeOutput((event.target as HTMLSelectElement).value); }
function reset() { player.setPlaybackRate(1); void tools.changePitch(0); }
function startRecording() {
  const track = player.current;
  const name = track ? `${artistNames(track.artists)} — ${track.title}` : 'Запись';
  void tools.startRecording(`${name} — ${new Date().toLocaleDateString('ru-RU')}`);
}
watch(() => props.modelValue, open => {
  if (open) void tools.refreshDevices();
  else if (tools.recordingActive) void tools.stopRecording();
}, { immediate: true });
onBeforeUnmount(() => { tools.cancelRecording(); });
</script>

<style scoped>
.audio-tools{width:510px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 40px);overflow:auto;background:var(--surface);color:var(--fg);border:1px solid var(--line);border-radius:18px;padding:22px}
.audio-tools header,.audio-tools-heading,.audio-tools-control>span{display:flex;align-items:center;justify-content:space-between;gap:12px}
.audio-tools header{margin-bottom:6px}.audio-tools h2{font-size:21px;font-weight:650;line-height:1.3;margin:0}.audio-tools h3{font-size:14px;font-weight:600;margin:0;line-height:1.5}
.audio-tools section{padding:19px 0;border-bottom:1px solid var(--line)}.audio-tools section:last-child{padding-bottom:0;border:0}.audio-tools-control{display:grid;gap:10px;font-size:13px;margin-top:17px}.audio-tools-control b{font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--fg-dim)}
.audio-tools input[type=range]{display:block;accent-color:var(--accent);width:100%;height:18px;cursor:pointer}.audio-tools input:disabled{cursor:wait;opacity:.5}
.audio-tools select,.audio-tools input[type=text]{width:100%;border:1px solid var(--line);background:var(--surface-2);color:var(--fg);border-radius:8px;padding:10px 11px;font:inherit;font-size:12px}.audio-tools select:disabled{opacity:.55}
.audio-tools-note{font-size:12px;line-height:1.55;color:var(--fg-dim);margin:11px 0 0}.audio-tools-error{font-size:12px;line-height:1.5;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px 11px;background:var(--bg);margin:12px 0 0}.audio-tools .btn,.audio-tools .btn-solid{font-size:12px;padding:8px 12px;min-height:32px}.audio-tools-reset{padding:4px 8px!important;min-height:28px!important}
.audio-tools-device-actions,.audio-tools-record-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.audio-tools-time{color:var(--fg-dim);font-size:12px;font-variant-numeric:tabular-nums}.audio-tools-time.active{color:var(--fg);font-weight:600}.audio-tools-stop{border-color:var(--accent);color:var(--fg)}.audio-tools-result{display:grid;gap:12px;margin-top:15px}.audio-tools-result audio{width:100%;height:40px}.audio-tools-result .audio-tools-record-actions{margin-top:0}.audio-tools-path{overflow-wrap:anywhere;color:var(--fg)}
</style>
