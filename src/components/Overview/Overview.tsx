import { useEffect, useState, useMemo, useRef } from 'react';
import { MatchData, Player } from '../../types/match';
import './Overview.css';

interface Season {
  uuid: string;
  displayName: string;
  type: string | null;
  startTime: string;
  endTime: string;
  parentUuid: string | null;
}

interface Episode {
  uuid: string;
  displayName: string;
  startTime: string;
  endTime: string;
  acts: Season[];
}

interface OverviewProps {
  localPlayer: Player | null;
  match: MatchData | null;
  userProfileImage: string | null;
  localPlayerFullName: string;
  localPlayerName: string;
  savedPlayerInfo: {
    gameName: string;
    fullName: string;
    puuid: string;
    region: string;
  };
  henrikApiKey: string;
  getRankImage: (tier: number | undefined | null) => string;
  getAgentImage: (player: Player) => string | null;
  valorantNotRunning: boolean | null;
}

interface PlayerStats {
  currenttier?: number;
  currenttierpatched?: string;
  rankingInTier?: number;
  peakrank?: string;
  peakrankTier?: number;
  kd?: number;
  winRate?: number;
  headshotPercentage?: number;
  accuracy?: number;
  numberofgames?: number;
  damagePerRound?: number;
  leaderboard?: number;
  headshots?: number;
  bodyshots?: number;
  legshots?: number;
  headshotTrend?: number[];
}

interface HenrikMMRResponse {
  status: number;
  data: {
    currenttier?: number;
    currenttierpatched?: string;
    ranking_in_tier?: number;
    mmr_change_to_last_game?: number;
    elo?: number;
    old?: boolean;
  };
}

interface HenrikMatchesResponse {
  status: number;
  data: Array<{
    metadata: {
      map: string;
      game_version: string;
      game_length: number;
      game_start: number;
      round_played: number;
      mode: string;
      mode_id: string;
      queue: string;
      season_id: string;
      matchid: string;
    };
    players: {
      all_players: Array<{
        puuid: string;
        team: string;
        stats: {
          kills: number;
          deaths: number;
          assists: number;
          score: number;
          headshots: number;
          bodyshots: number;
          legshots: number;
          damage_made: number;
          damage_received: number;
        };
      }>;
      red: Array<{
        puuid: string;
        team: string;
        stats: {
          kills: number;
          deaths: number;
          assists: number;
        };
      }>;
      blue: Array<{
        puuid: string;
        team: string;
        stats: {
          kills: number;
          deaths: number;
          assists: number;
        };
      }>;
    };
    teams: {
      red: {
        has_won: boolean;
        rounds_won: number;
        rounds_lost: number;
      };
      blue: {
        has_won: boolean;
        rounds_won: number;
        rounds_lost: number;
      };
    };
  }> | {
    meta: {
      total: number;
    };
    data: Array<{
      meta: {
        id: string;
        map: {
          name: string;
        };
        mode: string;
        started_at: string;
      };
      stats: {
        kills: number;
        deaths: number;
        assists: number;
        score: number;
        damage: {
          made: number;
          received: number;
        };
      };
      teams: {
        red: {
          has_won: boolean;
        };
        blue: {
          has_won: boolean;
        };
      };
      players: {
        all_players: Array<{
          puuid: string;
          stats: {
            kills: number;
            deaths: number;
            assists: number;
            score: number;
            headshots: number;
            bodyshots: number;
            legshots: number;
            damage: {
              made: number;
            };
          };
          damage_made: number;
        }>;
      };
    }>;
  };
}

