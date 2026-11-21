<template><section class="settings-group"><div class="settings-group-head"><h2>Локальная музыка</h2><p>Файлы, теги, дубли и умные плейлисты.</p></div><button class="btn" @click="tools.open='library'">Открыть библиотеку</button></section></template>
<script setup lang="ts">import {useWorkspaceToolsStore} from '@/stores/workspaceTools';const tools=useWorkspaceToolsStore();</script>
