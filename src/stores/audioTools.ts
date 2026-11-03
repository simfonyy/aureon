import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { audioOutputSupported, currentPitchSemitones, onPitchChange, setAudioOutput, setPitchSemitones } from '@/lib/audio';
import { createMicrophoneRecorder, type MicrophoneRecording, type RecordingState } from '@/lib/microphoneRecorder';

function message(error: unknown, fallback: string): string {
  const name = (error as DOMException | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Доступ к устройству запрещён. Проверь разрешения Windows и приложения.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Устройство отключено или больше недоступно.';
  if (name === 'NotReadableError') return 'Микрофон занят другим приложением.';
  return error instanceof Error ? error.message : fallback;
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export const useAudioToolsStore = defineStore('audioTools', () => {
  const pitch = ref(currentPitchSemitones()), pitchBusy = ref(false), pitchError = ref('');
  const outputs = ref<MediaDeviceInfo[]>([]), microphones = ref<MediaDeviceInfo[]>([]);
  const outputId = ref(''), microphoneId = ref(''), outputBusy = ref(false), devicesBusy = ref(false), deviceError = ref('');
  const outputSupported = ref(false), recordingSupported = ref(false);
  const recordingState = ref<RecordingState>('idle'), recordingUrl = ref(''), recordingName = ref('Запись'), recordingError = ref('');
  const savedPath = ref(''), saving = ref(false), duration = ref(0);
  let recording: MicrophoneRecording | null = null, started = 0, ticker: ReturnType<typeof setInterval> | undefined;
  let watchingDevices = false;
  onPitchChange((value, error) => { pitch.value = value; if (error) pitchError.value = error; });
  const recorder = createMicrophoneRecorder({
    getStream: constraints => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    supported: mime => MediaRecorder.isTypeSupported(mime),
    onState: state => { recordingState.value = state; if (state === 'idle') clearInterval(ticker); },
    onLimit: () => { recordingError.value = 'Запись остановлена: достигнут лимит 15 минут или 32 МБ.'; void stopRecording(); },
    onError: () => { recordingError.value = 'Микрофон отключился. Доступная часть записи сохранена.'; },
  });
  const recordingActive = computed(() => recordingState.value !== 'idle');
  function inspectSupport() {
    outputSupported.value = typeof AudioContext !== 'undefined' && audioOutputSupported();
    recordingSupported.value = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }
  async function changePitch(value: number) {
    pitchBusy.value = true; pitchError.value = '';
    try { await setPitchSemitones(value); } catch (error) { pitchError.value = message(error, 'Не удалось изменить тональность.'); }
    finally { pitch.value = currentPitchSemitones(); pitchBusy.value = false; }
  }
  async function refreshDevices() {
    inspectSupport();
    if (!navigator.mediaDevices?.enumerateDevices) return;
    if (!watchingDevices) {
      watchingDevices = true;
      navigator.mediaDevices.addEventListener('devicechange', () => {
        void refreshDevices().then(async () => {
          if (outputId.value && !outputs.value.some(device => device.deviceId === outputId.value)) {
            await changeOutput('');
            if (!deviceError.value) deviceError.value = 'Устройство отключено. Выбран системный выход.';
          }
          if (microphoneId.value && !microphones.value.some(device => device.deviceId === microphoneId.value)) microphoneId.value = '';
        });
      });
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      outputs.value = devices.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default');
      microphones.value = devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default');
    } catch (error) { deviceError.value = message(error, 'Не удалось получить список устройств.'); }
  }
  async function allowDevices() {
    devicesBusy.value = true; deviceError.value = '';
    try {
      // Only this explicit button asks for access; the temporary stream is never recorded.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
      await refreshDevices();
    } catch (error) { deviceError.value = message(error, 'Не удалось открыть устройства.'); }
    finally { devicesBusy.value = false; }
  }
  async function changeOutput(value: string) {
    outputBusy.value = true; deviceError.value = '';
    try { await setAudioOutput(value); outputId.value = value; }
    catch (error) { deviceError.value = message(error, 'Не удалось переключить выход.'); }
    finally { outputBusy.value = false; }
  }
  function clearRecording() {
    if (recordingActive.value || saving.value) return;
    if (recordingUrl.value) URL.revokeObjectURL(recordingUrl.value);
    recordingUrl.value = ''; recording = null; savedPath.value = ''; duration.value = 0;
  }
  async function startRecording(name: string) {
    if (recording || recordingActive.value) return;
    recordingError.value = ''; savedPath.value = ''; recordingName.value = name || 'Запись';
    try {
      await recorder.start(microphoneId.value);
      if (recorder.state !== 'recording') return;
      started = performance.now(); duration.value = 0;
      ticker = setInterval(() => { duration.value = (performance.now() - started) / 1000; }, 250);
      void recorder.completed.then(acceptRecording);
      void refreshDevices();
    } catch (error) { recordingError.value = message(error, 'Не удалось начать запись.'); }
  }
  async function stopRecording() {
    const result = await recorder.stop(); clearInterval(ticker);
    acceptRecording(result);
  }
  function acceptRecording(result: MicrophoneRecording | null) {
    if (!result || recording) return;
    recording = result; duration.value = result.durationMs / 1000;
    recordingUrl.value = URL.createObjectURL(result.blob);
  }
  async function saveRecording() {
    if (!recording || saving.value) return;
    saving.value = true; recordingError.value = '';
    try {
      if (isTauri()) {
        savedPath.value = await invoke<string>('save_microphone_recording', { name: recordingName.value, mime: recording.mime, recordingBase64: await base64(recording.blob) });
      } else {
        const extension = recording.mime.includes('mp4') ? 'm4a' : recording.mime.includes('ogg') ? 'ogg' : 'webm';
        const link = document.createElement('a'); link.href = recordingUrl.value;
        link.download = `${recordingName.value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.${extension}`; link.click();
        savedPath.value = 'Файл сохранён в загрузки';
      }
    } catch (error) { recordingError.value = message(error, 'Не удалось сохранить запись.'); }
    finally { saving.value = false; }
  }
  function cancelRecording() { recorder.cancel(); clearInterval(ticker); }
  return { pitch, pitchBusy, pitchError, outputs, microphones, outputId, microphoneId, outputBusy, devicesBusy, deviceError, outputSupported, recordingSupported, recordingState, recordingActive, recordingUrl, recordingName, recordingError, savedPath, saving, duration, changePitch, refreshDevices, allowDevices, changeOutput, startRecording, stopRecording, saveRecording, clearRecording, cancelRecording };
});
