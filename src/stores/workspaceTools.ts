import { defineStore } from 'pinia';
export type WorkspaceTool = ''|'commands'|'ocr'|'library'|'audio'|'listenbrainz';
export const useWorkspaceToolsStore = defineStore('workspace-tools', {
  state: () => ({ open: '' as WorkspaceTool }),
});
