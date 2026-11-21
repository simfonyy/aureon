<template><section class="settings-group"><div class="settings-group-head"><h2>Звук и запись</h2><p>Темп, тональность, выход и микрофон.</p></div><button class="btn" @click="tools.open='audio'">Открыть звуковую панель</button></section></template>
<script setup lang="ts">import {useWorkspaceToolsStore} from '@/stores/workspaceTools';const tools=useWorkspaceToolsStore();</script>
