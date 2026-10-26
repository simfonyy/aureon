<template>
  <section id="settings-equalizer" class="settings-group">
    <div class="settings-group-head">
      <h2>Эквалайзер</h2>
      <p>10 полос частот и предусиление.</p>
    </div>
    <EqualizerPanel />
  </section>
</template>

<script setup lang="ts">
import EqualizerPanel from "@/components/settings/EqualizerPanel.vue";
</script>