export function Overview({
  localPlayer,
  match,
  userProfileImage,
  localPlayerFullName,
  localPlayerName,
  savedPlayerInfo,
  henrikApiKey,
  getRankImage,
  getAgentImage,
  valorantNotRunning
}: OverviewProps) {
  // Load cached stats from sessionStorage on mount
  const loadCachedStats = (): PlayerStats | null => {
    try {
      const cachedStatsKey = `overview_playerStats_${savedPlayerInfo.puuid}`;
      const cached = sessionStorage.getItem(cachedStatsKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error loading cached stats:', error);
    }
    return null;
  };

  const loadCachedData = <T,>(key: string, defaultValue: T): T => {
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error(`Error loading cached ${key}:`, error);
    }
    return defaultValue;
  };

  const cacheData = <T,>(key: string, data: T): void => {
    try {
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error(`Error caching ${key}:`, error);
    }
  };

  const puuidKey = savedPlayerInfo.puuid;
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(loadCachedStats());
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [agentImages, setAgentImages] = useState<Record<string, string>>({});
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentActUuid, setCurrentActUuid] = useState<string>('');
  const episodesRef = useRef<Episode[]>([]);

  // Always use current act and competitive mode (dropdowns removed temporarily)
  const selectedActUuid = currentActUuid;
  const selectedMode = 'competitive';
  const [roleStats, setRoleStats] = useState<Record<string, {
    wins: number;
    losses: number;
    kills: number;
    deaths: number;
    assists: number;
    matches: number;
    winRate: number;
    kda: number;
  }>>(loadCachedData(`overview_roleStats_${puuidKey}`, {}));
  const [agentStats, setAgentStats] = useState<Array<{
    agentName: string;
    agentDisplayName: string;
    agentId?: string; // Character UUID for image loading
    matches: number;
    wins: number;
    losses: number;
    winRate: number;
    kd: number;
    adr: number;
    acs: number;
    dd: number;
    timePlayed: number; // in hours
  }>>(loadCachedData(`overview_agentStats_${puuidKey}`, []));
  const [actRank, setActRank] = useState<{
    tier?: number;
    tierPatched?: string;
    rankingInTier?: number;
  } | null>(loadCachedData(`overview_actRank_${puuidKey}`, null));
  const [viewMode, setViewMode] = useState<'overview' | 'match-history'>('overview');
  const [matchHistory, setMatchHistory] = useState<any[]>(loadCachedData(`overview_matchHistory_${puuidKey}`, []));
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);
  const [selectedAgentDisplayName, setSelectedAgentDisplayName] = useState<string | null>(null);
  const [selectedMapFilter, setSelectedMapFilter] = useState<string | null>(null);
  const [mapImages, setMapImages] = useState<Record<string, string>>({});
  const [mapStats, setMapStats] = useState<Array<{
    mapName: string;
    matches: number;
    wins: number;
    losses: number;
    winRate: number;
  }>>(loadCachedData(`overview_mapStats_${puuidKey}`, []));

  // Fetch preloaded agent images
  useEffect(() => {
    const fetchAgentImages = async () => {
      try {
        const images = await window.electronAPI.getAgentImages();
        if (images && typeof images === 'object') {
          setAgentImages(images);
        }
      } catch (error) {
        console.error('Error fetching agent images:', error);
      }
    };
    fetchAgentImages();
  }, []);

  // Fetch map images from valorant-api.com
  useEffect(() => {
    const fetchMapImages = async () => {
      try {
        const response = await fetch('https://valorant-api.com/v1/maps');
        const data = await response.json();
        if (data.status === 200 && data.data) {
          const mapImageMap: Record<string, string> = {};
          data.data.forEach((map: any) => {
            if (map.displayName && map.splash && typeof map.displayName === 'string') {
              mapImageMap[map.displayName.toLowerCase()] = map.splash;
              if (map.uuid && typeof map.uuid === 'string') {
                mapImageMap[map.uuid.toLowerCase()] = map.splash;
              }
            }
          });
          setMapImages(mapImageMap);
        }
      } catch (error) {
        console.error('Error fetching map images:', error);
      }
    };
    fetchMapImages();
  }, []);

  // Fetch seasons from Valorant API
  useEffect(() => {
    const fetchSeasons = async () => {
      try {
        const response = await fetch('https://valorant-api.com/v1/seasons');
        const data = await response.json();
        
        if (data.status === 200 && data.data) {
          const seasons: Season[] = data.data;
          const now = new Date();
          
          // Separate episodes and acts, filter out future ones
          const episodeMap = new Map<string, Episode>();
          const acts: Season[] = [];
          
          // First, collect all episodes (no filtering by start time - we need them for grouping)
          seasons.forEach(season => {
            if (season.type === null && !season.parentUuid) {
              // This is an episode
              episodeMap.set(season.uuid, {
                uuid: season.uuid,
                displayName: season.displayName,
                startTime: season.startTime,
                endTime: season.endTime,
                acts: []
              });
            }
          });
          
          // Then, filter acts by start time (only include acts that have already started)
          seasons.forEach(season => {
            if (season.type === 'EAresSeasonType::Act' && season.parentUuid) {
              const startTime = new Date(season.startTime);
              const startTimeMs = startTime.getTime();
              const nowMs = now.getTime();
              
              // Only include acts that have already started (strict check)
              // Check if current time is after the start time (not equal to avoid timezone edge cases)
              // Also check that the startTime is valid (not NaN)
              if (!isNaN(startTimeMs) && nowMs > startTimeMs) {
                acts.push(season);
              } else {
                // Debug logging for acts that are being filtered out
                console.log(`Filtering out act: ${season.displayName}, startTime: ${season.startTime} (${startTimeMs}), now: ${now.toISOString()} (${nowMs}), diff: ${nowMs - startTimeMs}ms`);
              }
            }
          });
          
          // Group acts by their parent episode (only include episodes that have acts)
          acts.forEach(act => {
            const episode = episodeMap.get(act.parentUuid!);
            if (episode) {
              episode.acts.push(act);
            }
          });
          
          // Filter out episodes that have no acts (all acts were in the future)
          episodeMap.forEach((episode, uuid) => {
            if (episode.acts.length === 0) {
              episodeMap.delete(uuid);
            }
          });
          
          // Sort acts within each episode by act number (I, II, III, IV, V, VI) then by startTime
          const actNumberOrder: Record<string, number> = {
            'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6,
            '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6
          };
          
          const getActNumber = (displayName: string): number => {
            const lower = displayName.toLowerCase().trim();
            
            // Try to match "ACT I", "ACT II", "ACT III", etc. (case insensitive)
            // Pattern: "act" followed by optional space and roman numeral or number
            const actMatch = lower.match(/act\s*([ivx\d]+)/i);
            if (actMatch) {
              const actStr = actMatch[1].toLowerCase().trim();
              if (actNumberOrder[actStr]) {
                return actNumberOrder[actStr];
              }
            }
            
            // Also try direct lookup for patterns like "act i", "act ii", etc.
            for (const [key, value] of Object.entries(actNumberOrder)) {
              // Match "act i", "act ii", "act 1", etc. with optional spaces
              const pattern = new RegExp(`act\\s*${key}\\b`, 'i');
              if (pattern.test(lower)) {
                return value;
              }
            }
            
            return 0;
          };
          
          episodeMap.forEach(episode => {
            // Sort acts in reverse order (highest act number first: VI, V, IV, III, II, I)
            episode.acts.sort((a, b) => {
              const actNumA = getActNumber(a.displayName);
              const actNumB = getActNumber(b.displayName);
              
              // If both have act numbers, sort by act number in reverse (highest first)
              if (actNumA > 0 && actNumB > 0) {
                const result = actNumB - actNumA; // Reverse order: 6, 5, 4, 3, 2, 1
                return result;
              }
              
              // If only one has an act number, prioritize it
              if (actNumA > 0) return -1;
              if (actNumB > 0) return 1;
              
              // Otherwise fall back to startTime (most recent first)
              return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
            });
            
            // Acts sorted successfully
          });
          
          // Convert to array and sort by startTime (most recent first)
          const episodesArray = Array.from(episodeMap.values()).sort((a, b) => 
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
          );
          
          setEpisodes(episodesArray);
          episodesRef.current = episodesArray;
          
          // Find current act
          for (const episode of episodesArray) {
            for (const act of episode.acts) {
              const startTime = new Date(act.startTime);
              const endTime = new Date(act.endTime);
              if (now >= startTime && now <= endTime) {
                setCurrentActUuid(act.uuid);
                return;
              }
            }
          }
          
          // If no current act found, use the most recent act from the most recent episode
          if (episodesArray.length > 0 && episodesArray[0].acts.length > 0) {
            const mostRecentAct = episodesArray[0].acts[episodesArray[0].acts.length - 1];
            setCurrentActUuid(mostRecentAct.uuid);
          }
        }
      } catch (error) {
        console.error('Error fetching seasons:', error);
      }
    };
    
    fetchSeasons();
  }, []);

  // Function to convert act UUID/display name to Henrik API season_id format
  const getHenrikSeasonId = (actUuid: string, episodes: Episode[]): string | null => {
    if (!actUuid || episodes.length === 0) return null;
    
    // Find the act in episodes
    for (const episode of episodes) {
      const act = episode.acts.find(a => a.uuid === actUuid);
      if (act) {
        const actDisplayName = act.displayName.toLowerCase().trim();
        const episodeDisplayName = episode.displayName.toLowerCase().trim();
        
        // Check both episode and act display names
        const combinedName = `${episodeDisplayName} ${actDisplayName}`;
        
        // Extract act number from act display name (e.g., "ACT VI" -> 6, "ACT I" -> 1)
        const actNumberMatch = actDisplayName.match(/act\s*(vi|v|iv|iii|ii|i|\d+)/i);
        let actNumber = 0;
        if (actNumberMatch) {
          const actStr = actNumberMatch[1].toLowerCase();
          const actNumberMap: Record<string, number> = {
            'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6,
            '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6
          };
          actNumber = actNumberMap[actStr] || 0;
        }
        
        // Map specific acts to Henrik API format
        // v25 act vi (Season 2025 Act 6) -> e10a6
        // Check if episode is V25 or Season 2025
        if (episodeDisplayName.includes('v25') || episodeDisplayName.includes('season 2025') || 
            combinedName.includes('v25') || combinedName.includes('season 2025')) {
          // V25 maps to Episode 10, so use e10aX format
          if (actNumber > 0) {
            const seasonId = `e10a${actNumber}`;
            // Mapped season ID for act
            return seasonId;
          }
          // Fallback to string matching
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e10a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e10a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e10a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e10a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e10a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e10a1';
          }
        }
        
        // Map Episode 10 acts
        if (episodeDisplayName.includes('episode 10') || episodeDisplayName.includes('ep 10') ||
            combinedName.includes('episode 10') || combinedName.includes('ep 10')) {
          if (actNumber > 0) {
            return `e10a${actNumber}`;
          }
          // Fallback to string matching
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e10a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e10a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e10a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e10a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e10a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e10a1';
          }
        }
        
        // Map Episode 9 acts
        if (episodeDisplayName.includes('episode 9') || episodeDisplayName.includes('ep 9') ||
            combinedName.includes('episode 9') || combinedName.includes('ep 9')) {
          if (actNumber > 0) {
            return `e9a${actNumber}`;
          }
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e9a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e9a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e9a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e9a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e9a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e9a1';
          }
        }
        
        // Map Episode 8 acts
        if (episodeDisplayName.includes('episode 8') || episodeDisplayName.includes('ep 8') ||
            combinedName.includes('episode 8') || combinedName.includes('ep 8')) {
          if (actNumber > 0) {
            return `e8a${actNumber}`;
          }
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e8a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e8a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e8a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e8a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e8a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e8a1';
          }
        }
        
        // Map Episode 7 acts
        if (episodeDisplayName.includes('episode 7') || episodeDisplayName.includes('ep 7') ||
            combinedName.includes('episode 7') || combinedName.includes('ep 7')) {
          if (actNumber > 0) {
            return `e7a${actNumber}`;
          }
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e7a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e7a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e7a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e7a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e7a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e7a1';
          }
        }
        
        // Map Episode 6 acts
        if (episodeDisplayName.includes('episode 6') || episodeDisplayName.includes('ep 6') ||
            combinedName.includes('episode 6') || combinedName.includes('ep 6')) {
          if (actNumber > 0) {
            return `e6a${actNumber}`;
          }
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e6a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e6a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e6a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e6a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e6a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e6a1';
          }
        }
        
        // Map Episode 5 acts
        if (episodeDisplayName.includes('episode 5') || episodeDisplayName.includes('ep 5') ||
            combinedName.includes('episode 5') || combinedName.includes('ep 5')) {
          if (actNumber > 0) {
            return `e5a${actNumber}`;
          }
          if (actDisplayName.includes('act vi') || actDisplayName.includes('act 6')) {
            return 'e5a6';
          }
          if (actDisplayName.includes('act v') || actDisplayName.includes('act 5')) {
            return 'e5a5';
          }
          if (actDisplayName.includes('act iv') || actDisplayName.includes('act 4')) {
            return 'e5a4';
          }
          if (actDisplayName.includes('act iii') || actDisplayName.includes('act 3')) {
            return 'e5a3';
          }
          if (actDisplayName.includes('act ii') || actDisplayName.includes('act 2')) {
            return 'e5a2';
          }
          if (actDisplayName.includes('act i') || actDisplayName.includes('act 1')) {
            return 'e5a1';
          }
        }
      }
    }
    
    return null;
  };

  // Load API key if not available (for initial startup)
  // Use getApiKey() directly for better security and immediate availability
  // Retry until we get it (getApiKey always returns embedded key as fallback)
  useEffect(() => {
    if (!henrikApiKey && window.electronAPI) {
      const loadApiKeyWithRetry = async (retries = 10, delay = 500) => {
        for (let i = 0; i < retries; i++) {
          try {
            const apiKey = await window.electronAPI.getApiKey();
            if (apiKey) {
              // API key loaded - the parent component should update henrikApiKey prop
              // But we can't directly update it here since it's a prop
              // The parent's loadApiKey should handle this
              return;
            } else if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.error('Error loading API key in Overview after retries:', error);
            }
          }
        }
      };
      loadApiKeyWithRetry();
    }
  }, [henrikApiKey]);

  // State to track if we've tried to load account info
  const [accountInfoLoaded, setAccountInfoLoaded] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{ puuid?: string; region?: string; fullName?: string } | null>(null);

  // Try to load account info if savedPlayerInfo is missing required fields
  useEffect(() => {
    const loadAccountInfo = async () => {
      // If we already have puuid and region, we're good
      if (savedPlayerInfo.puuid && savedPlayerInfo.region) {
        setAccountInfoLoaded(true);
        return;
      }

      // Try to get account info from electron API with retry logic
      if (window.electronAPI) {
        const maxRetries = 10;
        const retryDelay = 1000;
        
        for (let i = 0; i < maxRetries; i++) {
          try {
            const account = await window.electronAPI.getLocalAccount();
            if (account && account.puuid && account.region) {
              setAccountInfo({
                puuid: account.puuid,
                region: account.region,
                fullName: account.fullName
              });
              setAccountInfoLoaded(true);
              return; // Success, exit retry loop
            } else if (i < maxRetries - 1) {
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
          } catch (error) {
            if (i < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
              console.error('Error loading account info in Overview after retries:', error);
            }
          }
        }
        
        // If we still don't have account info, try lockfile account as fallback
        try {
          const lockfileAccount = await window.electronAPI.getLockfileAccount();
          if (lockfileAccount) {
            // Lockfile account is just a string (fullName), so we still need puuid and region
            // But we can use it to update the saved info if we have it
            console.log('Lockfile account available but missing puuid/region');
          }
        } catch (err) {
          // Ignore lockfile errors
        }
      }
      
      // Mark as loaded even if we didn't get account info (to prevent infinite retries)
      setAccountInfoLoaded(true);
    };

    loadAccountInfo();
  }, [savedPlayerInfo.puuid, savedPlayerInfo.region]);

  // Fetch player statistics from Henrik API using saved player info
  useEffect(() => {
    const fetchPlayerStats = async () => {
      // Wait for account info to be loaded
      if (!accountInfoLoaded) {
        return;
      }

      // Use sessionStorage to persist match ID across component unmounts
      const lastMatchIdKey = `overview_lastMatchId_${savedPlayerInfo.puuid}`;
      const cachedStatsKey = `overview_statsCached_${savedPlayerInfo.puuid}`;
      const lastMatchId = sessionStorage.getItem(lastMatchIdKey);
      const statsCached = sessionStorage.getItem(cachedStatsKey) === 'true';
      
      // For MENUS state, we don't have a match ID, so we'll use a stable identifier
      // Only refetch if we don't have cached stats OR if we detect a new match (match ID changed)
      // For MENUS, we'll use a combination of state and timestamp to detect if it's truly a new session
      const currentMatchId = match?.matchId || match?.MatchID;
      
      // If we have a match ID, check if it's different (new match)
      if (currentMatchId) {
        const isNewMatch = currentMatchId !== lastMatchId;
        // If stats are cached and it's not a new match, skip fetching
        if (statsCached && !isNewMatch) {
          return;
        }
      } else {
        // No match ID (MENUS state) - only fetch if we haven't cached stats yet
        // Once cached, don't refetch on tab switches for MENUS
        if (statsCached) {
          return;
        }
      }

      // Use accountInfo if available, otherwise fall back to savedPlayerInfo
      const playerRegion = accountInfo?.region || savedPlayerInfo.region || 'na';
      const playerPuuid = accountInfo?.puuid || savedPlayerInfo.puuid;
      
      // If API key is missing, try to load it first using getApiKey() for better security
      // getApiKey() always returns a key (embedded default if no user key)
      let apiKeyToUse = henrikApiKey;
      if (!apiKeyToUse && window.electronAPI) {
        try {
          // Use getApiKey() directly - it handles secure storage and embedded fallback
          // This should always return a key (even if it's the embedded default)
          const loadedApiKey = await window.electronAPI.getApiKey();
          if (loadedApiKey) {
            apiKeyToUse = loadedApiKey;
          } else {
            // This shouldn't happen, but log it
            console.warn('getApiKey() returned null/undefined - this should not happen');
          }
        } catch (error) {
          console.error('Error loading API key for stats fetch:', error);
          // Even on error, getApiKey should have returned embedded key, so this is unexpected
        }
      }
      
      if (!playerPuuid || !apiKeyToUse || !playerRegion) {
        const missingFields = [];
        if (!playerPuuid) missingFields.push('puuid');
        if (!apiKeyToUse) missingFields.push('API key');
        if (!playerRegion) missingFields.push('region');
        console.log(`Missing required info to fetch stats: ${missingFields.join(', ')}`);
        return;
      }

      setLoadingStats(true);
      setStatsError(null);

      try {
        // Fetch MMR/Rank info (still using name/tag for MMR)
        const playerName = savedPlayerInfo.fullName || localPlayerFullName;
        if (playerName) {
          const [gameName, tag] = playerName.includes('#') ? playerName.split('#') : [playerName, ''];
          if (gameName && tag) {
            const mmrUrl = `https://api.henrikdev.xyz/valorant/v1/mmr/${playerRegion}/${encodeURIComponent(gameName)}/${encodeURIComponent(tag)}`;
            const mmrResponse = await fetch(mmrUrl, {
              headers: {
                'Authorization': apiKeyToUse
              }
            });

            if (mmrResponse.ok) {
              const mmrData: HenrikMMRResponse = await mmrResponse.json();
              if (mmrData.status === 200 && mmrData.data) {
                const stats: PlayerStats = {
                  currenttier: mmrData.data.currenttier,
                  currenttierpatched: mmrData.data.currenttierpatched || undefined,
                  rankingInTier: mmrData.data.ranking_in_tier,
                };
                setPlayerStats(prev => ({ ...prev, ...stats }));
              }
            }
          }
        }

          // Fetch match history from local API, then get full match details from Henrik
          try {
          // Get Henrik season_id format if an act is selected (for filtering)
          // Use ref to avoid dependency on episodes array
          const henrikSeasonId = selectedActUuid ? getHenrikSeasonId(selectedActUuid, episodesRef.current) : null;
          
          // Will filter matches by season if act is selected
          
          // Map selectedMode to queue parameter for local API
          const queueMap: Record<string, string> = {
            'competitive': 'competitive',
            'unrated': 'unrated',
            'swiftplay': 'swiftplay',
            'deathmatch': 'deathmatch',
            'spikerush': 'spikerush',
            'escalation': 'ggteam',
            'replication': 'onefa',
            'hurm': 'hurm',
            'premier': 'premier',
            'custom': 'custom'
          };
          const queue = queueMap[selectedMode] || 'competitive';
          
          // Fetch all matches directly from Henrik API using lifetime endpoint
          // Skip local API entirely as it's limited and unreliable
          let allMatches: any[] = [];
          
          try {
            // Try lifetime endpoint first (returns all matches in one call)
            const lifetimeUrl = `https://api.henrikdev.xyz/valorant/v1/by-puuid/lifetime/matches/${playerRegion}/${playerPuuid}?mode=${selectedMode}`;
            const lifetimeResponse = await fetch(lifetimeUrl, {
              headers: {
                'Authorization': apiKeyToUse
              }
            });
            
            if (lifetimeResponse.ok) {
              const lifetimeData: any = await lifetimeResponse.json();
              if (lifetimeData.status === 200 && lifetimeData.data) {
                let matchesArray: any[] = [];
                if (Array.isArray(lifetimeData.data)) {
                  matchesArray = lifetimeData.data;
                } else if (typeof lifetimeData.data === 'object' && Array.isArray(lifetimeData.data.matches)) {
                  matchesArray = lifetimeData.data.matches;
                } else if (Array.isArray(lifetimeData.matches)) {
                  matchesArray = lifetimeData.matches;
                }
                allMatches = matchesArray;
              }
            } else {
              // Lifetime endpoint failed, falling back to v4 with pagination
              
              // Fallback to v4 endpoint with pagination
              let henrikPage = 0;
              let henrikHasMore = true;
              const henrikPageSize = 50; // Henrik API typically returns 50 matches per page
              
              while (henrikHasMore && henrikPage < 40) { // Limit to 40 pages (2000 matches max)
                const henrikUrl = `https://api.henrikdev.xyz/valorant/v4/by-puuid/matches/${playerRegion}/pc/${playerPuuid}?mode=${selectedMode}&size=${henrikPageSize}&page=${henrikPage}`;
                
                const henrikResponse = await fetch(henrikUrl, {
                  headers: {
                    'Authorization': apiKeyToUse
                  }
                });
                
                if (henrikResponse.ok) {
                  const henrikData: any = await henrikResponse.json();
                  if (henrikData.status === 200 && henrikData.data) {
                    let matchesArray: any[] = [];
                    if (Array.isArray(henrikData.data)) {
                      matchesArray = henrikData.data;
                    } else if (typeof henrikData.data === 'object' && Array.isArray(henrikData.data.matches)) {
                      matchesArray = henrikData.data.matches;
                    } else if (Array.isArray(henrikData.matches)) {
                      matchesArray = henrikData.matches;
                    }
                    
                    if (matchesArray.length > 0) {
                      allMatches = allMatches.concat(matchesArray);
                      
                      // Check if there are more pages - continue if we got a full page
                      if (matchesArray.length < henrikPageSize) {
                        henrikHasMore = false;
                      } else {
                        henrikPage++;
                        // Add a small delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 200));
                      }
                    } else {
                      henrikHasMore = false;
                    }
                  } else {
                    henrikHasMore = false;
                  }
                } else {
                  console.error(`Henrik API failed on page ${henrikPage}:`, henrikResponse.status);
                  henrikHasMore = false;
                }
              }
            }
            
            // Also try v3 endpoint as it might have different data
            try {
              const v3Url = `https://api.henrikdev.xyz/valorant/v3/by-puuid/matches/${playerRegion}/${playerPuuid}?mode=${selectedMode}`;
              const v3Response = await fetch(v3Url, {
                headers: {
                  'Authorization': apiKeyToUse
                }
              });
              
              if (v3Response.ok) {
                const v3Data: any = await v3Response.json();
                if (v3Data.status === 200 && v3Data.data) {
                  let matchesArray: any[] = [];
                  if (Array.isArray(v3Data.data)) {
                    matchesArray = v3Data.data;
                  } else if (typeof v3Data.data === 'object' && Array.isArray(v3Data.data.matches)) {
                    matchesArray = v3Data.data.matches;
                  } else if (Array.isArray(v3Data.matches)) {
                    matchesArray = v3Data.matches;
                  }
                  
                  const existingMatchIds = new Set(allMatches.map((m: any) => (m.metadata || m.meta)?.id || (m.metadata || m.meta)?.match_id));
                  const newMatches = matchesArray.filter((m: any) => {
                    const matchId = (m.metadata || m.meta)?.id || (m.metadata || m.meta)?.match_id;
                    return matchId && !existingMatchIds.has(matchId);
                  });
                  
                  if (newMatches.length > 0) {
                    allMatches = allMatches.concat(newMatches);
                    console.log(`Added ${newMatches.length} new matches from v3 endpoint (total: ${allMatches.length})`);
                  } else {
                    // v3 endpoint returned matches, all duplicates
                  }
                }
              }
            } catch (v3Error) {
              // v3 endpoint failed or unavailable
            }
            
            // Try v4 with pagination to ensure we get ALL matches
            
            let henrikPage = 0;
            let henrikHasMore = true;
            const henrikPageSize = 50;
            const existingMatchIds = new Set(allMatches.map((m: any) => (m.metadata || m.meta)?.id || (m.metadata || m.meta)?.match_id));
            let v4MatchesAdded = 0;
            
            while (henrikHasMore && henrikPage < 40) {
              // Always use pagination params for v4
              const henrikUrl = `https://api.henrikdev.xyz/valorant/v4/by-puuid/matches/${playerRegion}/pc/${playerPuuid}?mode=${selectedMode}&size=${henrikPageSize}&page=${henrikPage}`;
              
              const henrikResponse = await fetch(henrikUrl, {
                headers: {
                  'Authorization': apiKeyToUse
                }
              });
              
              if (henrikResponse.ok) {
                const henrikData: any = await henrikResponse.json();
                if (henrikData.status === 200 && henrikData.data) {
                  let matchesArray: any[] = [];
                  if (Array.isArray(henrikData.data)) {
                    matchesArray = henrikData.data;
                  } else if (typeof henrikData.data === 'object' && Array.isArray(henrikData.data.matches)) {
                    matchesArray = henrikData.data.matches;
                  } else if (Array.isArray(henrikData.matches)) {
                    matchesArray = henrikData.matches;
                  }
                  
                  if (matchesArray.length > 0) {
                    // Only add matches we don't already have
                    const newMatches = matchesArray.filter((m: any) => {
                      const matchId = (m.metadata || m.meta)?.id || (m.metadata || m.meta)?.match_id;
                      return matchId && !existingMatchIds.has(matchId);
                    });
                    
                    if (newMatches.length > 0) {
                      allMatches = allMatches.concat(newMatches);
                      v4MatchesAdded += newMatches.length;
                      newMatches.forEach((m: any) => {
                        const matchId = (m.metadata || m.meta)?.id || (m.metadata || m.meta)?.match_id;
                        if (matchId) existingMatchIds.add(matchId);
                      });
                    }
                    
                    // Continue pagination if we got a full page, even if they're duplicates
                    // This ensures we check all pages for any new matches
                    if (matchesArray.length < henrikPageSize) {
                      henrikHasMore = false;
                    } else {
                      henrikPage++;
                      await new Promise(resolve => setTimeout(resolve, 200));
                    }
                  } else {
                    henrikHasMore = false;
                  }
                } else {
                  henrikHasMore = false;
                }
              } else {
                console.error(`Henrik API v4 failed on page ${henrikPage}:`, henrikResponse.status);
                henrikHasMore = false;
              }
            }
            
            // Total matches after v4 pagination
          } catch (error) {
            console.error('Error fetching matches from Henrik API:', error);
          }
          
          if (allMatches.length > 0) {
            // Total matches fetched
              
            // Filter matches by selected act/episode if one is selected
            // v4 API uses metadata.season.short instead of meta.season.short
            let filteredMatches = allMatches;
                if (selectedActUuid && episodes.length > 0 && henrikSeasonId) {
                  const beforeFilter = allMatches.length;
                  filteredMatches = allMatches.filter((match: any) => {
                    // v4 API uses metadata instead of meta
                    const seasonShort = match.metadata?.season?.short || match.meta?.season?.short;
                    
                    // Filter matches by season
                    
                    if (seasonShort === henrikSeasonId) {
                      return true;
                    }
                    
                    // If season.short doesn't match, exclude this match
                    return false;
                  });
                  
                  // Filtered matches by season
                } else {
                  // No act selected or episodes not loaded, showing all matches
                  setActRank(null);
                  cacheData(`overview_actRank_${puuidKey}`, null);
                }

                // Calculate overall stats (from all filtered matches)
                let totalKills = 0;
                let totalDeaths = 0;
                let totalAssists = 0;
                let totalDamage = 0;
                let wins = 0;
                let totalRounds = 0;

                // Calculate accuracy stats (only from last 20 competitive matches)
                let totalHeadshots = 0;
                let totalBodyshots = 0;
                let totalLegshots = 0;

                // Role stats
                const roleStatsMap: Record<string, {
                  kills: number;
                  deaths: number;
                  assists: number;
                  matches: number;
                  wins: number;
                }> = {};

                // Agent stats
                const agentStatsMap: Record<string, {
                  agentDisplayName: string;
                  agentId?: string; // Character UUID for image loading
                  kills: number;
                  deaths: number;
                  assists: number;
                  damage: number;
                  score: number;
                  rounds: number;
                  matches: number;
                  wins: number;
                  damageReceived: number;
                }> = {};

                // Map stats
                const mapStatsMap: Record<string, {
                  matches: number;
                  wins: number;
                  losses: number;
                }> = {};

                // Agent to role mapping
                const agentToRole: Record<string, string> = {
                  // Controllers
                  'brimstone': 'Controller',
                  'viper': 'Controller',
                  'omen': 'Controller',
                  'astra': 'Controller',
                  'harbor': 'Controller',
                  'clove': 'Controller',
                  // Duelists
                  'phoenix': 'Duelist',
                  'jett': 'Duelist',
                  'reyna': 'Duelist',
                  'raze': 'Duelist',
                  'yoru': 'Duelist',
                  'neon': 'Duelist',
                  'iso': 'Duelist',
                  'waylay': 'Duelist',
                  // Initiators
                  'sova': 'Initiator',
                  'breach': 'Initiator',
                  'skye': 'Initiator',
                  'kayo': 'Initiator',
                  'kay/o': 'Initiator',
                  'fade': 'Initiator',
                  'gekko': 'Initiator',
                  'tejo': 'Initiator',
                  // Sentinels
                  'killjoy': 'Sentinel',
                  'cypher': 'Sentinel',
                  'sage': 'Sentinel',
                  'chamber': 'Sentinel',
                  'deadlock': 'Sentinel',
                  'vyse': 'Sentinel',
                  'veto': 'Sentinel'
                };

                if (filteredMatches.length === 0) {
                  console.warn('No matches found after filtering. Showing empty stats.');
                  const emptyStats = {
                    kd: undefined,
                    winRate: undefined,
                    headshotPercentage: undefined,
                    numberofgames: 0,
                    damagePerRound: undefined,
                  };
                  setPlayerStats(emptyStats);
                  cacheData(`overview_playerStats_${puuidKey}`, emptyStats);
                  setRoleStats({});
                  cacheData(`overview_roleStats_${puuidKey}`, {});
                  setActRank(null);
                  cacheData(`overview_actRank_${puuidKey}`, null);
                  return;
                }

                // Extract rank from filtered matches (most recent valid rank)
                // Tier to rank name mapping (simplified - tier 0-2 = Unranked, 3-5 = Iron, etc.)
                const getRankNameFromTier = (tier: number): string => {
                  if (tier === 0 || tier === 1 || tier === 2) return 'UNRANKED';
                  if (tier >= 3 && tier <= 5) return `Iron ${tier - 2}`;
                  if (tier >= 6 && tier <= 8) return `Bronze ${tier - 5}`;
                  if (tier >= 9 && tier <= 11) return `Silver ${tier - 8}`;
                  if (tier >= 12 && tier <= 14) return `Gold ${tier - 11}`;
                  if (tier >= 15 && tier <= 17) return `Platinum ${tier - 14}`;
                  if (tier >= 18 && tier <= 20) return `Diamond ${tier - 17}`;
                  if (tier >= 21 && tier <= 23) return `Ascendant ${tier - 20}`;
                  if (tier >= 24 && tier <= 26) return `Immortal ${tier - 23}`;
                  if (tier === 27) return 'Radiant';
                  return 'UNRANKED';
                };
                
                let actRankData: { tier?: number; tierPatched?: string; rankingInTier?: number } | null = null;
                
                // Extract all ranks from competitive matches in this act
                const competitiveMatchesWithRanks = filteredMatches
                  .filter((match: any) => {
                    const metadata = match.metadata || match.meta;
                    const mode = metadata?.queue?.id?.toLowerCase() || metadata?.queue?.name?.toLowerCase() || metadata?.mode?.toLowerCase() || '';
                    
                    if (mode !== 'competitive') return false;
                    
                    // v4 API: find player in players array
                    if (match.players && Array.isArray(match.players)) {
                      const player = match.players.find((p: any) => p.puuid === playerPuuid);
                      return player && player.tier?.id > 0;
                    }
                    // v1 API: stats.tier is a number
                    else if (match.stats && match.stats.puuid === playerPuuid) {
                      return match.stats.tier > 0;
                    }
                    return false;
                  })
                  .map((match: any) => {
                    let tier: number | undefined;
                    let tierName: string | undefined;
                    
                    // v4 API structure
                    if (match.players && Array.isArray(match.players)) {
                      const player = match.players.find((p: any) => p.puuid === playerPuuid);
                      tier = player?.tier?.id;
                      tierName = player?.tier?.name;
                    }
                    // v1 API structure
                    else if (match.stats && match.stats.puuid === playerPuuid) {
                      tier = match.stats.tier;
                      if (tier !== undefined && tier > 0) {
                        tierName = getRankNameFromTier(tier);
                      }
                    }
                    
                    const metadata = match.metadata || match.meta;
                    const time = new Date(metadata?.started_at || 0).getTime();
                    
                    return { tier, tierName, time, matchId: metadata?.id || metadata?.match_id };
                  })
                  .filter((rank: any) => rank.tier && rank.tier > 0);
                
                if (competitiveMatchesWithRanks.length > 0) {
                  // Find the highest rank (highest tier number)
                  const highestRank = competitiveMatchesWithRanks.reduce((highest: any, current: any) => {
                    return current.tier > highest.tier ? current : highest;
                  });
                  
                  actRankData = {
                    tier: highestRank.tier,
                    tierPatched: highestRank.tierName || (highestRank.tier ? getRankNameFromTier(highestRank.tier) : 'UNRANKED'),
                    rankingInTier: 0 // Not available in match stats
                  };
                } else {
                  // No competitive matches with valid ranks found
                }
                setActRank(actRankData);
                if (actRankData) {
                  cacheData(`overview_actRank_${puuidKey}`, actRankData);
                }

                // v4 API structure: { metadata: {...}, players: [{ puuid, stats: {...} }], teams: {...} }
                filteredMatches.forEach((match: any) => {
                  // v4 API has players array - find our player
                  let playerData = null;
                  
                  if (match.players && Array.isArray(match.players)) {
                    // v4 API: players array with puuid and stats
                    playerData = match.players.find((p: any) => p.puuid === playerPuuid);
                  } else if (match.stats && match.stats.puuid === playerPuuid) {
                    // Fallback for older API structure
                    playerData = { stats: match.stats };
                  }
                  
                  if (playerData && playerData.stats) {
                    const stats = playerData.stats;
                    const metadata = match.metadata || match.meta;
                    
                    // Only count matches with actual game data
                    // v4 API: queue.id or queue.name in metadata
                    const mode = metadata?.queue?.id?.toLowerCase() || metadata?.queue?.name?.toLowerCase() || metadata?.mode?.toLowerCase() || '';
                    const isCompetitiveMode = mode === 'competitive' || mode === 'unrated' || mode === 'swiftplay';
                    
                    const kills = stats.kills || 0;
                    const deaths = stats.deaths || 0;
                    const assists = stats.assists || 0;
                    // v4 API: damage.dealt
                    const damage = stats.damage?.dealt || stats.damage?.made || 0;
                    
                    totalKills += kills;
                    totalDeaths += deaths;
                    totalAssists += assists;
                    totalDamage += damage;
                    // Accuracy stats (headshots, bodyshots, legshots) calculated separately from last 20 competitive matches only
                    
                    // For win/loss, check teams object
                    // v4 API: playerData has team_id, match.teams is an array of team objects
                    // v1 API: match.teams is {red: rounds, blue: rounds} and stats.team is the player's team
                    let won = false;
                    const playerTeam = playerData.team_id || stats.team;
                    
                    if (isCompetitiveMode && match.teams) {
                      // v4 API structure: teams is an array like [{team_id: "Red", won: true, rounds: {...}}, {team_id: "Blue", won: false, rounds: {...}}]
                      if (Array.isArray(match.teams)) {
                        const playerTeamObj = match.teams.find((t: any) => t.team_id === playerTeam);
                        if (playerTeamObj && playerTeamObj.won !== undefined) {
                          won = playerTeamObj.won === true;
                        }
                      } else if (typeof match.teams === 'object') {
                        // v1 API structure: teams is {red: rounds, blue: rounds} - numbers are rounds won
                        // Check if teams.red and teams.blue are numbers (v1 structure)
                        if (typeof match.teams.red === 'number' && typeof match.teams.blue === 'number') {
                          // v1 lifetime endpoint: teams.red and teams.blue are the rounds won
                          const redRounds = match.teams.red;
                          const blueRounds = match.teams.blue;
                          if (redRounds > blueRounds) {
                            won = playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'));
                          } else if (blueRounds > redRounds) {
                            won = playerTeam === 'Blue' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('blue'));
                          }
                        } else if (match.teams.red?.has_won !== undefined) {
                          // v4 API with object structure
                          won = (playerTeam === 'Red' && match.teams.red.has_won) || 
                                (playerTeam === 'Blue' && match.teams.blue?.has_won);
                        } else if (match.teams.red?.won !== undefined) {
                          // Alternative v4 structure
                          won = (playerTeam === 'Red' && match.teams.red.won) || 
                                (playerTeam === 'Blue' && match.teams.blue?.won);
                        } else {
                          // Try to determine from score (higher score wins in some modes)
                          const redScore = match.teams.red?.rounds_won || 0;
                          const blueScore = match.teams.blue?.rounds_won || 0;
                          if (redScore > blueScore) {
                            won = playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'));
                          } else if (blueScore > redScore) {
                            won = playerTeam === 'Blue' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('blue'));
                          }
                        }
                      }
                    }
                    
                    if (won) wins++;
                    
                    // Estimate rounds (for damage per round calculation)
                    // v4 API: rounds might be in metadata.game_length_in_ms or we can calculate from teams
                    // Competitive matches are typically 13-26 rounds, use average if not available
                    let rounds = match.metadata?.game_length_in_ms 
                      ? Math.ceil(match.metadata.game_length_in_ms / (90 * 1000)) // ~90 seconds per round average
                      : (match.meta?.rounds_played || (isCompetitiveMode ? 20 : 1)); // Use 1 for deathmatch, 20 avg for competitive
                    
                    // Try to get actual rounds from teams if available
                    if (match.teams) {
                      if (Array.isArray(match.teams)) {
                        // v4 API: teams is an array, sum rounds from all teams
                        const totalRounds = match.teams.reduce((sum: number, team: any) => {
                          const teamRounds = team.rounds?.won || 0;
                          const teamLost = team.rounds?.lost || 0;
                          return sum + teamRounds + teamLost;
                        }, 0);
                        if (totalRounds > 0) {
                          rounds = totalRounds;
                        }
                      } else if (typeof match.teams === 'object') {
                        // v1 API: teams is {red: rounds, blue: rounds} where values are numbers (rounds won)
                        if (typeof match.teams.red === 'number' && typeof match.teams.blue === 'number') {
                          rounds = match.teams.red + match.teams.blue;
                        } else {
                          // v4 API with object structure
                          const redRounds = match.teams.red?.rounds_won || 0;
                          const blueRounds = match.teams.blue?.rounds_won || 0;
                          if (redRounds > 0 || blueRounds > 0) {
                            rounds = redRounds + blueRounds;
                          }
                        }
                      }
                    }
                    totalRounds += rounds;

                    // Calculate role stats
                    // v4 API: agent name is at playerData.agent.name, not stats.character.name
                    const characterName = playerData.agent?.name || stats.character?.name || '';
                    const agentName = characterName.toLowerCase().trim();
                    const role = agentToRole[agentName];
                    
                    // Log unmatched agents for debugging
                    if (!role && characterName) {
                      console.log(`Unmatched agent: "${characterName}" (normalized: "${agentName}")`);
                    }
                    
                    if (role) {
                      if (!roleStatsMap[role]) {
                        roleStatsMap[role] = { kills: 0, deaths: 0, assists: 0, matches: 0, wins: 0 };
                      }
                      roleStatsMap[role].kills += kills;
                      roleStatsMap[role].deaths += deaths;
                      roleStatsMap[role].assists += assists;
                      roleStatsMap[role].matches++;
                      if (won) roleStatsMap[role].wins++;
                    }

                    // Calculate agent stats
                    if (characterName) {
                      const normalizedAgentName = agentName;
                      const characterId = playerData?.agent?.id || stats.character?.id;
                      if (!agentStatsMap[normalizedAgentName]) {
                        agentStatsMap[normalizedAgentName] = {
                          agentDisplayName: characterName,
                          agentId: characterId && typeof characterId === 'string' ? characterId : undefined,
                          kills: 0,
                          deaths: 0,
                          assists: 0,
                          damage: 0,
                          score: 0,
                          rounds: 0,
                          matches: 0,
                          wins: 0,
                          damageReceived: 0,
                        };
                      }
                      // Update agentId if we have it and it's not set yet
                      if (characterId && typeof characterId === 'string' && !agentStatsMap[normalizedAgentName].agentId) {
                        agentStatsMap[normalizedAgentName].agentId = characterId;
                      }
                      agentStatsMap[normalizedAgentName].kills += kills;
                      agentStatsMap[normalizedAgentName].deaths += deaths;
                      agentStatsMap[normalizedAgentName].assists += assists;
                      agentStatsMap[normalizedAgentName].damage += damage;
                      const matchScore = stats.score || 0;
                      agentStatsMap[normalizedAgentName].score += matchScore;
                      agentStatsMap[normalizedAgentName].rounds += rounds;
                      agentStatsMap[normalizedAgentName].matches++;
                      if (won) agentStatsMap[normalizedAgentName].wins++;
                      
                      // Get damage received if available
                      const damageReceived = stats.damage_received || stats.damage?.received || 0;
                      agentStatsMap[normalizedAgentName].damageReceived += damageReceived;
                    }

                    // Calculate map stats
                    // v4 API: metadata.map is a string, or metadata.map.name
                    // v1 API: meta.map.name
                    let mapName: string | undefined;
                    if (metadata?.map) {
                      if (typeof metadata.map === 'string') {
                        mapName = metadata.map;
                      } else if (metadata.map?.name) {
                        mapName = metadata.map.name;
                      }
                    } else if (match.meta?.map?.name) {
                      mapName = match.meta.map.name;
                    }
                    
                    if (mapName && mapName !== 'Unknown' && mapName.trim() !== '') {
                      if (!mapStatsMap[mapName]) {
                        mapStatsMap[mapName] = {
                          matches: 0,
                          wins: 0,
                          losses: 0,
                        };
                      }
                      mapStatsMap[mapName].matches++;
                      if (won) {
                        mapStatsMap[mapName].wins++;
                      } else {
                        mapStatsMap[mapName].losses++;
                      }
                    }
                  }
                });
                
                // Count matches where we found player data
                const matchesWithPlayerData = filteredMatches.filter((match: any) => {
                  if (match.players && Array.isArray(match.players)) {
                    return match.players.some((p: any) => p.puuid === playerPuuid);
                  }
                  return match.stats && match.stats.puuid === playerPuuid;
                }).length;

                // Matches with player data processed

                // Calculate accuracy stats (headshots, bodyshots, legshots) from LAST 20 COMPETITIVE MATCHES ONLY
                const competitiveMatches = filteredMatches.filter((match: any) => {
                  const metadata = match.metadata || match.meta;
                  const mode = metadata?.queue?.id?.toLowerCase() || metadata?.queue?.name?.toLowerCase() || metadata?.mode?.toLowerCase() || '';
                  return mode === 'competitive';
                });
                const last20CompetitiveMatches = competitiveMatches.slice(0, 20); // Most recent 20 competitive matches
                
                // Reset accuracy counters
                totalHeadshots = 0;
                totalBodyshots = 0;
                totalLegshots = 0;
                
                // Calculate accuracy stats from last 20 competitive matches only
                last20CompetitiveMatches.forEach((match: any) => {
                  let playerData = null;
                  
                  if (match.players && Array.isArray(match.players)) {
                    playerData = match.players.find((p: any) => p.puuid === playerPuuid);
                  } else if (match.stats && match.stats.puuid === playerPuuid) {
                    playerData = { stats: match.stats };
                  }
                  
                  if (playerData && playerData.stats) {
                    const stats = playerData.stats;
                    const headshots = stats.headshots || stats.shots?.head || 0;
                    const bodyshots = stats.bodyshots || stats.shots?.body || 0;
                    const legshots = stats.legshots || stats.shots?.leg || 0;
                    
                    totalHeadshots += headshots;
                    totalBodyshots += bodyshots;
                    totalLegshots += legshots;
                  }
                });
                
                // Accuracy stats calculated

                // Calculate overall stats
                const totalShots = totalHeadshots + totalBodyshots + totalLegshots;
                const totalHits = totalHeadshots + totalBodyshots;
                
                // Calculate headshot trend from last 20 matches
                const headshotTrend: number[] = [];
                const last20Matches = filteredMatches.slice(0, 20).reverse(); // Get last 20, reverse to show chronologically
                for (const match of last20Matches) {
                  const playerData = match.players?.all_players?.find((p: any) => p.puuid === playerPuuid) ||
                    match.players?.find((p: any) => p.puuid === playerPuuid);
                  const stats = playerData?.stats || match.stats;
                  
                  if (stats) {
                    const headshots = stats.headshots || stats.shots?.head || 0;
                    const bodyshots = stats.bodyshots || stats.shots?.body || 0;
                    const legshots = stats.legshots || stats.shots?.leg || 0;
                    const matchShots = headshots + bodyshots + legshots;
                    
                    if (matchShots > 0) {
                      const matchHeadshotPct = (headshots / matchShots) * 100;
                      headshotTrend.push(matchHeadshotPct);
                    }
                  }
                }
                
                const calculatedStats: PlayerStats = {
                  kd: totalDeaths > 0 ? totalKills / totalDeaths : (totalKills > 0 ? totalKills : undefined),
                  winRate: matchesWithPlayerData > 0 ? (wins / matchesWithPlayerData) * 100 : undefined,
                  headshotPercentage: totalShots > 0 
                    ? (totalHeadshots / totalShots) * 100 
                    : undefined,
                  accuracy: totalShots > 0 
                    ? (totalHits / totalShots) * 100 
                    : undefined,
                  numberofgames: matchesWithPlayerData,
                  damagePerRound: totalRounds > 0 ? totalDamage / totalRounds : undefined,
                  headshots: totalHeadshots,
                  bodyshots: totalBodyshots,
                  legshots: totalLegshots,
                  headshotTrend: headshotTrend.length > 0 ? headshotTrend : undefined,
                };

                // Stats calculated
                const updatedStats = { ...calculatedStats };
                setPlayerStats(prev => {
                  const merged = { ...prev, ...updatedStats };
                  // Cache stats in sessionStorage
                  try {
                    const cachedStatsKey = `overview_playerStats_${savedPlayerInfo.puuid}`;
                    sessionStorage.setItem(cachedStatsKey, JSON.stringify(merged));
                  } catch (error) {
                    console.error('Error caching stats:', error);
                  }
                  return merged;
                });

                // Calculate and set role stats
                const roleStatsCalculated: Record<string, any> = {};
                Object.keys(roleStatsMap).forEach(role => {
                  const stats = roleStatsMap[role];
                  roleStatsCalculated[role] = {
                    wins: stats.wins,
                    losses: stats.matches - stats.wins,
                    kills: stats.kills,
                    deaths: stats.deaths,
                    assists: stats.assists,
                    matches: stats.matches,
                    winRate: stats.matches > 0 ? (stats.wins / stats.matches) * 100 : 0,
                    kda: stats.deaths > 0 ? (stats.kills + stats.assists) / stats.deaths : (stats.kills + stats.assists)
                  };
                });
                // Role stats calculated
                setRoleStats(roleStatsCalculated);
                cacheData(`overview_roleStats_${puuidKey}`, roleStatsCalculated);

                // Calculate and set agent stats
                const agentStatsCalculated = Object.keys(agentStatsMap).map(agentKey => {
                  const stats = agentStatsMap[agentKey];
                  const kd = stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
                  const adr = stats.rounds > 0 ? stats.damage / stats.rounds : 0;
                  const acs = stats.matches > 0 ? stats.score / stats.matches : 0;
                  const dd = stats.damage - stats.damageReceived; // Damage Delta
                  const timePlayed = stats.rounds * 1.5 / 60; // Assuming ~1.5 minutes per round, convert to hours
                  
                  return {
                    agentName: agentKey,
                    agentDisplayName: stats.agentDisplayName,
                    agentId: stats.agentId,
                    matches: stats.matches,
                    wins: stats.wins,
                    losses: stats.matches - stats.wins,
                    winRate: stats.matches > 0 ? (stats.wins / stats.matches) * 100 : 0,
                    kd: kd,
                    adr: adr,
                    acs: acs,
                    dd: dd,
                    timePlayed: timePlayed,
                  };
                }).sort((a, b) => b.matches - a.matches); // Sort by matches played
                
                setAgentStats(agentStatsCalculated);
                cacheData(`overview_agentStats_${puuidKey}`, agentStatsCalculated);

                // Calculate and set map stats
                const mapStatsCalculated = Object.keys(mapStatsMap).map(mapName => {
                  const stats = mapStatsMap[mapName];
                  return {
                    mapName: mapName,
                    matches: stats.matches,
                    wins: stats.wins,
                    losses: stats.losses,
                    winRate: stats.matches > 0 ? (stats.wins / stats.matches) * 100 : 0,
                  };
                }).sort((a, b) => b.matches - a.matches); // Sort by matches played
                
                // Map stats calculated
                setMapStats(mapStatsCalculated);
                cacheData(`overview_mapStats_${puuidKey}`, mapStatsCalculated);
                
                // Store filtered matches for match history view
                setMatchHistory(filteredMatches);
                cacheData(`overview_matchHistory_${puuidKey}`, filteredMatches);
            }
        } catch (matchesError: any) {
          console.error('Error fetching lifetime matches:', matchesError);
          // Don't set error state for matches - allow display with placeholder data
        }
      } catch (error) {
        console.error('Error fetching player stats:', error);
        setStatsError('Failed to load statistics');
      } finally {
        setLoadingStats(false);
        // Mark stats as cached after fetch attempt (even if it failed, don't keep retrying on tab switch)
        const lastMatchIdKey = `overview_lastMatchId_${savedPlayerInfo.puuid}`;
        const cachedStatsKey = `overview_statsCached_${savedPlayerInfo.puuid}`;
        const currentMatchId = match?.matchId || match?.MatchID;
        
        // Store match ID if available, otherwise use a session identifier for MENUS
        if (currentMatchId) {
          sessionStorage.setItem(lastMatchIdKey, currentMatchId);
        } else {
          // For MENUS state, use a session identifier (won't change unless page reloads)
          const sessionId = sessionStorage.getItem(`overview_sessionId_${savedPlayerInfo.puuid}`) || Date.now().toString();
          sessionStorage.setItem(`overview_sessionId_${savedPlayerInfo.puuid}`, sessionId);
          sessionStorage.setItem(lastMatchIdKey, `MENUS-${sessionId}`);
        }
        sessionStorage.setItem(cachedStatsKey, 'true');
      }
    };

    // Fetch stats if we have account info loaded and required fields
    // API key will be loaded inside the function if not available (getApiKey always returns a key)
    // Only refetch if it's a new match or stats haven't been cached yet
    if (accountInfoLoaded) {
      fetchPlayerStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountInfoLoaded, accountInfo, savedPlayerInfo.puuid, savedPlayerInfo.region, savedPlayerInfo.fullName, henrikApiKey, currentActUuid, match?.matchId, match?.MatchID]);

  // Use live player data if available and valid, otherwise use fetched stats
  // If an act is selected and we have act rank data, use that instead
  // But if it's the current act, use current rank with RR
  const displayStats = useMemo(() => {
    // Check if selected act is the current act
    const isCurrentAct = selectedActUuid === currentActUuid;
    
    // If we have act rank data (from selected act), use that for rank display
    // But if it's the current act, prefer current rank data with RR
    if (actRank && actRank.tier && !isCurrentAct) {
      const baseStats = localPlayer || playerStats;
      // Prioritize playerStats for calculated stats (damagePerRound, kd, etc.) since those come from match history
      return {
        ...baseStats,
        currenttier: actRank.tier,
        currenttierpatched: actRank.tierPatched,
        rankingInTier: actRank.rankingInTier ?? 0,
        // Keep other stats from baseStats, but prefer playerStats for calculated stats
        kd: playerStats?.kd ?? baseStats?.kd,
        winRate: playerStats?.winRate ?? baseStats?.winRate,
        headshotPercentage: playerStats?.headshotPercentage ?? baseStats?.headshotPercentage,
        accuracy: playerStats?.accuracy ?? (baseStats as any)?.accuracy,
        numberofgames: playerStats?.numberofgames ?? baseStats?.numberofgames,
        damagePerRound: playerStats?.damagePerRound ?? (baseStats as any)?.damagePerRound,
        leaderboard: baseStats?.leaderboard,
        headshots: playerStats?.headshots,
        bodyshots: playerStats?.bodyshots,
        legshots: playerStats?.legshots,
        headshotTrend: playerStats?.headshotTrend,
      };
    }
    
    // If it's the current act, use current rank data (which has RR)
    if (isCurrentAct) {
      // Prefer playerStats rank if localPlayer is unranked but playerStats has a rank
      // Otherwise use localPlayer if available, then fall back to playerStats
      const localPlayerIsUnranked = localPlayer?.currenttier === 0;
      const playerStatsHasRank = playerStats?.currenttier !== undefined && playerStats.currenttier !== null && playerStats.currenttier > 0;
      const shouldUsePlayerStats = localPlayerIsUnranked && playerStatsHasRank;
      const currentRankData = shouldUsePlayerStats ? playerStats : (localPlayer || playerStats);
      if (currentRankData) {
        return {
          ...currentRankData,
          currenttier: currentRankData.currenttier,
          currenttierpatched: currentRankData.currenttierpatched,
          rankingInTier: currentRankData.rankingInTier,
          // Make sure to include damagePerRound and accuracy from playerStats if available
          damagePerRound: playerStats?.damagePerRound ?? (currentRankData as any)?.damagePerRound,
          accuracy: playerStats?.accuracy ?? (currentRankData as any)?.accuracy,
          headshots: playerStats?.headshots,
          bodyshots: playerStats?.bodyshots,
          legshots: playerStats?.legshots,
          headshotTrend: playerStats?.headshotTrend,
        };
      }
    }
    
    if (!localPlayer) {
      return playerStats;
    }
    
    // Check if localPlayer has rank data (including unranked/0, which is valid)
    // Rank 0 (Unranked) is valid data, so we should use it
    const hasRankData = localPlayer.currenttier !== undefined && 
                        localPlayer.currenttier !== null;
    
    // Check if localPlayer has any valid stats (not all zeros/undefined)
    // Note: winRate can be 0 (0% win rate) which is valid, so check for undefined/null
    const hasValidStats = (localPlayer.kd !== undefined && localPlayer.kd !== null && localPlayer.kd > 0) ||
                          (localPlayer.winRate !== undefined && localPlayer.winRate !== null) || // Include 0 as valid
                          (localPlayer.headshotPercentage !== undefined && localPlayer.headshotPercentage !== null && localPlayer.headshotPercentage > 0);
    
    // Use localPlayer if it has rank data (including unranked) OR valid stats
    // Rank 0 (Unranked) is valid data and should be displayed
    if (hasRankData || hasValidStats) {
      // Merge localPlayer data with playerStats, preferring localPlayer but falling back to playerStats for missing values
      // For calculated stats like damagePerRound, always prefer playerStats since it comes from match history
      
      // If localPlayer has unranked (tier 0) but playerStats has a ranked tier, use playerStats instead
      // This handles the case where local API returns unranked but external API has the actual rank
      const localPlayerIsUnranked = localPlayer.currenttier === 0;
      const playerStatsHasRank = playerStats?.currenttier !== undefined && playerStats.currenttier !== null && playerStats.currenttier > 0;
      const shouldUsePlayerStatsRank = localPlayerIsUnranked && playerStatsHasRank;
      
      return {
        // Use playerStats rank if localPlayer is unranked but playerStats has a rank
        // Otherwise use localPlayer's rank data (including unranked/0 if that's what it is)
        // Rank 0 is valid and should be displayed as "UNRANKED" when that's the actual rank
        currenttier: shouldUsePlayerStatsRank ? playerStats.currenttier : (hasRankData ? localPlayer.currenttier : (playerStats?.currenttier ?? localPlayer.currenttier)),
        currenttierpatched: shouldUsePlayerStatsRank ? playerStats.currenttierpatched : (hasRankData ? localPlayer.currenttierpatched : (playerStats?.currenttierpatched ?? localPlayer.currenttierpatched)),
        rankingInTier: localPlayer.rankingInTier ?? playerStats?.rankingInTier,
        peakrank: localPlayer.peakrank ?? playerStats?.peakrank,
        peakrankTier: localPlayer.peakrankTier ?? playerStats?.peakrankTier,
        // Use localPlayer stats if they exist (including 0 values), otherwise fall back to playerStats
        kd: (localPlayer.kd !== undefined && localPlayer.kd !== null && localPlayer.kd > 0) ? localPlayer.kd : (playerStats?.kd ?? localPlayer.kd),
        // winRate can be 0 (0% win rate), so check for undefined/null, not just > 0
        winRate: (localPlayer.winRate !== undefined && localPlayer.winRate !== null) ? localPlayer.winRate : (playerStats?.winRate ?? localPlayer.winRate),
        headshotPercentage: (localPlayer.headshotPercentage !== undefined && localPlayer.headshotPercentage !== null && localPlayer.headshotPercentage > 0) ? localPlayer.headshotPercentage : (playerStats?.headshotPercentage ?? localPlayer.headshotPercentage),
        accuracy: playerStats?.accuracy ?? (localPlayer as any)?.accuracy,
        numberofgames: localPlayer.numberofgames ?? playerStats?.numberofgames,
        damagePerRound: playerStats?.damagePerRound ?? (localPlayer as any)?.damagePerRound,
        leaderboard: localPlayer.leaderboard ?? playerStats?.leaderboard,
        headshots: playerStats?.headshots,
        bodyshots: playerStats?.bodyshots,
        legshots: playerStats?.legshots,
        headshotTrend: playerStats?.headshotTrend,
      };
    }
    
    // If localPlayer has no valid data, use fetched playerStats
    return playerStats;
  }, [localPlayer, playerStats, actRank, selectedActUuid, currentActUuid]);

  // Show dashboard with fetched stats even when Valorant isn't running
  const showStats = displayStats || localPlayer;

  // Always show dashboard - stats will be fetched from API if available
  // Even when Valorant isn't running, we can display saved player info and fetched stats

  return (
    <div className="overview-dashboard">
      {viewMode === 'match-history' && (
        <div className="overview-match-history-page">
          <div className="overview-match-history-page-header">
            <button 
              className="overview-match-history-back-btn"
              onClick={() => {
                setViewMode('overview');
                setSelectedAgentFilter(null);
                setSelectedAgentDisplayName(null);
                setSelectedMapFilter(null);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to Overview
            </button>
            <h2 className="overview-match-history-page-title">
              {selectedAgentDisplayName 
                ? `Match History - ${selectedAgentDisplayName}` 
                : selectedMapFilter 
                  ? `Match History - ${mapStats.find(m => m.mapName.toLowerCase() === selectedMapFilter)?.mapName || selectedMapFilter}` 
                  : 'Match History'}
            </h2>
          </div>
          <div className="overview-match-history-list">
            {matchHistory.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem', color: '#8b8b8b' }}>
                No matches found
              </p>
            ) : (
              (() => {
                // Filter matches by selected agent or map if filter is active
                let filteredMatches = matchHistory;
                
                if (selectedAgentFilter) {
                  filteredMatches = filteredMatches.filter((match: any) => {
                    // Extract player data to check agent
                    let playerData: any = null;
                    let playerStats: any = null;
                    
                    // v4 API structure: players array
                    if (match.players && Array.isArray(match.players)) {
                      if (savedPlayerInfo.puuid) {
                        playerData = match.players.find((p: any) => p.puuid === savedPlayerInfo.puuid);
                      } else if (match.players.length > 0) {
                        playerData = match.players[0];
                      }
                      playerStats = playerData?.stats;
                    }
                    // v1/v3 API structure: stats object
                    else if (match.stats) {
                      if (savedPlayerInfo.puuid && match.stats.puuid === savedPlayerInfo.puuid) {
                        playerData = { stats: match.stats };
                        playerStats = match.stats;
                      } else if (!savedPlayerInfo.puuid) {
                        playerData = { stats: match.stats };
                        playerStats = match.stats;
                      }
                    }
                    
                    // Try players.all_players (v1 API structure)
                    if (!playerStats && match.players?.all_players && Array.isArray(match.players.all_players)) {
                      if (savedPlayerInfo.puuid) {
                        playerData = match.players.all_players.find((p: any) => p.puuid === savedPlayerInfo.puuid);
                      } else if (match.players.all_players.length > 0) {
                        playerData = match.players.all_players[0];
                      }
                      playerStats = playerData?.stats;
                    }
                    
                    // Get agent name from match
                    const agentNameRaw = playerData?.agent?.name || playerStats?.character?.name || '';
                    const agentName = (typeof agentNameRaw === 'string' ? agentNameRaw : String(agentNameRaw || '')).trim();
                    
                    // Normalize agent names for comparison (case-insensitive)
                    return agentName.toLowerCase() === selectedAgentFilter.toLowerCase();
                  });
                }
                
                if (selectedMapFilter) {
                  filteredMatches = filteredMatches.filter((match: any) => {
                    // Extract map name from match metadata
                    const metadata = match.metadata || match.meta || {};
                    let mapNameRaw = metadata?.map;
                    if (typeof mapNameRaw === 'object' && mapNameRaw !== null) {
                      mapNameRaw = mapNameRaw.name || mapNameRaw;
                    }
                    const mapName = (typeof mapNameRaw === 'string' ? mapNameRaw : String(mapNameRaw || '')).trim();
                    
                    // Normalize map names for comparison (case-insensitive)
                    return mapName.toLowerCase() === selectedMapFilter.toLowerCase();
                  });
                }
                
                const renderedMatches = filteredMatches
                  .map((match: any, index: number) => {
                  // Extract player data - handle different API structures (v1, v3, v4)
                  let playerData: any = null;
                  let playerStats: any = null;
                  let metadata = match.metadata || match.meta || {};
                  
                  // v4 API structure: players array
                  if (match.players && Array.isArray(match.players)) {
                    if (savedPlayerInfo.puuid) {
                      playerData = match.players.find((p: any) => p.puuid === savedPlayerInfo.puuid);
                    } else if (match.players.length > 0) {
                      // Fallback: use first player if no PUUID available
                      playerData = match.players[0];
                    }
                    playerStats = playerData?.stats;
                  }
                  // v1/v3 API structure: stats object
                  else if (match.stats) {
                    // Check if this is the player's stats
                    if (savedPlayerInfo.puuid && match.stats.puuid === savedPlayerInfo.puuid) {
                      playerData = { stats: match.stats };
                      playerStats = match.stats;
                    } else if (!savedPlayerInfo.puuid) {
                      // Fallback: use stats if no PUUID available
                      playerData = { stats: match.stats };
                      playerStats = match.stats;
                    }
                  }
                  
                  // If still no player stats, try to extract from other structures
                  if (!playerStats) {
                    // Try players.all_players (v1 API structure)
                    if (match.players?.all_players && Array.isArray(match.players.all_players)) {
                      if (savedPlayerInfo.puuid) {
                        playerData = match.players.all_players.find((p: any) => p.puuid === savedPlayerInfo.puuid);
                      } else if (match.players.all_players.length > 0) {
                        playerData = match.players.all_players[0];
                      }
                      playerStats = playerData?.stats;
                    }
                  }
                  
                  // If still no player stats, create minimal stats object
                  if (!playerStats) {
                    playerStats = {
                      kills: 0,
                      deaths: 0,
                      assists: 0,
                      score: 0
                    };
                  }
                  
                  // Extract match information - ensure all values are strings
                  let mapNameRaw = metadata?.map;
                  if (typeof mapNameRaw === 'object' && mapNameRaw !== null) {
                    mapNameRaw = mapNameRaw.name || 'Unknown';
                  }
                  const mapName = (typeof mapNameRaw === 'string' ? mapNameRaw : String(mapNameRaw || 'Unknown')).trim() || 'Unknown';
                  const mapImageUrl = (typeof mapName === 'string' && mapName !== 'Unknown') ? (mapImages[mapName.toLowerCase()] || null) : null;
                  
                  let modeRaw = metadata?.mode;
                  if (typeof modeRaw === 'object' && modeRaw !== null) {
                    modeRaw = modeRaw.name;
                  }
                  if (!modeRaw) {
                    modeRaw = metadata?.queue?.name || metadata?.queue?.id;
                  }
                  const mode = (typeof modeRaw === 'string' ? modeRaw : String(modeRaw || 'Unknown')).trim() || 'Unknown';
                  
                  const agentNameRaw = playerData?.agent?.name || playerStats?.character?.name || 'Unknown';
                  const agentName = (typeof agentNameRaw === 'string' ? agentNameRaw : String(agentNameRaw || 'Unknown')).trim() || 'Unknown';
                  
                  // Try multiple formats to find agent image
                  let agentImageUrl: string | null = null;
                  if (typeof agentName === 'string' && agentName !== 'Unknown') {
                    // Try exact match first
                    agentImageUrl = agentImages[agentName] || null;
                    
                    // Try case-insensitive match if exact match failed
                    if (!agentImageUrl && Object.keys(agentImages).length > 0) {
                      const matchingKey = Object.keys(agentImages).find(
                        key => key.toLowerCase() === agentName.toLowerCase()
                      );
                      if (matchingKey) {
                        agentImageUrl = agentImages[matchingKey];
                      }
                    }
                    
                    // Fallback: try to construct URL from valorant-api.com using character ID
                    if (!agentImageUrl) {
                      const characterId = playerData?.agent?.id || playerStats?.character?.id;
                      if (characterId && typeof characterId === 'string' && characterId.length > 0) {
                        // Use valorant-api.com to get agent icon by UUID
                        agentImageUrl = `https://media.valorant-api.com/agents/${characterId}/displayicon.png`;
                      }
                    }
                  }
                  
                  // Extract team and win/loss information
                  const playerTeam = playerData?.team_id || playerStats?.team;
                  let won = false;
                  let playerScore = 0;
                  let enemyScore = 0;
                  
                  // Handle different team structures
                  if (match.teams) {
                    if (Array.isArray(match.teams)) {
                      // v4 API: teams array
                      const playerTeamObj = match.teams.find((t: any) => t.team_id === playerTeam);
                      const enemyTeamObj = match.teams.find((t: any) => t.team_id !== playerTeam);
                      won = playerTeamObj?.won === true;
                      playerScore = playerTeamObj?.rounds?.won || 0;
                      enemyScore = enemyTeamObj?.rounds?.won || 0;
                    } else if (typeof match.teams === 'object') {
                      // v1 API: teams object
                      const redRounds = typeof match.teams.red === 'number' ? match.teams.red : (match.teams.red?.rounds_won || 0);
                      const blueRounds = typeof match.teams.blue === 'number' ? match.teams.blue : (match.teams.blue?.rounds_won || 0);
                      
                      // Determine which team is the player's team
                      if (playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'))) {
                        playerScore = redRounds;
                        enemyScore = blueRounds;
                        won = redRounds > blueRounds;
                      } else {
                        playerScore = blueRounds;
                        enemyScore = redRounds;
                        won = blueRounds > redRounds;
                      }
                    }
                  }
                  
                  // Extract stats
                  const kills = playerStats.kills || 0;
                  const deaths = playerStats.deaths || 0;
                  const assists = playerStats.assists || 0;
                  const score = playerStats.score || playerStats.damage?.dealt || playerStats.damage_made || 0;
                  
                  // Extract rank and RR change - try multiple sources
                  const rankTier = playerData?.tier?.id || playerData?.tier || playerStats?.tier || 0;
                  const rankImage = rankTier > 0 ? getRankImage(rankTier) : null;
                  
                  // RR change might be in different places - try multiple sources
                  let rrChange: number | null = null;
                  
                  // Try v4 API structure first
                  if (playerData?.mmr_change_to_last_game !== undefined && playerData.mmr_change_to_last_game !== null) {
                    rrChange = playerData.mmr_change_to_last_game;
                  } 
                  // Try v1/v3 API structure
                  else if (playerStats?.mmr_change_to_last_game !== undefined && playerStats.mmr_change_to_last_game !== null) {
                    rrChange = playerStats.mmr_change_to_last_game;
                  } 
                  // Try metadata
                  else if (match.metadata?.mmr_change_to_last_game !== undefined && match.metadata.mmr_change_to_last_game !== null) {
                    rrChange = match.metadata.mmr_change_to_last_game;
                  }
                  // Try meta (v1 API)
                  else if (match.meta?.mmr_change_to_last_game !== undefined && match.meta.mmr_change_to_last_game !== null) {
                    rrChange = match.meta.mmr_change_to_last_game;
                  }
                  // Try stats.mmr_change (alternative field name)
                  else if (playerStats?.mmr_change !== undefined && playerStats.mmr_change !== null) {
                    rrChange = playerStats.mmr_change;
                  }
                  // Try playerData.mmr_change
                  else if (playerData?.mmr_change !== undefined && playerData.mmr_change !== null) {
                    rrChange = playerData.mmr_change;
                  }
                  
                  // Determine outcome text (DEFEAT, VICTORY, or placement for non-competitive modes)
                  let outcomeText = won ? 'VICTORY' : 'DEFEAT';
                  let outcomeColor = won ? '#22ffc7' : '#ff5168';
                  
                  // For non-competitive modes, might show placement
                  if (typeof mode === 'string' && (mode.toLowerCase().includes('deathmatch') || mode.toLowerCase().includes('team deathmatch'))) {
                    outcomeText = 'N/A';
                    outcomeColor = '#8b9cb6';
                  }
                  
                  return (
                    <div 
                      key={`match-${metadata?.id || metadata?.match_id || index}`} 
                      className="overview-match-history-card"
                    >
                      <div className="match-history-card-background" style={mapImageUrl ? {
                        backgroundImage: `url(${mapImageUrl})`,
                      } : {}}></div>
                      <div className="match-history-card-content">
                        <div className="match-history-left-group">
                          {agentImageUrl ? (
                            <img 
                              src={agentImageUrl} 
                              alt={agentName}
                              className="match-history-agent-portrait"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="match-history-agent-placeholder"></div>
                          )}
                          <div className="match-history-rank-rr-group">
                            {rankImage ? (
                              <img 
                                src={rankImage}
                                alt="Rank"
                                className="match-history-rank-icon"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="match-history-rank-placeholder"></div>
                            )}
                            {rrChange !== null && typeof rrChange === 'number' ? (
                              <div className="match-history-rr-change" style={{ color: rrChange > 0 ? '#12cc54' : '#ff4655' }}>
                                {rrChange > 0 ? '+' : ''}{rrChange}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="match-history-card-center">
                          <div className="match-history-stats-section">
                            <div className="match-history-kda">KDA {kills} / {deaths} / {assists}</div>
                            <div className="match-history-score">SCORE {score.toLocaleString()}</div>
                          </div>
                          <div className="match-history-outcome-section">
                            <div className="match-history-outcome" style={{ color: outcomeColor }}>
                              {outcomeText}
                            </div>
                            {(playerScore > 0 || enemyScore > 0) && (
                              <div className="match-history-score-match">
                                <span style={{ color: '#ece8e1' }}>{playerScore}</span>
                                <span style={{ color: '#ece8e1', margin: '0 0.25rem' }}> - </span>
                                <span style={{ color: outcomeColor }}>{enemyScore}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  })
                  .filter(Boolean); // Remove null entries
                if (renderedMatches.length === 0 && matchHistory.length > 0) {
                  return (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#8b8b8b' }}>
                      {matchHistory.length} matches found, but unable to render player data. Check console for details.
                    </p>
                  );
                }
                
                return renderedMatches;
              })()
            )}
          </div>
        </div>
      )}
      {viewMode === 'overview' && (
      <div className="overview-columns">
        {/* Left Column */}
        <div className="overview-left-column">
          {/* OVERVIEW Section */}
          <div className="overview-section overview-combined-card">
            <div className="overview-section-header">
              <h2 className="overview-section-title">OVERVIEW</h2>
            </div>
            
            {/* Stats Cards */}
            <div className="overview-stats-cards">
              {statsError && (
                <div className="overview-error">{statsError}</div>
              )}
              
              {loadingStats ? (
                // Skeleton loading for stats cards
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="overview-stat-card-horizontal overview-stat-card-skeleton">
                      <div className="overview-stat-card-header">
                        <div className="overview-skeleton-label"></div>
                      </div>
                      <div className="overview-skeleton-value"></div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="overview-stat-card-horizontal">
                    <div className="overview-stat-card-header">
                      <span className="overview-stat-card-label">Damage / Round</span>
                    </div>
                    <div className="overview-stat-card-value">
                      {displayStats?.damagePerRound !== undefined 
                        ? displayStats.damagePerRound.toFixed(1) 
                        : '—'}
                    </div>
                  </div>

                  <div className="overview-stat-card-horizontal">
                    <div className="overview-stat-card-header">
                      <span className="overview-stat-card-label">K/D Ratio</span>
                    </div>
                    <div className="overview-stat-card-value">
                      {displayStats?.kd !== undefined 
                        ? displayStats.kd.toFixed(2) 
                        : '—'}
                    </div>
                  </div>

                  <div className="overview-stat-card-horizontal">
                    <div className="overview-stat-card-header">
                      <span className="overview-stat-card-label">Headshot %</span>
                    </div>
                    <div className="overview-stat-card-value">
                      {displayStats?.headshotPercentage !== undefined 
                        ? `${displayStats.headshotPercentage.toFixed(1)}%` 
                        : '—'}
                    </div>
                  </div>

                  <div className="overview-stat-card-horizontal">
                    <div className="overview-stat-card-header">
                      <span className="overview-stat-card-label">Win %</span>
                    </div>
                    <div className="overview-stat-card-value">
                      {displayStats?.winRate !== undefined 
                        ? `${displayStats.winRate.toFixed(1)}%` 
                        : '—'}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ROLES Section within same card */}
            <div className="overview-roles-divider">
              <span className="title-separator">◆</span>
              <h3 className="overview-roles-title">ROLES</h3>
              <span className="title-separator">◆</span>
            </div>
            <div className="overview-roles-grid">
              {loadingStats ? (
                // Skeleton loading for role cards
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="overview-role-card overview-role-card-skeleton">
                      <div className="overview-role-chart">
                        <div className="overview-skeleton-role-ring"></div>
                        <div className="overview-skeleton-role-icon"></div>
                      </div>
                      <div className="overview-role-info">
                        <div className="overview-skeleton-role-name"></div>
                        <div className="overview-skeleton-role-stat"></div>
                        <div className="overview-skeleton-role-stat"></div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {['Sentinel', 'Controller', 'Initiator', 'Duelist'].map((role) => {
                // Use real role stats if available, otherwise use overall stats as fallback
                const roleData = roleStats[role];
                const hasRoleData = roleData && roleData.matches > 0;
                const winRate = hasRoleData ? roleData.winRate : (displayStats?.winRate ?? null);
                const kda = hasRoleData ? roleData.kda : (displayStats?.kd ?? null);
                const matches = hasRoleData ? roleData.matches : (displayStats?.numberofgames ?? 0);
                const wins = hasRoleData ? roleData.wins : (winRate ? Math.floor(matches * (winRate / 100)) : 0);
                const losses = hasRoleData ? roleData.losses : (matches - wins);
                const kills = hasRoleData ? roleData.kills : 0;
                const deaths = hasRoleData ? roleData.deaths : 0;
                const assists = hasRoleData ? roleData.assists : 0;
                
                return (
                  <div key={role} className="overview-role-card">
                    <div className="overview-role-chart">
                      {winRate !== null && matches > 0 ? (
                      <div 
                        className="overview-role-ring"
                        style={{
                          background: `conic-gradient(
                            #ff4655 ${winRate}%, 
                            #2a3441 ${winRate}% 100%
                          )`
                        }}
                      ></div>
                      ) : (
                        <div 
                          className="overview-role-ring"
                          style={{
                            background: `conic-gradient(
                              #2a3441 0%, 
                              #2a3441 100%
                            )`
                          }}
                        ></div>
                      )}
                      <div className="overview-role-icon">
                        <img 
                          src={`./assets/${role.toLowerCase()}.png`} 
                          alt={role}
                          onError={(e) => {
                            // Fallback to text if image missing
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.parentElement!.innerText = role[0];
                          }}
                        />
                      </div>
                    </div>
                    <div className="overview-role-info">
                      <div className="overview-role-name">{role}</div>
                      {matches > 0 ? (
                        <>
                      <div className="overview-role-main-stats">
                            {winRate !== null && <span>WR {winRate.toFixed(1)}%</span>}
                            {kda !== null && <span>KDA {kda.toFixed(2)}</span>}
                      </div>
                      <div className="overview-role-sub-stats">
                        <span>{wins}W - <span className="role-losses">{losses}L</span></span>
                            {matches > 0 && (
                        <span className="role-kda-breakdown">{kills} / {deaths} / {assists}</span>
                            )}
                      </div>
                        </>
                      ) : (
                        <div className="overview-role-no-data">No matches played</div>
                      )}
                    </div>
                  </div>
                );
              })}
                </>
              )}
            </div>
          </div>

          {/* Top Agents Section */}
          <div className="overview-section overview-top-agents-card">
            <div className="overview-section-header">
              <h2 className="overview-section-title">AGENTS</h2>
            </div>
            <div className="overview-top-agents-list">
              {loadingStats ? (
                // Skeleton loading
                <div className="overview-top-agents-card-skeleton">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="overview-top-agent-item overview-top-agent-skeleton">
                      <div className="overview-top-agent-left">
                        <div className="overview-skeleton-agent-icon"></div>
                        <div className="overview-top-agent-info">
                          <div className="overview-skeleton-agent-name"></div>
                          <div className="overview-skeleton-agent-matches">
                            <div className="overview-skeleton-agent-hrs"></div>
                            <div className="overview-skeleton-agent-match-count"></div>
                          </div>
                        </div>
                      </div>
                      <div className="overview-top-agent-stats">
                        <div className="overview-top-agent-stat">
                          <div className="overview-skeleton-agent-stat-value"></div>
                          <div className="overview-skeleton-agent-stat-label"></div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-skeleton-agent-stat-value"></div>
                          <div className="overview-skeleton-agent-stat-label"></div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-skeleton-agent-stat-value"></div>
                          <div className="overview-skeleton-agent-stat-label"></div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-skeleton-agent-stat-value"></div>
                          <div className="overview-skeleton-agent-stat-label"></div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-skeleton-agent-stat-value"></div>
                          <div className="overview-skeleton-agent-stat-label"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : agentStats.length > 0 ? (
                agentStats.map((agent, index) => {
                  // Try multiple ways to get agent image
                  let agentImageUrl: string | null = null;
                  
                  // Try from preloaded agent images
                  if (Object.keys(agentImages).length > 0) {
                    agentImageUrl = agentImages[agent.agentDisplayName] || 
                      agentImages[agent.agentName] ||
                      agentImages[agent.agentDisplayName.toLowerCase()] ||
                      agentImages[agent.agentName.toLowerCase()] ||
                      null;
                    
                    // Try case-insensitive match
                    if (!agentImageUrl) {
                      const matchingKey = Object.keys(agentImages).find(
                        key => key.toLowerCase() === agent.agentDisplayName.toLowerCase() || 
                               key.toLowerCase() === agent.agentName.toLowerCase()
                      );
                      if (matchingKey) {
                        agentImageUrl = agentImages[matchingKey];
                      }
                    }
                  }
                  
                  // Fallback: use character UUID if available
                  if (!agentImageUrl && agent.agentId) {
                    agentImageUrl = `https://media.valorant-api.com/agents/${agent.agentId}/displayicon.png`;
                  }
                  
                  return (
                    <div 
                      key={`${agent.agentName}-${index}`} 
                      className="overview-top-agent-item"
                      onClick={() => {
                        // Use the normalized agent name (lowercase) for filtering
                        setSelectedAgentFilter(agent.agentName.toLowerCase());
                        setSelectedAgentDisplayName(agent.agentDisplayName);
                        setSelectedMapFilter(null);
                        setViewMode('match-history');
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="overview-top-agent-left">
                        {agentImageUrl ? (
                          <img 
                            src={agentImageUrl}
                            alt={agent.agentDisplayName}
                            className="overview-top-agent-icon"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="overview-top-agent-icon-placeholder"></div>
                        )}
                        <div className="overview-top-agent-info">
                          <div className="overview-top-agent-name">{agent.agentDisplayName}</div>
                          <div className="overview-top-agent-matches">
                            <span>{agent.timePlayed.toFixed(0)} HRS</span>
                            <span>{agent.matches} Matches</span>
                          </div>
                        </div>
                      </div>
                      <div className="overview-top-agent-stats">
                        <div className="overview-top-agent-stat">
                          <div className="overview-top-agent-stat-value">{agent.winRate.toFixed(1)}%</div>
                          <div className="overview-top-agent-stat-label">Win %</div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-top-agent-stat-value">{agent.kd.toFixed(2)}</div>
                          <div className="overview-top-agent-stat-label">K/D</div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-top-agent-stat-value">{agent.adr.toFixed(1)}</div>
                          <div className="overview-top-agent-stat-label">ADR</div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-top-agent-stat-value">{agent.acs.toFixed(1)}</div>
                          <div className="overview-top-agent-stat-label">ACS</div>
                        </div>
                        <div className="overview-top-agent-stat">
                          <div className="overview-top-agent-stat-value" style={{ color: agent.dd >= 0 ? '#12cc54' : '#ff4655' }}>
                            {agent.dd >= 0 ? '+' : ''}{agent.dd.toFixed(0)}
                          </div>
                          <div className="overview-top-agent-stat-label">DDΔ</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="overview-top-agents-empty">
                  <p>No agent data available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="overview-right-column">
          {/* Rank Section */}
          <div className="overview-rank-card">
            {loadingStats ? (
              // Skeleton loading for rank card
              <div className="overview-rank-card-skeleton">
                <div className="overview-rank-content">
                  <div className="overview-rank-icon-container">
                  <div className="overview-skeleton-rank-icon"></div>
                  </div>
                  <div className="overview-rank-info-container">
                  <div className="overview-skeleton-rank-name"></div>
                  <div className="overview-skeleton-rank-episode"></div>
                    <div className="overview-rank-rr-section">
                      <div className="overview-rank-rating-bar-container">
                  <div className="overview-skeleton-rank-rating-bar"></div>
                      </div>
                      <div className="overview-rank-info-row">
                        <div className="overview-skeleton-rank-rating-label"></div>
                        <div className="overview-skeleton-rank-rating-value"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : showStats && (displayStats?.currenttier !== undefined && displayStats?.currenttier !== null) ? (
              <div className="overview-rank-content">
                <div className="overview-rank-icon-container">
                  <img
                    src={getRankImage(displayStats.currenttier)}
                    alt={displayStats.currenttierpatched || 'Rank'}
                    className="overview-rank-large-icon"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      if (!img.src.includes('data:image/svg+xml')) {
                        img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#2a3441"/></svg>';
                      }
                    }}
                  />
                </div>
                <div className="overview-rank-info-container">
                  <h2 className="overview-rank-name">{displayStats.currenttierpatched || 'UNRANKED'}</h2>
                  <p className="overview-rank-episode">
                    {selectedActUuid && episodes.length > 0 ? (() => {
                      for (const episode of episodes) {
                        const act = episode.acts.find(a => a.uuid === selectedActUuid);
                        if (act) {
                          return `${episode.displayName} : ${act.displayName}`;
                        }
                      }
                      return 'EP 6 : ACT 3';
                    })() : 'EP 6 : ACT 3'}
                  </p>
                  {/* Only show RR if it's the current act */}
                  {selectedActUuid === currentActUuid && displayStats.rankingInTier !== undefined && (
                    <div className="overview-rank-rr-section">
                      <div className="overview-rank-rating-bar-container">
                        <div 
                          className="overview-rank-rating-fill" 
                          style={{ width: `${displayStats.rankingInTier || 0}%` }}
                        ></div>
                      </div>
                      <div className="overview-rank-info-row">
                        <span>Rank Rating</span>
                        <span>{displayStats.rankingInTier || 0}/100</span>
                      </div>
                    </div>
                  )}
                  <button 
                    className="overview-match-history-btn"
                    onClick={() => {
                      setSelectedAgentFilter(null);
                      setSelectedAgentDisplayName(null);
                      setSelectedMapFilter(null);
                      setViewMode('match-history');
                    }}
                  >
                    View Match History
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overview-rank-placeholder" style={{ padding: '2rem' }}>
                <p>No rank data available. {!henrikApiKey ? 'Add API key in Settings.' : 'Join a match to update rank.'}</p>
              </div>
            )}
          </div>

          {/* Accuracy Section */}
          <div className="overview-accuracy-card">
            {loadingStats ? (
              // Skeleton loading for accuracy card
              <div className="overview-accuracy-card-skeleton">
                <div className="overview-accuracy-header">
                  <div className="overview-skeleton-accuracy-title"></div>
                  <div className="overview-skeleton-accuracy-subtitle"></div>
                </div>
                <div className="overview-accuracy-content">
                  <div className="overview-accuracy-section">
                    <div className="overview-accuracy-visual">
                      <div className="overview-skeleton-accuracy-human-figure"></div>
                      <div className="overview-accuracy-breakdown">
                        <div className="overview-skeleton-accuracy-stat-item">
                          <div className="overview-skeleton-accuracy-stat-label"></div>
                          <div className="overview-skeleton-accuracy-stat-value"></div>
                          <div className="overview-skeleton-accuracy-stat-hits"></div>
                        </div>
                        <div className="overview-skeleton-accuracy-stat-item">
                          <div className="overview-skeleton-accuracy-stat-label"></div>
                          <div className="overview-skeleton-accuracy-stat-value"></div>
                          <div className="overview-skeleton-accuracy-stat-hits"></div>
                        </div>
                        <div className="overview-skeleton-accuracy-stat-item">
                          <div className="overview-skeleton-accuracy-stat-label"></div>
                          <div className="overview-skeleton-accuracy-stat-value"></div>
                          <div className="overview-skeleton-accuracy-stat-hits"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="overview-accuracy-graph-section">
                    <div className="overview-skeleton-accuracy-graph-title"></div>
                    <div className="overview-skeleton-accuracy-graph-container">
                      <div className="overview-skeleton-accuracy-graph"></div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="overview-accuracy-header">
                  <h3 className="overview-accuracy-title">ACCURACY</h3>
                  <span className="overview-accuracy-subtitle">Last 20 Matches</span>
                </div>
                <div className="overview-accuracy-content">
                  <div className="overview-accuracy-section">
                    <div className="overview-accuracy-visual">
                      <div className="overview-accuracy-human-figure">
                        {(() => {
                          // Helper function to calculate green color with transparency based on percentage
                          const getGreenColor = (percentage: number | undefined): string => {
                            if (percentage === undefined || percentage <= 0) return '#2a3441'; // Dark gray for no data
                            
                            // Clamp percentage between 0 and 100
                            const clampedPct = Math.max(0, Math.min(100, percentage));
                            
                            // Base color: #4cb051
                            // Convert hex to RGB: 4c = 76, b0 = 176, 51 = 81
                            // Adjust opacity based on percentage: 0% = 0.2 opacity, 100% = 1.0 opacity
                            const opacity = 0.2 + (clampedPct / 100) * 0.8; // 0.2 to 1.0
                            
                            return `rgba(76, 176, 81, ${opacity})`;
                          };
                          
                          // Calculate percentages for each body part
                          const headPercentage = displayStats?.headshotPercentage;
                          const bodyPercentage = displayStats?.accuracy !== undefined && displayStats?.headshotPercentage !== undefined
                            ? Math.max(0, displayStats.accuracy - displayStats.headshotPercentage)
                            : undefined;
                          const legPercentage = displayStats?.accuracy !== undefined
                            ? Math.max(0, 100 - displayStats.accuracy)
                            : undefined;
                          
                          return (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 336.51 798.6" className="human-figure-svg">
                              <path 
                                id="head" 
                                fill={getGreenColor(headPercentage)}
                                d="M529.19,199.26a65.79,65.79,0,0,1,1.09-9.89c5.76-4.68,8-17.12,8-17.12,9.56-7.33,9.1-18.06,4.68-17.94-3.54.09-2.74-2.85-2.74-2.85,6-48.29-36.9-50.76-36.9-50.76h-6.54s-42.9,2.47-36.93,50.75c0,0,.8,2.94-2.77,2.84-4.41-.11-4.82,10.62,4.71,18,0,0,2.22,12.43,8,17.12a66.4,66.4,0,0,1,1.12,10.82s26.6,20.69,58.32-.92" 
                                transform="translate(-331.74 -100.7)"
                                style={{ transition: 'fill 0.3s ease' }}
                              />
                              <path 
                                id="body" 
                                fill={getGreenColor(bodyPercentage)}
                                d="M567.26,436.77c-4.51-20.16,2.1-92,2.1-92,9.24,14.37,8.88,39.73,8.88,39.73-1.46,26.59,21.49,67.24,21.49,67.24,11,16.79,15.2,32.73,15.2,33.91,0,4.84-1.06,16.56-1.06,16.56l.43,10.2c.19,2.59,1.65,11.54,1.41,15.86-1.72,26.61,2.51,21.6,2.51,21.6,3.56,0,7.48-21.41,7.48-21.41,0,5.52-1.35,22,1.63,28.29,3.56,7.44,6.19-1.28,6.23-3,.94-33.87,3-25,3-25,2,27.49,4.42,33.69,8.78,31.55,3.31-1.58.29-33,.29-33,5.66,18.66,10,21.63,10,21.63,9.34,6.56,3.56-11.57,2.26-15.16-6.91-19.07-7.13-25.69-7.13-25.69,8.65,17.15,15.16,16.51,15.16,16.51,8.43-2.69-7.37-27-16.62-38.59-4.72-5.93-10.82-13.86-12.58-18.57-2.88-8-5.06-33.63-5.06-33.63-.87-30.27-8.36-43.42-8.36-43.42-12.79-20.48-15.2-58.68-15.2-58.68l-.56-64.5c-4.49-44-36.91-44.32-36.91-44.32C537.8,218,533.24,207.4,533.24,207.4c-39.75,23.27-66.48,0-66.48,0s-4.54,10.58-37.33,15.46c0,0-32.47.32-36.88,44.31l-.62,64.5s-2.36,38.21-15.2,58.69c0,0-7.45,13.15-8.31,43.42,0,0-2.19,25.65-5.06,33.63-1.74,4.69-7.83,12.62-12.59,18.57-9.34,11.6-25,35.82-16.64,38.59,0,0,6.55.63,15.16-16.51,0,0-.18,6.57-7.08,25.69-1.36,3.54-7.13,21.67,2.22,15.16,0,0,4.33-3,10-21.63,0,0-3,31.41.34,33,4.39,2.16,6.79-4.06,8.77-31.54,0,0,2-8.87,3,25,0,1.75,2.61,10.46,6.19,3,3-6.24,1.67-22.74,1.67-28.29,0,0,3.87,21.41,7.49,21.41,0,0,4.26,5,2.51-21.6-.28-4.34,1.24-13.27,1.43-15.86l.41-10.21s-1.06-11.68-1.06-16.55c0-1.2,4.18-17.12,15.21-33.91,0,0,22.92-40.67,21.45-67.24,0,0-.32-25.36,8.91-39.73,0,0,6.55,71.83,2.11,92Z" 
                                transform="translate(-331.74 -100.7)"
                                style={{ transition: 'fill 0.3s ease' }}
                              />
                              <path 
                                id="legs" 
                                fill={getGreenColor(legPercentage)}
                                d="M432.79,446.47S412.17,496,416.71,533c3.35,27.51,9.81,86.22,16.39,109.41,3.44,12,1.4,42.26,4.16,49.82,1.24,3.28.59,6.31-2.08,13.74-9.26,26-8.08,44.34,15.2,113.38,0,0,7.17,15.29,3.55,42.78,0,0-14.88,30.6-5.35,31.21,0,0,.74,2,4,.42,0,0,5.14,5.31,10.7,2.43,0,0,5.15,4.11,9.55.45a6.56,6.56,0,0,0,8.67.78s6.76,4.56,10.77-.38c0,0,7.13,1.58-5.56-30.58,0,0-4.86-34.09-7.54-40.79-5.11-12.7-1.5-47.5-.41-55,1.75-12.47.81-33.72-2.4-50.15-2.35-11.78,4-34,6.36-47.7C487.52,644,497,570.57,495.8,556.66l3.91,1.37a7.91,7.91,0,0,0,4.56-1.36c-1.18,13.88,8.25,87.36,13.11,116.17,2.31,13.64,8.66,35.88,6.38,47.69-3.26,16.45-4.21,37.75-2.41,50.15,1.13,7.53,4.69,42.26-.4,55-2.67,6.66-7.56,40.8-7.56,40.8C500.65,898.6,507.84,897,507.84,897c3.94,4.84,10.7.38,10.7.38a6.62,6.62,0,0,0,8.71-.78c4.41,3.66,9.56-.45,9.56-.45,5.55,2.88,10.7-2.43,10.7-2.43,3.18,1.61,4-.42,4-.42,9.56-.61-5.33-31.21-5.33-31.21-3.57-27.49,3.54-42.78,3.54-42.78,23.28-69,24.46-87.36,15.15-113.38-2.62-7.51-3.28-10.48-2.07-13.74,2.78-7.53.75-37.8,4.15-49.82,6.56-23.18,13-82,16.41-109.4,4.53-37-16.06-86.5-16.06-86.5Z" 
                                transform="translate(-331.74 -100.7)"
                                style={{ transition: 'fill 0.3s ease' }}
                              />
                            </svg>
                          );
                        })()}
                      </div>
                      <div className="overview-accuracy-breakdown">
                        <div className="overview-accuracy-stat-item">
                          <span className="overview-accuracy-stat-label">Head</span>
                          <span className="overview-accuracy-stat-value">
                            {displayStats?.headshotPercentage !== undefined 
                              ? `${displayStats.headshotPercentage.toFixed(1)}%` 
                              : '—'}
                          </span>
                          <span className="overview-accuracy-stat-hits">
                            {(displayStats as PlayerStats)?.headshots !== undefined 
                              ? `${(displayStats as PlayerStats).headshots!.toLocaleString()} Hits` 
                              : '— Hits'}
                          </span>
                        </div>
                        <div className="overview-accuracy-stat-item">
                          <span className="overview-accuracy-stat-label">Body</span>
                          <span className="overview-accuracy-stat-value">
                            {displayStats?.accuracy !== undefined && displayStats?.headshotPercentage !== undefined
                              ? `${Math.max(0, (displayStats.accuracy - displayStats.headshotPercentage)).toFixed(1)}%`
                              : '—'}
                          </span>
                          <span className="overview-accuracy-stat-hits">
                            {(displayStats as PlayerStats)?.bodyshots !== undefined 
                              ? `${(displayStats as PlayerStats).bodyshots!.toLocaleString()} Hits` 
                              : '— Hits'}
                          </span>
                        </div>
                        <div className="overview-accuracy-stat-item">
                          <span className="overview-accuracy-stat-label">Legs</span>
                          <span className="overview-accuracy-stat-value">
                            {displayStats?.accuracy !== undefined
                              ? `${Math.max(0, (100 - displayStats.accuracy)).toFixed(1)}%`
                              : '—'}
                          </span>
                          <span className="overview-accuracy-stat-hits">
                            {(displayStats as PlayerStats)?.legshots !== undefined 
                              ? `${(displayStats as PlayerStats).legshots!.toLocaleString()} Hits` 
                              : '— Hits'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {(displayStats as PlayerStats)?.headshotTrend && (displayStats as PlayerStats).headshotTrend!.length > 0 && (
                    <div className="overview-accuracy-graph-section">
                      <div className="overview-accuracy-graph-title">AVERAGE HEADSHOT RATE (%)</div>
                      <div className="overview-accuracy-graph-container">
                        <div className="overview-accuracy-graph-labels">
                          <span>50</span>
                          <span>40</span>
                          <span>30</span>
                          <span>20</span>
                          <span>10</span>
                        </div>
                        <svg className="overview-accuracy-graph" viewBox="0 0 300 70" preserveAspectRatio="none">
                          <polygon
                            fill="url(#accuracyGradient)"
                            fillOpacity="0.4"
                            points={(() => {
                              const trend = (displayStats as PlayerStats).headshotTrend!;
                              const basePoints = trend.map((value: number, index: number) => {
                                const x = (index / (trend.length - 1 || 1)) * 300;
                                const y = 70 - (((value - 10) / 40) * 70); // Scale to 10-50 range
                                return `${x},${y}`;
                              }).join(' ');
                              return `${basePoints} 300,70 0,70`;
                            })()}
                          />
                          <polyline
                            fill="none"
                            stroke="#ff4655"
                            strokeWidth="2.5"
                            points={(displayStats as PlayerStats).headshotTrend!.map((value: number, index: number) => {
                              const trend = (displayStats as PlayerStats).headshotTrend!;
                              const x = (index / (trend.length - 1 || 1)) * 300;
                              const y = 80 - (((value - 10) / 40) * 80); // Scale to 10-50 range
                              return `${x},${y}`;
                            }).join(' ')}
                          />
                          <defs>
                            <linearGradient id="accuracyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="#ff4655" stopOpacity="0.6" />
                              <stop offset="100%" stopColor="#ff4655" stopOpacity="0.1" />
                            </linearGradient>
                          </defs>
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Maps Section */}
          <div className="overview-maps-card">
            {loadingStats ? (
              // Skeleton loading for maps card
              <div className="overview-maps-card-skeleton">
                <div className="overview-maps-header">
                  <div className="overview-skeleton-maps-title"></div>
                  <div className="overview-skeleton-maps-subtitle"></div>
                </div>
                <div className="overview-maps-content">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="overview-skeleton-map-item">
                      <div className="overview-skeleton-map-info">
                        <div className="overview-skeleton-map-left">
                          <div className="overview-skeleton-map-name"></div>
                        </div>
                        <div className="overview-skeleton-map-stats-right">
                          <div className="overview-skeleton-map-winrate-label"></div>
                          <div className="overview-skeleton-map-winrate-value"></div>
                          <div className="overview-skeleton-map-wins-losses"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="overview-maps-header">
                  <h3 className="overview-maps-title">MAPS</h3>
                  <span className="overview-maps-subtitle">Performance by Map</span>
                </div>
                <div className="overview-maps-content">
                  {mapStats.length > 0 ? (
                    mapStats.map((mapStat) => {
                      const mapImageUrl = mapImages[mapStat.mapName.toLowerCase()] || 
                                         mapImages[mapStat.mapName] || 
                                         null;
                      return (
                        <div 
                          key={mapStat.mapName} 
                          className="overview-map-item"
                          onClick={() => {
                            setSelectedMapFilter(mapStat.mapName.toLowerCase());
                            setSelectedAgentFilter(null);
                            setSelectedAgentDisplayName(null);
                            setViewMode('match-history');
                          }}
                          style={{
                            backgroundImage: mapImageUrl ? `url(${mapImageUrl})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            backgroundRepeat: 'no-repeat',
                            cursor: 'pointer',
                          }}
                        >
                          <div className="overview-map-overlay"></div>
                          <div className="overview-map-info">
                            <div className="overview-map-left">
                              <div className="overview-map-name">{mapStat.mapName}</div>
                            </div>
                            <div className="overview-map-stats-right">
                              <div className="overview-map-winrate-label">WINRATE</div>
                              <div className="overview-map-winrate-value">{mapStat.winRate.toFixed(0)}%</div>
                              <div className="overview-map-wins-losses">
                                <span className="overview-map-wins">{mapStat.wins}W</span>
                                <span className="overview-map-separator"> - </span>
                                <span className="overview-map-losses">{mapStat.losses}L</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="overview-maps-empty">
                      <span>No map statistics available</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

