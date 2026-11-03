import { defineStore } from "@quasar/app-vite/wrappers";
import { createPinia } from "pinia";

export default defineStore(() => {
  const pinia = createPinia();
  return pinia;
});
