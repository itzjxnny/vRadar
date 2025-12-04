import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

interface ConfigData {
  selectedGun?: string;
  showKD?: boolean;
  showHS?: boolean;
  showWR?: boolean;
  showRR?: boolean;
  showSkin?: boolean;
  showRank?: boolean;
  showPeak?: boolean;
  showLevel?: boolean;
  showParty?: boolean;
  henrikApiKey?: string;
  [key: string]: unknown;
}

interface MatchData {
  map: string;
  mode: string;
  queue: string;
  state: string;
  mapImageUrl?: string | null;
  Players: unknown[];
  isLobby: boolean;
  [key: string]: unknown;
}

interface StatusData {
  status: string;
  state?: string;
  [key: string]: unknown;
}

interface MatchFoundData {
  state: string;
  previousState: string;
  [key: string]: unknown;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalAccount: () => ipcRenderer.invoke('get-local-account'),
  getLocalMatch: (gun: string) => ipcRenderer.invoke('get-local-match', gun),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: ConfigData) => ipcRenderer.invoke('save-config', config),
  saveApiKey: (apiKey: string) => ipcRenderer.invoke('save-api-key', apiKey),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  getLatestPatchNotes: () => ipcRenderer.invoke('get-latest-patch-notes'),
  getRankImages: () => ipcRenderer.invoke('get-rank-images'),
  getAgentImages: () => ipcRenderer.invoke('get-agent-images'),
  getMatchHistory: (puuid: string, startIndex: number, endIndex: number, queue: string) => ipcRenderer.invoke('get-match-history', puuid, startIndex, endIndex, queue),
  getLockfileAccount: () => ipcRenderer.invoke('get-lockfile-account'),
  getPatchVersion: () => ipcRenderer.invoke('get-patch-version'),
  getPatchImage: (patchVersion: string) => ipcRenderer.invoke('get-patch-image', patchVersion),
  
  // Listeners
  onMatchData: (callback: (data: MatchData) => void) => {
    const subscription = (_event: IpcRendererEvent, data: MatchData) => callback(data);
    ipcRenderer.on('match-data', subscription);
    return () => ipcRenderer.removeListener('match-data', subscription);
  },
  onStatus: (callback: (data: StatusData) => void) => {
    const subscription = (_event: IpcRendererEvent, data: StatusData) => callback(data);
    ipcRenderer.on('status-update', subscription);
    return () => ipcRenderer.removeListener('status-update', subscription);
  },
  onMatchFound: (callback: (data: MatchFoundData) => void) => {
    const subscription = (_event: IpcRendererEvent, data: MatchFoundData) => callback(data);
    ipcRenderer.on('match-found', subscription);
    return () => ipcRenderer.removeListener('match-found', subscription);
  },
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  
  // External links
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  
  // Launch Valorant
  launchValorant: () => ipcRenderer.invoke('launch-valorant')
});
