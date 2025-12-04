import { MatchData } from './match';

interface ConfigData {
  region?: string;
  streamerMode?: boolean;
  autoRefresh?: boolean;
  selectedGun?: string;
  henrikApiKey?: string;
  showKD?: boolean;
  showHS?: boolean;
  showWR?: boolean;
  showRR?: boolean;
  showSkin?: boolean;
  showRank?: boolean;
  showPeak?: boolean;
  showLevel?: boolean;
  showParty?: boolean;
  showLeaderboard?: boolean;
  skinImageSize?: 'small' | 'medium' | 'large';
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

export interface ElectronAPI {
  getLocalAccount: () => Promise<{ gameName: string; tagLine: string; fullName?: string; puuid?: string; region: string } | null>;
  getLocalMatch: (gun: string) => Promise<MatchData | null>;
  getConfig: () => Promise<ConfigData>;
  saveConfig: (config: Partial<ConfigData>) => Promise<void>;
  saveApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  getApiKey: () => Promise<string | null>;
  getLatestPatchNotes: () => Promise<unknown | null>;
  getRankImages: () => Promise<Record<number, string>>;
  getAgentImages: () => Promise<Record<string, string>>;
  getMatchHistory: (puuid: string, startIndex: number, endIndex: number, queue: string) => Promise<any>;
  getLockfileAccount: () => Promise<string | null>;
  getPatchVersion: () => Promise<string>;
  getPatchImage: (patchVersion: string) => Promise<{ image: string | null; title: string | null; description: string | null; url: string | null } | null>;
  onMatchData: (callback: (data: MatchData) => void) => () => void;
  onStatus: (callback: (data: StatusData) => void) => () => void;
  onMatchFound: (callback: (data: MatchFoundData) => void) => () => void;
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  launchValorant: () => Promise<{ success: boolean; error?: string; method?: string; path?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

