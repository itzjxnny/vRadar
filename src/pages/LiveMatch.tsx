import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { MatchData, Player } from '../types/match';
import { SkinDisplay } from '../components/SkinDisplay/SkinDisplay';
import { Settings } from '../components/Settings/Settings';
import { Overview } from '../components/Overview/Overview';
import { LayoutDashboard, Users, Settings as SettingsIcon, UsersRound } from 'lucide-react';
import './LiveMatch.css';

function LiveMatch() {
  const [match, setMatch] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGun, setSelectedGun] = useState('vandal');
  const [launchingValorant, setLaunchingValorant] = useState(false);
  // Load saved player info from localStorage on mount
  const loadSavedPlayerInfo = () => {
    try {
      const saved = localStorage.getItem('lastPlayerInfo');
      if (saved) {
        const playerInfo = JSON.parse(saved);
        // Found saved player info in localStorage (removed console.log to reduce spam)
        return {
          gameName: playerInfo.gameName || '',
          fullName: playerInfo.fullName || '',
          puuid: playerInfo.puuid || '',
          region: playerInfo.region || ''
        };
      } else {
        console.log('No saved player info found in localStorage (key: lastPlayerInfo)');
      }
    } catch (error) {
      console.error('Error loading saved player info:', error);
    }
    return { gameName: '', fullName: '', puuid: '', region: '' };
  };

  // Use state for savedPlayerInfo so it can be updated when account info is loaded
  const initialSavedPlayerInfo = loadSavedPlayerInfo();
  const [savedPlayerInfo, setSavedPlayerInfo] = useState(initialSavedPlayerInfo);
  const [localPlayerName, setLocalPlayerName] = useState<string>(initialSavedPlayerInfo.gameName);
  const [localPlayerFullName, setLocalPlayerFullName] = useState<string>(initialSavedPlayerInfo.fullName); // Full name with tag for card fetching
  const [localPlayerPuuid, setLocalPlayerPuuid] = useState<string>(initialSavedPlayerInfo.puuid); // PUUID for card caching
  // Note: region is saved but not currently used in UI - kept for future use
  const [, setLocalPlayerRegion] = useState<string>(initialSavedPlayerInfo.region);

  // Ensure saved player info is used on mount if Valorant is not running
  useEffect(() => {
    if (savedPlayerInfo.gameName || savedPlayerInfo.fullName || savedPlayerInfo.puuid) {
      // Loaded saved player info from localStorage (removed console.log to reduce spam)
      // Explicitly set state with saved values to ensure they're used
      if (savedPlayerInfo.gameName && !localPlayerName) {
        setLocalPlayerName(savedPlayerInfo.gameName);
      }
      if (savedPlayerInfo.fullName && !localPlayerFullName) {
        setLocalPlayerFullName(savedPlayerInfo.fullName);
      }
      if (savedPlayerInfo.puuid && !localPlayerPuuid) {
        setLocalPlayerPuuid(savedPlayerInfo.puuid);
      }
    } else {
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount
  const [henrikApiKey, setHenrikApiKey] = useState<string>('');
  const [localPlayerRankFromAPI, setLocalPlayerRankFromAPI] = useState<{ currenttier?: number; currenttierpatched?: string; rankingInTier?: number } | null>(null);
  const hasFetchedRankFromAPI = useRef(false);
  const lastMatchStateRef = useRef<string | null>(null);
  // Load cached cards from localStorage on mount
  const loadCachedCards = (): [Record<string, string>, Record<string, string>] => {
    try {
      const cachedWide = localStorage.getItem('playerCardCache');
      const cachedSmall = localStorage.getItem('playerCardSmallCache');
      return [
        cachedWide ? JSON.parse(cachedWide) : {},
        cachedSmall ? JSON.parse(cachedSmall) : {}
      ];
    } catch {
      return [{}, {}];
    }
  };

  const [playerCardCache, setPlayerCardCache] = useState<Record<string, string>>(() => loadCachedCards()[0]);
  const [playerCardSmallCache, setPlayerCardSmallCache] = useState<Record<string, string>>(() => loadCachedCards()[1]);
  const [fetchingCards, setFetchingCards] = useState<Set<string>>(new Set()); // Track cards being fetched
  const [activeTab, setActiveTab] = useState<'overview' | 'live-match' | 'settings'>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const overviewContentRef = useRef<HTMLDivElement>(null);
  // Track last match ID for Overview tab to prevent unnecessary refetches
  const lastOverviewMatchIdRef = useRef<string | null>(null);
  const overviewStatsCachedRef = useRef(false);
  
  // Visibility settings
  const [showKD, setShowKD] = useState(true);
  const [showHS, setShowHS] = useState(true);
  const [showWR, setShowWR] = useState(true);
  const [showRR, setShowRR] = useState(true);
  const [showSkin, setShowSkin] = useState(true);
  const [showRank, setShowRank] = useState(true);
  const [showPeak, setShowPeak] = useState(true);
  const [showLevel, setShowLevel] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [skinImageSize, setSkinImageSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [rankImages, setRankImages] = useState<Record<number, string>>({});
  const [rankImagesVersion, setRankImagesVersion] = useState<number>(0);
  const [showParty, setShowParty] = useState(true);
  const [autoStartWithValorant, setAutoStartWithValorant] = useState<boolean>(true);
  const [autoStartWithWindows, setAutoStartWithWindows] = useState<boolean>(false);
  const loggedMissingTiers = useRef<Set<number>>(new Set());
  const loggedEmptyRef = useRef<boolean>(false);
  const localPlayerCardFetchedRef = useRef<boolean>(false); // Track if we've attempted to fetch local player card
  // Start with null to indicate we haven't received a status yet
  // null = unknown, true = not running, false = running
  const [valorantNotRunning, setValorantNotRunning] = useState<boolean | null>(null);
  const [currentGameState, setCurrentGameState] = useState<string>('MENUS'); // Track game state from status updates
  const [patchVersion, setPatchVersion] = useState<string>('6.9');
  const [patchImage, setPatchImage] = useState<string | null>(null);
  const [patchTitle, setPatchTitle] = useState<string | null>(null);
  const [patchDescription, setPatchDescription] = useState<string | null>(null);
  const [patchUrl, setPatchUrl] = useState<string | null>(null);

  const loadCurrentMatch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!window.electronAPI) throw new Error('Electron API not available');

      const matchData = await window.electronAPI.getLocalMatch(selectedGun);
      if (matchData) {
        // Force update match state even if data looks the same (to trigger re-render)
        setMatch({ ...matchData, _timestamp: Date.now() });
      } else {
        // Keep previous match data if null? Or set to null
        // setMatch(null); 
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage || 'Failed to load match information.');
    } finally {
      setLoading(false);
    }
  }, [selectedGun]);

  // Fetch rank from Henrik Dev API for local player if local API returns unranked
  // Win rate is now fetched in the backend, so we only need to fetch rank here
  useEffect(() => {
    const fetchLocalPlayerRank = async () => {
      if (!henrikApiKey || !savedPlayerInfo.fullName || !savedPlayerInfo.region || !match) {
        return;
      }
      
      // Reset fetch flags if match state changed significantly (new match, state transition)
      const currentMatchState = `${match.state}-${match.Players?.length || 0}`;
      if (lastMatchStateRef.current !== currentMatchState) {
        hasFetchedRankFromAPI.current = false;
        lastMatchStateRef.current = currentMatchState;
      }
      
      // Check if local player in match has tier 0 (unranked)
      const localPlayerInMatch = match.Players?.find(p => 
        (localPlayerPuuid && p.Subject === localPlayerPuuid) ||
        (localPlayerName && (p.Name === localPlayerName || p.Name.startsWith(localPlayerName + '#')))
      );
      
      if (!localPlayerInMatch) {
        return;
      }
      
      // Only fetch rank if local player is unranked and we haven't already fetched
      const needsRankFetch = localPlayerInMatch.currenttier === 0 && !hasFetchedRankFromAPI.current && !localPlayerRankFromAPI?.currenttier;
      
      if (!needsRankFetch) {
        return;
      }
      
      try {
        const [gameName, tag] = savedPlayerInfo.fullName.includes('#') 
          ? savedPlayerInfo.fullName.split('#') 
          : [savedPlayerInfo.fullName, ''];
        
        if (!gameName || !tag) {
          return;
        }
        
        // Fetch rank from MMR endpoint
        hasFetchedRankFromAPI.current = true;
        const mmrUrl = `https://api.henrikdev.xyz/valorant/v1/mmr/${savedPlayerInfo.region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tag)}`;
        const mmrResponse = await fetch(mmrUrl, {
          headers: {
            'Authorization': henrikApiKey
          }
        });
        
        if (mmrResponse.ok) {
          const mmrData = await mmrResponse.json();
          if (mmrData.status === 200 && mmrData.data && mmrData.data.currenttier > 0) {
            setLocalPlayerRankFromAPI(prev => ({
              ...prev,
              currenttier: mmrData.data.currenttier,
              currenttierpatched: mmrData.data.currenttierpatched,
              rankingInTier: mmrData.data.ranking_in_tier
            }));
          }
        }
      } catch (error) {
        // Reset flag on error so we can retry
        hasFetchedRankFromAPI.current = false;
        console.error('Error fetching rank from Henrik Dev API:', error);
      }
    };
    
    fetchLocalPlayerRank();
  }, [match, henrikApiKey, savedPlayerInfo.fullName, savedPlayerInfo.region, localPlayerPuuid, localPlayerName, localPlayerRankFromAPI]);

  useEffect(() => {
    // Listen for real-time updates
    if (window.electronAPI) {
      const cleanupMatch = window.electronAPI.onMatchData((data) => {
        // Real-time updates shouldn't affect loading state - they're passive updates
        // Check if this is a new match (different players or state change)
        const previousState = match?.state;
        const currentState = data.state;
        const previousPlayerIds = new Set(match?.Players?.map(p => p.Subject) || []);
        const currentPlayerIds = new Set(data.Players?.map(p => p.Subject) || []);
        
        // Clear loaded stats tracking if match changed (new players or state transition)
        const playerIdsChanged = previousPlayerIds.size !== currentPlayerIds.size ||
            ![...currentPlayerIds].every(id => previousPlayerIds.has(id));
        
        // Track new players that just appeared - initialize them for skeleton display
        if (data.Players) {
          data.Players.forEach(player => {
            if (player.Subject && !previousPlayerIds.has(player.Subject)) {
              // This is a brand new player - initialize tracking so skeleton shows immediately
              if (!playerFirstSeen.current.has(player.Subject)) {
                playerFirstSeen.current.set(player.Subject, Date.now());
              }
              // Ensure they're not marked as loaded yet
              playersWithLoadedStats.current.delete(player.Subject);
            }
          });
        }
        
        // Special handling for state transitions - reset tracking when entering new states
        // This ensures skeletons show smoothly when players appear in agent select or game starts
        const isEnteringPregame = (previousState !== 'PREGAME' && currentState === 'PREGAME');
        const isEnteringIngame = (previousState !== 'INGAME' && currentState === 'INGAME');
        
        if (previousState !== currentState || playerIdsChanged || isEnteringPregame || isEnteringIngame) {
          // When state changes, clear tracking so skeletons show again
          // This is especially important when entering INGAME, as stats need to be re-fetched for enemies
          playersWithLoadedStats.current.clear();
          playerFirstSeen.current.clear();
          
          // Re-initialize tracking for all current players - mark them as new so skeleton shows
          if (data.Players) {
            data.Players.forEach(player => {
              if (player.Subject) {
                // Reset first seen time to NOW so skeleton shows immediately
                playerFirstSeen.current.set(player.Subject, Date.now());
                // Don't mark as loaded - let skeleton show first
                playersWithLoadedStats.current.delete(player.Subject);
              }
            });
          }
        }
        
        // Log when match data is received
        if (data.Players && data.Players.length > 0) {
          const allyCount = data.Players.filter(p => p.team === 'Blue' || !p.team).length;
          const enemyCount = data.Players.filter(p => p.team === 'Red').length;
          console.log(`[PLAYER LOADING] Match data received: ${data.Players.length} players (${allyCount} allies, ${enemyCount} enemies) - State: ${data.state || 'UNKNOWN'}`);
        }
        
        // Force update with timestamp to trigger re-render
        // Always update match data to ensure UI reflects latest state (especially for MENUS when players join)
        setMatch({ ...data, _timestamp: Date.now() });
        
        // Force periodic re-renders to check skeleton timeouts
        // This ensures skeletons hide when their timeout expires
        setTimeout(() => {
          setMatch(prev => prev ? { ...prev, _timestamp: Date.now() } : prev);
        }, 1100); // Check after 1.1 seconds (just after skeleton timeout of 1 second)
      });
      
      // Periodic check to clear expired skeletons (forces re-render when timeouts expire)
      const skeletonCheckInterval = setInterval(() => {
        // Force a re-render to check skeleton timeouts
        setMatch(prev => prev ? { ...prev, _timestamp: Date.now() } : prev);
      }, 500); // Check every 500ms
      
      // Load API key immediately and with retry logic to ensure it's always available
      const loadApiKey = async (retries = 10, delay = 500) => {
        for (let i = 0; i < retries; i++) {
          try {
            const apiKey = await window.electronAPI.getApiKey();
            if (apiKey) {
              setHenrikApiKey(apiKey);
              return; // Success, exit retry loop
            } else if (i < retries - 1) {
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.error('Error loading API key after retries:', error);
            }
          }
        }
        // If we get here, all retries failed - but getApiKey() should always return embedded key
        // So this shouldn't happen, but log it just in case
        console.warn('API key loading failed after all retries - using embedded default');
      };
      loadApiKey();

      // Load rank images with retry logic (they might not be ready immediately)
      // Keep trying even if Valorant isn't running - rank images should still be available
      const loadRankImages = async (retries = 10, delay = 1000) => {
        if (!window.electronAPI || !window.electronAPI.getRankImages) {
          console.error('[RANK IMAGES] window.electronAPI.getRankImages is not available!');
          return;
        }
        for (let i = 0; i < retries; i++) {
          try {
            const rankImgs = await window.electronAPI.getRankImages();
            if (rankImgs && typeof rankImgs === 'object' && Object.keys(rankImgs).length > 0) {
              // Convert all keys to numbers to ensure consistent lookup (IPC might serialize keys as strings)
              const normalizedRankImages: Record<number, string> = {};
              for (const key in rankImgs) {
                const numKey = Number(key);
                if (!isNaN(numKey) && rankImgs[key]) {
                  normalizedRankImages[numKey] = rankImgs[key];
                }
              }
              // Rank images loaded successfully
              setRankImages(normalizedRankImages);
              setRankImagesVersion(prev => prev + 1); // Increment version to force image reloads
              // Reset the logged missing tiers set when new images load
              loggedMissingTiers.current.clear();
              loggedEmptyRef.current = false;
              // Force a re-render by updating match timestamp
              setMatch(prev => prev ? { ...prev, _timestamp: Date.now() } : prev);
              return;
            } else {
              if (i === retries - 1) {
                // Only log on last attempt if still failing
                console.warn('[RANK IMAGES] Failed to load rank images or empty result after', retries, 'attempts');
              }
            }
            if (i < retries - 1) {
              // Retrying rank images fetch with longer delay
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            if (i === retries - 1) {
              // Only log on last attempt if still failing
              console.error('[RANK IMAGES] Error loading rank images after', retries, 'attempts:', error);
            }
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        console.warn('[RANK IMAGES] Failed to load rank images after all retries - rank icons will show placeholders');
        // Mark as logged so we don't spam warnings in getRankImage
        loggedEmptyRef.current = true;
      };
      loadRankImages();

      // Load initial config, account, and rank images (only on mount)
      // Use retry logic to ensure account info is loaded even on auto-start
      const loadAccountWithRetry = async (retries = 10, delay = 1000) => {
        for (let i = 0; i < retries; i++) {
          try {
            const account = await window.electronAPI.getLocalAccount();
            if (account) {
              // Update state with account info
              setLocalPlayerName(account.gameName);
              if (account.fullName) {
                setLocalPlayerFullName(account.fullName);
              }
              if (account.puuid) {
                setLocalPlayerPuuid(account.puuid);
              }
              if (account.region) {
                setLocalPlayerRegion(account.region);
              }
              
              // Save to localStorage for use when Valorant is not running
              try {
                const playerInfo = {
                  gameName: account.gameName,
                  fullName: account.fullName || '',
                  puuid: account.puuid || '',
                  region: account.region || '',
                  lastUpdated: Date.now()
                };
                localStorage.setItem('lastPlayerInfo', JSON.stringify(playerInfo));
                // Update savedPlayerInfo state so Overview component gets the new data
                setSavedPlayerInfo(playerInfo);
                return; // Success, exit retry loop
              } catch (error) {
                console.error('Error saving player info to localStorage:', error);
              }
            } else if (i < retries - 1) {
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.error('Error getting local account after retries:', error);
            }
          }
        }
        
        // If account loading failed, ensure saved info is set in state
        if (savedPlayerInfo.gameName || savedPlayerInfo.fullName) {
          // Explicitly set state with saved values to ensure they're used
          if (savedPlayerInfo.gameName) {
            setLocalPlayerName(savedPlayerInfo.gameName);
          }
          if (savedPlayerInfo.fullName) {
            setLocalPlayerFullName(savedPlayerInfo.fullName);
          }
          if (savedPlayerInfo.puuid) {
            setLocalPlayerPuuid(savedPlayerInfo.puuid);
          }
          if (savedPlayerInfo.region) {
            setLocalPlayerRegion(savedPlayerInfo.region);
          }
        }
      };
      
      loadAccountWithRetry();

      // Preload all agent images on startup for instant display
      // Increased retries and delay to ensure service is ready
      const preloadAgentImages = async (retries = 15, initialDelay = 1000, delay = 1000) => {
        // Wait a bit initially to let the service initialize
        await new Promise(resolve => setTimeout(resolve, initialDelay));
        
        for (let i = 0; i < retries; i++) {
          try {
            const agentImgs = await window.electronAPI.getAgentImages();
            if (agentImgs && typeof agentImgs === 'object' && Object.keys(agentImgs).length > 0) {
              // Preload all agent images by creating Image objects
              const imagePromises = Object.values(agentImgs).map(url => {
                return new Promise<void>((resolve) => {
                  if (!url) {
                    resolve();
                    return;
                  }
                  const img = new Image();
                  img.onload = () => resolve();
                  img.onerror = () => resolve(); // Resolve even on error to not block other images
                  img.src = url;
                });
              });
              await Promise.all(imagePromises);
              return; // Success
            }
            // No images yet, wait and retry
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            if (i < retries - 1) {
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              // Only log on last attempt
              console.error(`Error preloading agent images after ${retries} attempts:`, error);
            }
          }
        }
        // If we get here, all retries failed - but this is not critical, images will load on demand
        console.warn('Agent images not available yet - they will load on demand');
      };
      preloadAgentImages();

      window.electronAPI.getConfig().then(config => {
        if (config.selectedGun) setSelectedGun(config.selectedGun);
        // Don't load API key from config here - use getApiKey() instead for security
        // API key is loaded separately above with retry logic
        // Load visibility settings
        if (config.showKD !== undefined) setShowKD(config.showKD);
        if (config.showHS !== undefined) setShowHS(config.showHS);
        if (config.showWR !== undefined) setShowWR(config.showWR);
        if (config.showRR !== undefined) setShowRR(config.showRR);
        if (config.showSkin !== undefined) setShowSkin(config.showSkin);
        if (config.showRank !== undefined) setShowRank(config.showRank);
        if (config.showPeak !== undefined) setShowPeak(config.showPeak);
        if (config.showLevel !== undefined) setShowLevel(config.showLevel);
        if (config.showParty !== undefined) setShowParty(config.showParty);
        if (typeof config.autoStartWithValorant === 'boolean') {
          setAutoStartWithValorant(config.autoStartWithValorant);
        }
        if (typeof config.autoStartWithWindows === 'boolean') {
          setAutoStartWithWindows(config.autoStartWithWindows);
        }
        if (config.showLeaderboard !== undefined) {
          setShowLeaderboard(config.showLeaderboard);
        } else {
          // Save default value if not in config
          const defaultShowLeaderboard = true;
          setShowLeaderboard(defaultShowLeaderboard);
          if (window.electronAPI) {
            window.electronAPI.saveConfig({ showLeaderboard: defaultShowLeaderboard });
          }
        }
        if (config.skinImageSize !== undefined) {
          setSkinImageSize(config.skinImageSize);
        } else {
          // Save default value if not in config
          const defaultSize: 'small' | 'medium' | 'large' = 'medium';
          setSkinImageSize(defaultSize);
          if (window.electronAPI) {
            window.electronAPI.saveConfig({ skinImageSize: defaultSize });
          }
        }
      });

      // Listen for status updates to detect if Valorant is not running
      const cleanupStatus = window.electronAPI.onStatus((data) => {
        if (data.status === 'valorant_not_running') {
          setValorantNotRunning(true);
        } else if (data.status === 'loading' || data.status === 'connected') {
          // Only reset when we get a positive status (loading means we're connected)
          setValorantNotRunning(false);
        }
        // Track game state from status updates
        if (data.state) {
          setCurrentGameState(data.state);
        }
        // Don't reset on 'disconnected' - that's different from not running
      });
      
      const cleanupMatchFound = window.electronAPI.onMatchFound(() => {
        // Match found event - you can add UI updates here
        // For example, show a notification, play a sound, or update the UI
      });
      
      // Set a timeout to show "not running" if we don't receive any status within 3 seconds
      // This handles the case where status events aren't being emitted
      const statusTimeout = setTimeout(() => {
        setValorantNotRunning(prev => {
          // Only set to true if we haven't received any status yet (null)
          if (prev === null) {
            return true;
          }
          return prev;
        });
      }, 3000);

      // Fetch patch version and patch notes data once on launch
      // Wait for service to be ready, then retry if needed
      const fetchPatchVersion = async (maxRetries = 15, delay = 1000) => {
        // Wait a bit initially for service to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const patch = await window.electronAPI.getPatchVersion();
            if (patch) {
              setPatchVersion(patch);
              // Fetch patch image, title, and description when version is available
              // Retry if it fails (might be due to service not ready or API key not loaded)
              for (let i = 0; i < 10; i++) {
              try {
                const patchData = await window.electronAPI.getPatchImage(patch);
                console.log('Patch data received:', patchData ? { hasImage: !!patchData.image, hasTitle: !!patchData.title, hasUrl: !!patchData.url } : 'null');
                if (patchData && (patchData.image || patchData.title)) {
                  setPatchImage(patchData.image);
                  setPatchTitle(patchData.title);
                  setPatchDescription(patchData.description);
                  setPatchUrl(patchData.url);
                  console.log('Patch notes loaded successfully:', patchData.title || 'No title');
                  return; // Success, exit retry loop
                } else {
                  console.log(`Patch data incomplete (attempt ${i + 1}/10):`, patchData);
                  if (i < 9) {
                    // No data yet, wait and retry
                    await new Promise(resolve => setTimeout(resolve, delay));
                  }
                }
              } catch (error) {
                console.error(`Error fetching patch notes (attempt ${i + 1}/10):`, error);
                if (i < 9) {
                  // Wait before retrying
                  await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                  console.error('Error fetching patch notes after all retries:', error);
                }
              }
              }
              // If we got patch version but not patch data, that's okay - we have the version
              return;
            } else if (attempt < maxRetries - 1) {
              // No patch version yet, wait and retry
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.error('Error fetching patch version after retries:', error);
            }
          }
        }
        console.warn('Failed to load patch notes after all retries');
      };
      fetchPatchVersion();

      // Request current match data when window becomes visible (handles auto-start with Windows)
      const handleVisibilityChange = () => {
        if (!document.hidden && window.electronAPI) {
          // Window became visible - request current match data to ensure stats are loaded
          // Small delay to ensure window is fully ready
          setTimeout(() => {
            loadCurrentMatch();
          }, 500);
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // Also check on initial load if window is visible
      if (!document.hidden) {
        // Window is already visible on load - request match data after a short delay
        setTimeout(() => {
          loadCurrentMatch();
        }, 1000);
      }

      return () => {
        cleanupMatch();
        cleanupStatus();
        cleanupMatchFound();
        clearTimeout(statusTimeout);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [selectedGun, loadCurrentMatch]);

  // Reset launching state when Valorant is confirmed running
  useEffect(() => {
    if (launchingValorant && valorantNotRunning === false) {
      // Valorant was launching and is now confirmed running
      setLaunchingValorant(false);
    }
  }, [valorantNotRunning, launchingValorant]);

  // Load match when selectedGun changes
  useEffect(() => {
    // Immediately reload match data when gun changes to update skin images
    // This ensures skin images update instantly when weapon is changed in settings
    if (selectedGun) {
      loadCurrentMatch();
    }
  }, [selectedGun, loadCurrentMatch]);

  // Reset scroll position when selected player changes or when switching to overview tab
  useEffect(() => {
    if (activeTab === 'overview') {
      // Reset scroll position after a brief delay to ensure DOM is updated
      const timer = setTimeout(() => {
        if (overviewContentRef.current) {
          overviewContentRef.current.scrollTop = 0;
        }
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
          mainContent.scrollTop = 0;
        }
        window.scrollTo(0, 0);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedPlayer, activeTab]);

  // Fetch local player's card on app launch (when we have account info and API key)
  // This works even when Valorant is not running if we have saved player info
  useEffect(() => {
    if (localPlayerFullName && localPlayerPuuid && henrikApiKey && !localPlayerCardFetchedRef.current) {
      // Check if we already have the card cached
      const hasCard = playerCardCache[localPlayerPuuid] || playerCardSmallCache[localPlayerPuuid];
      const isFetching = fetchingCards.has(localPlayerPuuid);
      
      if (!hasCard && !isFetching) {
        // Fetching local player card (works even when Valorant is not running)
        localPlayerCardFetchedRef.current = true; // Mark as attempted
        fetchPlayerCard(localPlayerFullName, localPlayerPuuid).catch((err) => {
          console.error(`Error fetching local player card:`, err);
        });
      }
    }
    // Only depend on the values that should trigger a new fetch attempt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPlayerFullName, localPlayerPuuid, henrikApiKey]);

  // Force re-render when rankImages changes to update all rank icons
  useEffect(() => {
    if (rankImages && Object.keys(rankImages).length > 0) {
      // Force a re-render by updating match timestamp when rank images are loaded
      setMatch(prev => prev ? { ...prev, _timestamp: Date.now() } : prev);
    }
  }, [rankImages]);

  const getRankImage = useCallback((tier: number | undefined | null, version?: number) => {
    // Handle invalid tier values (only undefined/null, not 0 - tier 0 is Unranked and has an image)
    if (tier === undefined || tier === null) {
      // Return a properly encoded placeholder SVG
      const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
      return `data:image/svg+xml,${placeholderSvg}`;
    }
    
    // Use API image if available (including tier 0 for Unranked)
    if (rankImages && Object.keys(rankImages).length > 0) {
      // Try number key first (keys should be normalized to numbers)
      let imageUrl = rankImages[tier];
      
      // Debug: log what we're looking for and what we found
      if (!imageUrl) {
        if (!loggedMissingTiers.current.has(tier)) {
          loggedMissingTiers.current.add(tier);
          const availableTiers = Object.keys(rankImages).sort((a, b) => Number(a) - Number(b));
          console.warn(`[RANK IMAGE] Tier ${tier} (type: ${typeof tier}) not found in rankImages. Available tiers:`, availableTiers);
          console.warn(`[RANK IMAGE] rankImages[${tier}]:`, rankImages[tier]);
          console.warn(`[RANK IMAGE] rankImages object keys:`, Object.keys(rankImages).slice(0, 10));
        }
      }
      // Don't log successful lookups - they happen on every render and cause spam
      
      if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '') {
        // Add cache-busting parameter to ensure images reload when rankImages updates
        const separator = imageUrl.includes('?') ? '&' : '?';
        // Use version number for more reliable cache-busting
        const versionToUse = version !== undefined ? version : rankImagesVersion;
        return `${imageUrl}${separator}v=${versionToUse}`;
      }
    } else {
      // Don't log warning - images are still loading, this is expected
      // Only log if images fail to load after a delay (handled in loadRankImages)
    }
    
    // Fallback to placeholder if no API image (properly encoded)
    const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
    return `data:image/svg+xml,${placeholderSvg}`;
  }, [rankImages, rankImagesVersion]);

  const getAgentImage = useCallback((player: Player) => {
      // Use API image URL if available
      if (player.AgentImageUrl) {
        return player.AgentImageUrl;
      }
      // If no API image, return null to trigger placeholder
      return null;
  }, []);


  const fetchPlayerCard = useCallback(async (playerName: string, puuid: string): Promise<string | null> => {
    if (!henrikApiKey) {
      // No API key available for card fetch
      return null;
    }
    
    // Fetching card for player

    // Check if already cached (both wide and small)
    if (playerCardCache[puuid] && playerCardSmallCache[puuid]) {
      return playerCardCache[puuid];
    }

    // Check if already fetching
    if (fetchingCards.has(puuid)) {
      return null;
    }

    try {
      // Parse name and tag from "Name#Tag" format
      const [name, tag] = playerName.split('#');
      if (!name || !tag) {
        // Invalid player name format
        return null;
      }

      // Rate limiting: wait at least 100ms between requests (reduced for faster loading)
      const now = Date.now();
      const timeSinceLastFetch = now - lastFetchTimeRef.current;
      if (timeSinceLastFetch < 100) {
        await new Promise(resolve => setTimeout(resolve, 100 - timeSinceLastFetch));
      }
      lastFetchTimeRef.current = Date.now();

      // Mark as fetching
      setFetchingCards(prev => new Set(prev).add(puuid));

      // Fetch from HenrikDev API
      const apiUrl = `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
      // Fetching from HenrikDev API
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': henrikApiKey
        }
      });
      
      // API response received

      if (response.status === 429) {
        // Rate limited - wait longer before retrying
        // Rate limited by API
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HenrikDev API error for ${playerName} (${response.status}):`, errorText);
        return null;
      }

      const data = await response.json();
      // API response received
      
      // Check if response is successful (status === 1 or status === 200, or just check if data exists)
      if (data.data && data.data.card) {
        // Check if card is an object with small/wide properties or a string
        const card = data.data.card;
        let cardWide: string | null = null;
        let cardSmall: string | null = null;
        
        if (card) {
          if (typeof card === 'object' && card !== null) {
            // Card is an object with small, wide, large properties
            cardWide = card.wide || card.large || null;
            cardSmall = card.small || null;
          } else if (typeof card === 'string') {
            // Card is a string (v2 API format)
            cardWide = card;
            cardSmall = card; // v2 might not have separate small, use same
          }
        }
        
        // Cache both wide and small cards (in memory and localStorage)
        if (cardWide) {
          setPlayerCardCache(prev => {
            if (prev[puuid]) return prev; // Already cached
            const newCache = { ...prev, [puuid]: cardWide! };
            // Persist to localStorage
            try {
              localStorage.setItem('playerCardCache', JSON.stringify(newCache));
            } catch {
              // Ignore localStorage errors (quota exceeded, etc.)
            }
            return newCache;
          });
        }
        
        if (cardSmall) {
          setPlayerCardSmallCache(prev => {
            if (prev[puuid]) return prev; // Already cached
            const newCache = { ...prev, [puuid]: cardSmall! };
            // Persist to localStorage
            try {
              localStorage.setItem('playerCardSmallCache', JSON.stringify(newCache));
            } catch {
              // Ignore localStorage errors (quota exceeded, etc.)
            }
            return newCache;
          });
        }
        
        if (!cardWide && !cardSmall) {
          // No card data in response
        } else {
          // Cards cached successfully
        }
        
        return cardWide || null;
      } else {
        // API response error
      }
    } catch (err) {
      console.error(`Error fetching player card for ${playerName}:`, err);
    } finally {
      // Remove from fetching set
      setFetchingCards(prev => {
        const newSet = new Set(prev);
        newSet.delete(puuid);
        return newSet;
      });
    }

    return null;
  }, [henrikApiKey, playerCardCache, playerCardSmallCache, fetchingCards]);

  // Fetch player cards for all players when match data changes (lobby or pregame)
  // Use a ref to track the last processed match to avoid unnecessary refetches
  const lastProcessedMatchRef = useRef<string>('');
  
  useEffect(() => {
    const isLobbyOrPregame = match?.isLobby || match?.state === 'PREGAME';
    
    // Create a unique key for this match state to avoid reprocessing
    const matchKey = `${match?.state || ''}-${match?.Players?.map(p => p.Subject).join(',') || ''}`;
    
    // Skip if we've already processed this exact match state
    if (matchKey === lastProcessedMatchRef.current) {
      return;
    }
    
    // If we don't have an API key yet, try to reload config
    if (isLobbyOrPregame && match.Players && !henrikApiKey) {
      // No API key, reloading config
      window.electronAPI?.getConfig().then(config => {
        if (config.henrikApiKey) {
          // API key reloaded
          setHenrikApiKey(config.henrikApiKey);
        } else {
          console.error('API key still not found after reload');
        }
      });
      return;
    }
      if (isLobbyOrPregame && match.Players && henrikApiKey) {
      // Fetching cards for players
      const playersToFetch = match.Players.filter(player => 
        (!playerCardCache[player.Subject] || !playerCardSmallCache[player.Subject]) && 
        !fetchingCards.has(player.Subject) &&
        player.Name && player.Name.includes('#')
      );
      
      // Fetching cards
      
      // Fetch cards in parallel batches to speed up loading
      // Process 5 players at a time with minimal delay between batches
      if (playersToFetch.length > 0) {
        const batchSize = 5; // Increased batch size
        const batches: typeof playersToFetch[] = [];
        
        // Split players into batches
        for (let i = 0; i < playersToFetch.length; i += batchSize) {
          batches.push(playersToFetch.slice(i, i + batchSize));
        }
        
        // Process each batch in parallel, with minimal delay between batches
        batches.forEach((batch, batchIndex) => {
          setTimeout(() => {
            // Fetch all cards in this batch in parallel
            batch.forEach((player) => {
              fetchPlayerCard(player.Name, player.Subject).catch((err) => {
                console.error(`Error fetching card for ${player.Name}:`, err);
              });
            });
          }, batchIndex * 150); // Reduced delay: 150ms between batches for faster loading
        });
      }
      
      // Mark this match as processed
      lastProcessedMatchRef.current = matchKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.isLobby, match?.state, match?.Players?.length, henrikApiKey, playerCardCache, playerCardSmallCache, fetchingCards]);

  // Helper function to get party color based on party ID
  const getPartyColor = useCallback((partyId: string | undefined, players: Player[]): string => {
    if (!partyId) return '#4a9eff'; // Default blue
    
    // Get all unique party IDs (from all players, not just isPartyMember)
    const partyIds = Array.from(new Set(
      players
        .filter(p => p.partyId)
        .map(p => p.partyId)
        .filter((id): id is string => id !== undefined)
    ));
    
    // Sort to ensure consistent ordering
    partyIds.sort();
    
    // Find index of this party
    const partyIndex = partyIds.indexOf(partyId);
    
    // Color palette for different parties
    const partyColors = [
      '#4a9eff', // Blue
      '#ff4655', // Red
      '#12cc54', // Green
      '#ffd700', // Gold
      '#9b7fff', // Purple
      '#ff6b9d', // Pink
      '#00d4ff', // Cyan
      '#ff8c00', // Orange
    ];
    
    return partyColors[partyIndex % partyColors.length] || '#4a9eff';
  }, []);

  // Track which players we've seen with loaded stats
  const playersWithLoadedStats = useRef<Set<string>>(new Set());
  // Track when players were first seen (for timeout)
  const playerFirstSeen = useRef<Map<string, number>>(new Map());
  
  // Check if player stats are still loading (no stats yet and rank is unranked)
  const isPlayerStatsLoading = (player: Player): boolean => {
    // Player must exist and have a valid Subject
    if (!player || !player.Subject) return false;
    
    // Skeleton placeholder players (created for missing slots) should always show skeleton
    if (player.Subject.startsWith('skeleton-')) {
      return true;
    }
    
    // Check if player has a name (indicates player data exists)
    const playerHasName = Boolean(player.Name && player.Name !== 'Unknown' && player.Name.trim() !== '');
    
    // If no name, don't show skeleton (player doesn't exist yet)
    if (!playerHasName) return false;
    
    // Track when player was first seen - initialize immediately when they appear
    const isFirstTimeSeeing = !playerFirstSeen.current.has(player.Subject);
    if (isFirstTimeSeeing) {
      playerFirstSeen.current.set(player.Subject, Date.now());
      // When a player first appears, ALWAYS show skeleton initially
      // This ensures skeleton shows before any stats are checked
      return true;
    }
    
    // Check if we've already seen this player with loaded stats
    const hasLoadedStats = playersWithLoadedStats.current.has(player.Subject);
    
    // If we've seen this player with stats before, don't show skeleton
    if (hasLoadedStats) return false;
    
    // Get time since first seen
    const firstSeenTime = playerFirstSeen.current.get(player.Subject) || Date.now();
    const timeSinceFirstSeen = Date.now() - firstSeenTime;
    
    // Show skeleton for at least 300ms (minimum display time) to ensure smooth transition
    // This prevents flickering when stats load very quickly
    const minSkeletonTime = 300;
    if (timeSinceFirstSeen < minSkeletonTime) {
      return true; // Always show skeleton for first 300ms
    }
    
    // Check if stats have been explicitly set (even if 0) - this means they were fetched
    // In valorantService, undefined stats are set to 0, so we need to check more carefully
    // We want to show skeleton until we have meaningful stats (not just 0) OR rank info
    const hasValidStats = (typeof player.kd === 'number' && player.kd > 0) || 
                         (typeof player.headshotPercentage === 'number' && player.headshotPercentage > 0) ||
                         (typeof player.winRate === 'number'); // 0% is valid, only undefined means no data
    // Check for rank - tier 0 is valid (UNRANKED), so check if tier is defined and currenttierpatched exists
    const hasRank = (player.currenttier !== undefined && player.currenttier !== null) && 
                    (player.currenttierpatched !== undefined && player.currenttierpatched !== null && player.currenttierpatched !== '');
    const hasGames = typeof player.numberofgames === 'number' && player.numberofgames > 0;
    
    // In PREGAME, be more strict - require actual stats or rank, not just undefined values set to 0
    const isPregame = match?.state === 'PREGAME';
    if (isPregame) {
      // Check if stats were actually fetched (even if they're 0/N/A)
      const statsWereFetched = player.statsFetched === true;
      
      // In PREGAME, show skeleton until we have:
      // 1. Rank info AND stats were fetched (even if stats are 0/N/A), OR
      // 2. Valid non-zero stats
      // This ensures we wait for stats API to complete before hiding skeleton
      if (hasRank && statsWereFetched) {
        // Rank loaded AND stats were fetched (even if 0/N/A) - safe to hide skeleton
        if (!playersWithLoadedStats.current.has(player.Subject)) {
          console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (PREGAME) - Rank: ${player.currenttierpatched || 'N/A'}, Stats: ${statsWereFetched ? 'fetched' : 'not fetched'}`);
        }
        playersWithLoadedStats.current.add(player.Subject);
        return false;
      }
      if (hasValidStats || hasGames) {
        // Valid stats or games - safe to hide skeleton
        if (!playersWithLoadedStats.current.has(player.Subject)) {
          console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (PREGAME) - Has valid stats`);
        }
        playersWithLoadedStats.current.add(player.Subject);
        return false;
      }
      
      // Still loading in PREGAME - show skeleton
      // Wait for both rank AND stats to load before hiding
      return true;
    }
    
    // For INGAME, be more strict - don't hide skeleton if stats are all 0/undefined
    // Only hide skeleton if we have rank OR valid non-zero stats
    const isIngame = match?.state === 'INGAME';
    if (isIngame) {
      // Check if stats were actually fetched (even if they're 0/N/A)
      // This helps distinguish between "stats not loaded yet" vs "stats loaded but are 0/N/A"
      const statsWereFetched = player.statsFetched === true;
      
      // Check if player has a meaningful rank (ranked, not just unranked/0)
      // Use effective rank for local player (may come from Henrik Dev API if unranked)
      const playerNameForCheck = player.Name || '';
      const isLocalForCheck = localPlayerName && (playerNameForCheck === localPlayerName || playerNameForCheck.startsWith(localPlayerName + '#'));
      const isLocalByPuuidForCheck = localPlayerPuuid && player.Subject === localPlayerPuuid;
      const isLocalPlayerForCheck = isLocalForCheck || isLocalByPuuidForCheck;
      const effectiveRankForCheck = isLocalPlayerForCheck && player.currenttier === 0 && localPlayerRankFromAPI?.currenttier 
        ? localPlayerRankFromAPI.currenttier 
        : player.currenttier;
      const hasRanked = hasRank && effectiveRankForCheck > 0;
      const isUnranked = hasRank && effectiveRankForCheck === 0;
      
      // If player is ranked (tier > 0), we can hide skeleton immediately
      // If player has valid stats or games, hide skeleton
      if (hasRanked || hasValidStats || hasGames) {
        if (!playersWithLoadedStats.current.has(player.Subject)) {
          const playerType = player.team === 'Red' ? 'Enemy' : 'Ally';
          console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (INGAME - ${playerType}) - Rank: ${player.currenttierpatched || 'N/A'}, KD: ${player.kd || 0}, HS%: ${player.headshotPercentage || 0}%`);
        }
        playersWithLoadedStats.current.add(player.Subject);
        return false;
      }
      
      // For unranked players, wait for stats to actually load before hiding skeleton
      // This prevents hiding skeleton too early when stats are still fetching
      if (isUnranked) {
        // If stats were fetched (even if 0/N/A), we can hide skeleton
        // This means the API call completed, even if player has no match history
        if (statsWereFetched) {
          if (!playersWithLoadedStats.current.has(player.Subject)) {
            const playerType = player.team === 'Red' ? 'Enemy' : 'Ally';
            const hasCompStats = player.hasCompetitiveStats === false ? 'No comp stats' : 'Has comp stats';
            console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (INGAME - ${playerType}, Unranked) - ${hasCompStats}, Stats fetched: ${statsWereFetched}`);
          }
          playersWithLoadedStats.current.add(player.Subject);
          return false;
        }
        
        // Stats haven't been fetched yet - wait longer (up to 10 seconds) for unranked players
        // This gives more time for the stats API call to complete
        if (timeSinceFirstSeen > 10000) {
          // After 10 seconds, hide skeleton even if stats weren't fetched
          // This prevents infinite skeletons if API is failing
          playersWithLoadedStats.current.add(player.Subject);
          return false;
        }
        // Still waiting for stats to load for unranked player
        return true;
      }
      
      // No rank info yet - wait for it to load
      // In INGAME, wait longer for stats to load (up to 8 seconds) before giving up
      // This prevents showing blank stats when API calls are slow, especially for enemies
      if (timeSinceFirstSeen > 8000) {
        // After 8 seconds, hide skeleton even if stats aren't loaded (to prevent stuck skeletons)
        if (!playersWithLoadedStats.current.has(player.Subject)) {
          const playerType = player.team === 'Red' ? 'Enemy' : 'Ally';
          console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (INGAME - ${playerType}) - Timeout reached, showing data`);
        }
        playersWithLoadedStats.current.add(player.Subject);
        return false;
      }
      // Still loading in INGAME - show skeleton
      return true;
    }
    
    // For MENUS state, similar logic to PREGAME
    const isMenus = match?.state === 'MENUS';
    if (isMenus) {
      const statsWereFetched = player.statsFetched === true;
      
      // In MENUS, show skeleton until we have rank info AND stats were fetched
      if (hasRank && statsWereFetched) {
        // Rank loaded AND stats were fetched (even if 0/N/A) - safe to hide skeleton
        if (!playersWithLoadedStats.current.has(player.Subject)) {
          console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (MENUS) - Rank: ${player.currenttierpatched || 'N/A'}, Stats: ${statsWereFetched ? 'fetched' : 'not fetched'}`);
        }
        playersWithLoadedStats.current.add(player.Subject);
        return false;
      }
      if (hasValidStats || hasGames) {
        // Valid stats or games - safe to hide skeleton
        if (!playersWithLoadedStats.current.has(player.Subject)) {
          console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (MENUS) - Has valid stats`);
        }
        playersWithLoadedStats.current.add(player.Subject);
        return false;
      }
      
      // Still loading in MENUS - show skeleton
      return true;
    }
    
    // For MENUS (lobby), be more lenient - any data is fine
    const hasStats = (player.kd !== undefined) || 
                    (player.headshotPercentage !== undefined) || 
                    (player.winRate !== undefined);
    
    // If we have any data, consider it loaded (after minimum time)
    if (hasStats || hasRank || hasGames) {
      if (!playersWithLoadedStats.current.has(player.Subject)) {
        const statsWereFetched = player.statsFetched === true;
        console.log(`[PLAYER LOADING] ${player.Name || 'Unknown'} loaded (MENUS) - Rank: ${player.currenttierpatched || 'N/A'}, Stats: ${statsWereFetched ? 'fetched' : 'not fetched'}, KD: ${player.kd || 0}`);
      }
      playersWithLoadedStats.current.add(player.Subject);
      return false;
    }
    
    // Still loading - show skeleton
    // This will show skeleton for new players until stats load or timeout
    return true;
  };

  const renderPlayerSkeleton = (player: Player) => {
    if (!player || !player.Subject) return null;
    
    const playerName = player.Name || '';
    const isLocal = localPlayerName && (playerName === localPlayerName || playerName.startsWith(localPlayerName + '#'));
    
    return (
      <div key={player.Subject} className={`player-row-live-stats skeleton-loading ${isLocal ? 'local-player' : ''}`}>
        <div className="skeleton-avatar"></div>
        <div className="player-name-live-stats">
          <div className="skeleton-name"></div>
        </div>
        {match?.state === 'INGAME' && showSkin && (
          <div className="player-skin-live-stats">
            <div className="skeleton-rank-icon" style={{ width: '40px', height: '40px' }}></div>
          </div>
        )}
        <div className="player-stats-group-live-stats">
          <div className="player-percentages-live-stats">
            {showKD && (
              <div className="percentage-item">
                <span className="percentage-label">KD</span>
                <span className="skeleton-stat"></span>
              </div>
            )}
            {showHS && (
              <div className="percentage-item">
                <span className="percentage-label">HS%</span>
                <span className="skeleton-stat"></span>
              </div>
            )}
            {showWR && (
              <div className="percentage-item">
                <span className="percentage-label">WR%</span>
                <span className="skeleton-stat"></span>
              </div>
            )}
            {showRR && (
              <div className="percentage-item">
                <span className="percentage-label">ΔRR</span>
                <span className="skeleton-stat"></span>
              </div>
            )}
          </div>
          {showRank && (
            <div className="player-ranks-live-stats">
              <div className="rank-badge-live-stats">
                <div className="rank-icon-wrapper-live-stats">
                  <div className="skeleton-rank-icon"></div>
                </div>
                <div className="rank-info-live-stats">
                  <span className="skeleton-rank-name"></span>
                  <span className="skeleton-rank-rr"></span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderPlayerLiveStats = (player: Player) => {
    // Add null checks to prevent crashes
    if (!player || !player.Subject) {
      // Invalid player data
      return null;
    }
    
    const playerName = player.Name || '';
    const isLocal = localPlayerName && (playerName === localPlayerName || playerName.startsWith(localPlayerName + '#'));
    // Also check by PUUID for more reliable local player detection
    const isLocalByPuuid = localPlayerPuuid && player.Subject === localPlayerPuuid;
    const isLocalPlayer = isLocal || isLocalByPuuid;
    
    // Use Henrik Dev API rank data if local player is unranked (tier 0) but API has rank data
    const effectiveRank = isLocalPlayer && player.currenttier === 0 && localPlayerRankFromAPI?.currenttier 
      ? localPlayerRankFromAPI.currenttier 
      : player.currenttier;
    const effectiveRankPatched = isLocalPlayer && player.currenttier === 0 && localPlayerRankFromAPI?.currenttierpatched 
      ? localPlayerRankFromAPI.currenttierpatched 
      : player.currenttierpatched;
    const effectiveRankingInTier = isLocalPlayer && player.currenttier === 0 && localPlayerRankFromAPI?.rankingInTier !== undefined
      ? localPlayerRankFromAPI.rankingInTier
      : player.rankingInTier;
    // Win rate is now fetched in the backend, so we can use it directly from player data
    const effectiveWinRate = player.winRate;
    
    // ALWAYS check if skeleton should show first - this ensures skeleton appears immediately
    // Check skeleton loading BEFORE any other rendering logic
    // Create a player object with effective rank for the loading check
    const playerWithEffectiveRank = { ...player, currenttier: effectiveRank, currenttierpatched: effectiveRankPatched, rankingInTier: effectiveRankingInTier };
    if (isPlayerStatsLoading(playerWithEffectiveRank)) {
      return renderPlayerSkeleton(player);
    }
    
    // Check if player should be clickable (not local player AND has competitive stats)
    const isPregameIngameOrMenus = match?.state === 'PREGAME' || match?.state === 'INGAME' || match?.state === 'MENUS';
    const hasNoCompetitiveStats = isPregameIngameOrMenus && player.hasCompetitiveStats === false;
    const isClickable = !isLocalPlayer && !hasNoCompetitiveStats;
    
    const cachedCardUrl = playerCardCache[player.Subject];
    const cachedCardSmall = playerCardSmallCache[player.Subject];
    const isPartyMember = player.isPartyMember || false;
    const isLobbyOrPregame = match?.isLobby || match?.state === 'PREGAME';
    const isInGame = match?.state === 'INGAME';
    const isIncognito = player.PlayerIdentity?.Incognito || false;
    // Use relative path since vite.config.ts has base: './'
    // This matches how other assets are loaded (like Standard.png in SkinDisplay uses /assets/guns/...)
    // But for Electron compatibility, try both absolute and relative paths
    const defaultImage = './assets/default.png';
    const placeholder = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#2a3441"/></svg>';
    
    // Use card.small from HenrikDev API when in menus (lobby/pregame), otherwise use cached wide card or agent image from API
    // For incognito users: in pregame/lobby show default.png, in-game show agent image
    let imageSrc: string;
    if (isLobbyOrPregame) {
      // In PREGAME: show default.png if no agent or not locked, normal agent image only when locked
      if (match?.state === 'PREGAME') {
        const characterSelectionState = player.characterSelectionState || '';
        const hasAgent = player.CharacterID && player.CharacterID.trim() !== '';
        const agentImg = getAgentImage(player);
        
        if (characterSelectionState === 'locked' && hasAgent) {
          // Agent locked: use normal agent image
          imageSrc = agentImg || defaultImage;
        } else {
          // No agent selected or not locked: use default.png (no hover effect)
          imageSrc = defaultImage;
        }
      } else {
        // In lobby/menus: Use small card from HenrikDev API cache
        // For incognito users, use default.png instead of their card
        if (isIncognito && !isPartyMember) {
          imageSrc = defaultImage;
          // Using default.png for incognito
        } else if (cachedCardSmall) {
          imageSrc = cachedCardSmall;
          // Using small card
        } else if (cachedCardUrl) {
          // Fallback to wide card if small isn't available yet
          imageSrc = cachedCardUrl;
          // Using wide card
        } else {
          // Fallback to agent image from API
          const agentImg = getAgentImage(player);
          imageSrc = agentImg || placeholder;
          // Using agent image or placeholder
        }
      }
    } else if (isInGame) {
      // In game: always show agent images for all players
      const agentImg = getAgentImage(player);
      imageSrc = agentImg || placeholder;
    } else {
      // Fallback for any other state
      if (isIncognito && !isPartyMember) {
        imageSrc = defaultImage;
        // Using default.png
      } else {
        const agentImg = getAgentImage(player);
        imageSrc = cachedCardUrl || agentImg || placeholder;
      }
    }

    // Check if player has a skin
    // Debug: log skin data
    if (player.skinData) {
      // Player skin data available
    }

    return (
      <div 
        key={player.Subject} 
        className={`player-row-live-stats ${isLocalPlayer ? 'local-player' : ''} ${!isClickable ? 'not-clickable' : ''}`}
        onClick={isClickable ? () => {
          setSelectedPlayer(player);
          setActiveTab('overview');
          // Reset scroll position when switching to player profile
          setTimeout(() => {
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
              mainContent.scrollTop = 0;
            }
            window.scrollTo(0, 0);
          }, 0);
        } : undefined}
        style={{ cursor: isClickable ? 'pointer' : 'default' }}
      >
        <img
          key={`${player.Subject}-${imageSrc}-${isInGame ? 'ingame' : 'other'}-${isPartyMember ? 'party' : 'nonparty'}`}
          src={imageSrc}
          alt={player.AgentName || 'Unknown'}
          className="player-avatar-live-stats"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            // Prevent infinite loop by checking if we've already tried this source
            const currentSrc = img.src;
            const placeholder = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#2a3441"/></svg>';
            
            // If default.png fails, fallback to placeholder
            if (currentSrc.includes('default.png')) {
              img.src = placeholder;
              return;
            }
            
            if (match?.isLobby) {
              // If small card fails, try wide card, then agent image from API
              // But if incognito, we should have used default.png already
              if (isIncognito && !isPartyMember) {
                img.src = defaultImage;
              } else if (cachedCardSmall && currentSrc === cachedCardSmall && cachedCardUrl) {
                img.src = cachedCardUrl;
              } else if (cachedCardUrl && currentSrc === cachedCardUrl) {
                const agentImg = getAgentImage(player);
                img.src = agentImg || placeholder;
              } else if (!cachedCardSmall && !cachedCardUrl) {
                const agentImg = getAgentImage(player);
                img.src = agentImg || placeholder;
              } else {
                // Final fallback - use a placeholder to prevent infinite errors
                img.src = placeholder;
              }
            } else if (isInGame) {
              // In-game: always show agent images for all players
              const agentImg = getAgentImage(player);
              if (agentImg && currentSrc !== agentImg) {
                img.src = agentImg;
              } else if (currentSrc.includes('media.valorant-api.com')) {
                // Agent image from API failed, use placeholder
                img.src = placeholder;
              } else {
                // Final fallback
                img.src = placeholder;
              }
            } else {
              // Pregame or other states: if incognito, use default.png, otherwise try agent image from API
              if (isIncognito && !isPartyMember) {
                img.src = defaultImage;
              } else if (cachedCardUrl && currentSrc === cachedCardUrl) {
                const agentImg = getAgentImage(player);
                img.src = agentImg || placeholder;
              } else {
                // Final fallback
                img.src = placeholder;
              }
            }
          }}
        />
        <div className="player-name-live-stats" title={playerName || player.Subject}>
          {playerName || (player.Subject ? player.Subject.substring(0, 8) + '...' : 'Unknown')}
          {(() => {
            if (!showParty) return null;
            if (match?.state !== 'PREGAME' && match?.state !== 'INGAME') return null;
            if (!player.partyId) return null;
            
            // Count ALL players with the same partyId (not just isPartyMember)
            const partyMembers = match?.Players?.filter(p => p.partyId === player.partyId && p.partyId) || [];
            const hasMultiplePartyMembers = partyMembers.length > 1;
            
            // Only show party icon if there are 2+ people in the party
            if (!hasMultiplePartyMembers) {
              return null;
            }
            
            return (
              <span 
                className="party-member-badge" 
                title={`Party Member (${partyMembers.length} members)`}
                style={{ 
                  color: getPartyColor(player.partyId, match?.Players || [])
                }}
              >
                <UsersRound size={12} />
              </span>
            );
          })()}
        </div>
        {match?.state === 'INGAME' && showSkin && (
          <div className="player-skin-live-stats">
            {player.skinData?.skinName && player.skinData.skinName.trim() !== '' ? (
              <SkinDisplay 
                key={`${player.Subject}-${selectedGun}-${player.skinData.skinImageUrl || player.skinData.skinName}`} 
                skinData={player.skinData} 
                gun={selectedGun}
                size={skinImageSize}
              />
            ) : (
              <div className="no-skin-badge">No skin</div>
            )}
          </div>
        )}
        <div className="player-stats-group-live-stats">
          {/* Check if player has competitive stats (for PREGAME/INGAME/MENUS) */}
          {(() => {
            const isPregameIngameOrMenus = match?.state === 'PREGAME' || match?.state === 'INGAME' || match?.state === 'MENUS';
            const hasNoCompetitiveStats = isPregameIngameOrMenus && player.hasCompetitiveStats === false;
            
            if (hasNoCompetitiveStats) {
              return (
                <div className="no-competitive-stats-message" style={{
                  color: '#8b9cb6',
                  fontSize: '0.75rem',
                  fontStyle: 'italic',
                  padding: '0.5rem 1rem',
                  textAlign: 'center',
                  whiteSpace: 'nowrap'
                }}>
                  This user has no competitive stats.
                </div>
              );
            }
            
            return (
              <>
                <div className="player-percentages-live-stats">
                  {showKD && (
                    <div className="percentage-item">
                      <span className="percentage-label">KD</span>
                      <span className="percentage-value">
                        {typeof player.kd === 'number' && player.kd > 0 ? player.kd.toFixed(2) : '—'}
                      </span>
                    </div>
                  )}
                  {showHS && (
                    <div className="percentage-item">
                      <span className="percentage-label">HS%</span>
                      <span className="percentage-value">
                        {typeof player.headshotPercentage === 'number' && player.headshotPercentage > 0 
                          ? `${player.headshotPercentage.toFixed(1)}%` 
                          : '—'}
                      </span>
                    </div>
                  )}
                  {showWR && (
                    <div className="percentage-item">
                      <span className="percentage-label">WR%</span>
                      <span className="percentage-value">
                        {typeof effectiveWinRate === 'number' 
                          ? `${effectiveWinRate.toFixed(1)}%` 
                          : '—'}
                      </span>
                    </div>
                  )}
                  {showRR && (
                    <div className="percentage-item">
                      <span className="percentage-label">ΔRR</span>
                      <span className="percentage-value" style={{ color: typeof player.RankedRatingEarned === 'number' && player.RankedRatingEarned > 0 ? '#12cc54' : typeof player.RankedRatingEarned === 'number' && player.RankedRatingEarned < 0 ? '#ff4655' : '#8b9cb6' }}>
                        {typeof player.RankedRatingEarned === 'number' && player.RankedRatingEarned !== 0
                          ? `${player.RankedRatingEarned > 0 ? '+' : ''}${player.RankedRatingEarned}`
                          : (typeof player.RankedRatingEarned === 'string' && player.RankedRatingEarned === 'N/A') || player.RankedRatingEarned === undefined
                          ? 'N/A'
                          : '0'}
                      </span>
                    </div>
                  )}
                </div>
                {showRank && (
            <div className="player-ranks-live-stats">
              <div className="rank-badge-live-stats">
                <div className="rank-icon-wrapper-live-stats">
                  <svg className="rank-progress-ring-live-stats" viewBox="0 0 36 36">
                    <circle
                      className="rank-progress-ring-bg-live-stats"
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="#2a3441"
                      strokeWidth="2"
                    />
                    <circle
                      className="rank-progress-ring-fill-live-stats"
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="#ff4655"
                      strokeWidth="2"
                      strokeDasharray={`${((effectiveRankingInTier || 0) / 100) * 100.53} 100.53`}
                      strokeDashoffset="0"
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                  <img
                    key={`rank-${player.Subject}-${effectiveRank}-v${rankImagesVersion}-${rankImages[effectiveRank] ? 'has' : 'no'}`}
                    src={(() => {
                      const tier = effectiveRank;
                      // Only return placeholder if tier is truly invalid (undefined/null)
                      // Tier 0 (Unranked) is valid and should have an image
                      if (tier === undefined || tier === null) {
                        const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
                        return `data:image/svg+xml,${placeholderSvg}`;
                      }
                      // Try to get image from rankImages (including tier 0 for Unranked)
                      if (rankImages && rankImages[tier]) {
                        const imageUrl = rankImages[tier];
                        const separator = imageUrl.includes('?') ? '&' : '?';
                        return `${imageUrl}${separator}v=${rankImagesVersion}`;
                      }
                      // Fallback to placeholder only if tier is valid but image not found
                      const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
                      return `data:image/svg+xml,${placeholderSvg}`;
                    })()}
                    alt={effectiveRankPatched || 'Rank'}
                    className="rank-icon-live-stats"
                    style={{ display: 'block' }}
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      // Only log error if it's not already a placeholder (to avoid spam)
                      if (!img.src.includes('data:image/svg+xml')) {
                        console.warn(`[RANK ICON ERROR] Failed to load rank image for tier ${effectiveRank}. Original src:`, img.src);
                        // Set properly encoded placeholder
                        const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
                        img.src = `data:image/svg+xml,${placeholderSvg}`;
                      }
                    }}
                    onLoad={() => {
                      // Image loaded successfully
                    }}
                  />
                </div>
                <div className="rank-info-live-stats">
                  <span className="rank-name-live-stats">{effectiveRankPatched || (effectiveRank === 0 ? 'Unranked' : '')}</span>
                  <span className="rank-rr-live-stats">{effectiveRankingInTier || 0} RR</span>
                </div>
              </div>
              {showPeak && (
                <div className="peak-rank-badge-live-stats">
                  <img
                    key={`peak-rank-${player.Subject}-${player.peakrankTier}-v${rankImagesVersion}-${rankImages[player.peakrankTier] ? 'has' : 'no'}`}
                    src={(() => {
                      const tier = player.peakrankTier;
                      // Only return placeholder if tier is truly invalid (undefined/null)
                      // Tier 0 (Unranked) is valid and should have an image
                      if (tier === undefined || tier === null) {
                        const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
                        return `data:image/svg+xml,${placeholderSvg}`;
                      }
                      // Try to get image from rankImages (including tier 0 for Unranked)
                      if (rankImages && rankImages[tier]) {
                        const imageUrl = rankImages[tier];
                        const separator = imageUrl.includes('?') ? '&' : '?';
                        return `${imageUrl}${separator}v=${rankImagesVersion}`;
                      }
                      // Fallback to placeholder only if tier is valid but image not found
                      const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
                      return `data:image/svg+xml,${placeholderSvg}`;
                    })()}
                    alt={player.peakrank}
                    className="rank-icon-live-stats"
                    style={{ display: 'block' }}
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      // Only log error if it's not already a placeholder (to avoid spam)
                      if (!img.src.includes('data:image/svg+xml')) {
                        console.warn(`[RANK ICON ERROR] Failed to load peak rank image for tier ${player.peakrankTier}. Original src:`, img.src);
                        // Set properly encoded placeholder
                        const placeholderSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2a3441"/></svg>');
                        img.src = `data:image/svg+xml,${placeholderSvg}`;
                      }
                    }}
                    onLoad={() => {
                      // Image loaded successfully
                    }}
                  />
                  <div className="peak-rank-info-live-stats">
                    <span className="peak-label-live-stats">PEAK</span>
                    <span className="peak-rank-name-live-stats">{player.peakrank}</span>
                  </div>
                </div>
              )}
            </div>
          )}
              </>
            );
          })()}
          {showLeaderboard && effectiveRank >= 20 && (player.leaderboard ?? 0) > 0 && (
            <div className="player-leaderboard-live-stats">
              <div className="leaderboard-badge-live-stats">
                <span className="leaderboard-label-live-stats">#</span>
                <span className="leaderboard-value-live-stats">{(player.leaderboard ?? 0).toLocaleString()}</span>
              </div>
            </div>
          )}
          {showLevel && (
            <div className="player-level-live-stats">
              {player.PlayerIdentity?.LevelBorderUrl ? (
                <div className="level-border-container">
                  <img 
                    src={player.PlayerIdentity.LevelBorderUrl} 
                    alt="Level border" 
                    className="level-border-image"
                  />
                  <span className="level-number-overlay">{player.PlayerIdentity?.AccountLevel || 0}</span>
                </div>
              ) : (
                <>
                  <span className="level-label">LVL</span>
                  <span className="level-value">{player.PlayerIdentity?.AccountLevel || 0}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };



  // Get user profile image - always use card, never agent
  // Try to find the local player's card (wide or small)
  // First check using stored PUUID (for app launch), then fallback to match data
  const userProfileImage = useMemo(() => {
    // If Valorant is not running, try to use saved player card from cache
    if (valorantNotRunning) {
      // Try to get card from cache using saved PUUID
      if (localPlayerPuuid) {
        const cardUrl = playerCardSmallCache[localPlayerPuuid] || playerCardCache[localPlayerPuuid];
        if (cardUrl) {
          return cardUrl;
        }
      }
      // Fallback to default.png if no card found
      return './assets/default.png';
    }
    
    // First, try to get card using stored local player PUUID (works on app launch)
    if (localPlayerPuuid) {
      const cardUrl = playerCardSmallCache[localPlayerPuuid] || playerCardCache[localPlayerPuuid];
      if (cardUrl) return cardUrl;
    }
    
    // Fallback: try to find local player in match data
    if (localPlayerName && match?.Players) {
      const localPlayer = match.Players.find(p => 
        p.Name === localPlayerName || p.Name.startsWith(localPlayerName + '#')
      );
      if (localPlayer) {
        // Always prefer card over agent - use small card if available, otherwise wide card
        const cardUrl = playerCardSmallCache[localPlayer.Subject] || playerCardCache[localPlayer.Subject];
        return cardUrl || null; // Return null if no card yet, but never return agent image
      }
    }
    
    return null; // No card available yet
  }, [valorantNotRunning, localPlayerName, localPlayerPuuid, match?.Players, playerCardCache, playerCardSmallCache]);

  return (
    <div className="live-match">
      <div className="window-title-bar">
        <div className="window-controls">
          <button 
            className="window-control-btn minimize-btn" 
            onClick={() => window.electronAPI?.minimizeWindow()}
            title="Minimize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="0" y="5" width="12" height="2" fill="currentColor"/>
            </svg>
          </button>
          <button 
            className="window-control-btn close-btn" 
            onClick={() => window.electronAPI?.closeWindow()}
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      
      <div className="app-layout">
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="user-profile">
            <div className="user-avatar-wrapper">
              <img
                src={userProfileImage || './assets/default.png'}
                alt="Profile"
                className="user-avatar"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.src = './assets/default.png';
                }}
              />
            </div>
            {!sidebarCollapsed && (
              <div className="user-info">
                <div className="user-name">
                  {localPlayerFullName || localPlayerName || 
                   (savedPlayerInfo.fullName || savedPlayerInfo.gameName) || 
                   'Player'}
                </div>
              </div>
            )}
            <button 
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <path d="M12 6L8 10L12 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <nav className="sidebar-nav">
            <button
              className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <div className="nav-icon">
                <LayoutDashboard size={20} />
              </div>
              <span className="nav-label">Overview</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'live-match' ? 'active' : ''}`}
              onClick={() => setActiveTab('live-match')}
            >
              <div className="nav-icon">
                <Users size={20} />
              </div>
              <span className="nav-label">Live Match</span>
            </button>
            <button
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <div className="nav-icon">
                <SettingsIcon size={20} />
              </div>
              <span className="nav-label">Settings</span>
            </button>
          </nav>

          <div className="sidebar-patch-notes">
            {patchImage && (
              <img 
                src={patchImage} 
                alt={`Patch ${patchVersion}`}
                className="patch-notes-image"
                onError={(e) => {
                  // Hide image if it fails to load
                  const img = e.target as HTMLImageElement;
                  img.style.display = 'none';
                }}
              />
            )}
            <div className="patch-notes-content">
              <div className="patch-notes-title">
                {patchTitle || `PATCH : ${patchVersion}`}
              </div>
              {patchDescription && (
                <div className="patch-notes-description">{patchDescription}</div>
              )}
              <button 
                className="patch-notes-link"
                onClick={() => {
                  const url = patchUrl || `https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-${patchVersion.replace(/\./g, '-')}/`;
                  window.electronAPI?.openExternalUrl(url);
                }}
              >
                Learn More
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4l4 4-4 4"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="main-content">
          {activeTab === 'live-match' && (
            <>
              {valorantNotRunning === true ? (
                <div className="valorant-not-running">
                  <svg className="valorant-not-running-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <h2 className="valorant-not-running-title">Valorant is not running</h2>
                  <p className="valorant-not-running-message">
                    Please make sure Valorant is open and running, then the app will automatically reconnect.
                  </p>
                  <button 
                    className="launch-valorant-button"
                    disabled={launchingValorant}
                    onClick={async () => {
                      setLaunchingValorant(true);
                      try {
                        if (window.electronAPI) {
                          const result = await window.electronAPI.launchValorant();
                          if (!result.success) {
                            console.error('Failed to launch Valorant:', result.error);
                            // If launch failed, reset immediately
                            setLaunchingValorant(false);
                            return;
                          }
                          // Launch succeeded - keep button disabled until Valorant is detected running
                          // The useEffect below will handle resetting when valorantNotRunning becomes false
                        }
                      } catch (error) {
                        console.error('Error launching Valorant:', error);
                        // On error, reset immediately
                        setLaunchingValorant(false);
                      }
                      // Fallback timeout: if Valorant doesn't start within 30 seconds, reset button
                      setTimeout(() => {
                        setLaunchingValorant(false);
                      }, 30000);
                    }}
                  >
                    {launchingValorant ? 'Launching...' : 'Launch Valorant'}
                  </button>
                </div>
              ) : (
                <>
                  <div 
                    className={`content-header ${(match?.state === 'PREGAME' || match?.state === 'INGAME') && match?.map && match?.map !== 'Unknown' && match?.mapImageUrl ? 'has-map-background' : ''}`}
                    style={(match?.state === 'PREGAME' || match?.state === 'INGAME') && match?.map && match?.map !== 'Unknown' && match?.mapImageUrl ? {
                      backgroundImage: `url(${match.mapImageUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    } : undefined}
                  >
                    <div className="content-header-overlay"></div>
                    <div className="content-header-content">
                      {match?.isLobby ? (
                        <div className="lobby-header">
                          <div className="lobby-header-main">
                            <svg className="lobby-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                              <circle cx="9" cy="7" r="4"></circle>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <div className="lobby-header-text">
                              <h2 className="lobby-title">Lobby</h2>
                              {match.Players && match.Players.length > 0 && (
                                <p className="lobby-subtitle">{match.Players.length} {match.Players.length === 1 ? 'Player' : 'Players'}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : match ? (
                        <>
                          {match.map && match.map !== 'Unknown' && match.mode && match.mode !== 'Unknown' ? (
                            <>
                              <h2 className="map-title">{match.map}</h2>
                              <p className="game-mode-text">{match.mode}</p>
                            </>
                          ) : (
                            <div className="map-skeleton">
                              <div className="skeleton-map-title"></div>
                              <div className="skeleton-mode-text"></div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="map-skeleton">
                          <div className="skeleton-map-title"></div>
                          <div className="skeleton-mode-text"></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {error && <div className="error-message">{error}</div>}
                </>
              )}
            </>
          )}

          {activeTab === 'settings' && (
            <Settings
              henrikApiKey={henrikApiKey}
              setHenrikApiKey={setHenrikApiKey}
              selectedGun={selectedGun}
              setSelectedGun={setSelectedGun}
              showKD={showKD}
              setShowKD={setShowKD}
              showHS={showHS}
              setShowHS={setShowHS}
              showWR={showWR}
              setShowWR={setShowWR}
              showRR={showRR}
              setShowRR={setShowRR}
              showSkin={showSkin}
              setShowSkin={setShowSkin}
              showRank={showRank}
              setShowRank={setShowRank}
              showPeak={showPeak}
              setShowPeak={setShowPeak}
              showLevel={showLevel}
              setShowLevel={setShowLevel}
              showParty={showParty}
              setShowParty={setShowParty}
              showLeaderboard={showLeaderboard}
              setShowLeaderboard={setShowLeaderboard}
              skinImageSize={skinImageSize}
              setSkinImageSize={setSkinImageSize}
              autoStartWithValorant={autoStartWithValorant}
              setAutoStartWithValorant={setAutoStartWithValorant}
              autoStartWithWindows={autoStartWithWindows}
              setAutoStartWithWindows={setAutoStartWithWindows}
            />
          )}

          {activeTab === 'overview' && (
            <div className="overview-content" ref={overviewContentRef}>
              {selectedPlayer ? (
                <>
                  <div style={{ 
                    marginBottom: '1.5rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '1rem',
                    width: '100%',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    flexShrink: 0,
                    overflow: 'hidden',
                    padding: '0 1rem'
                  }}>
                    <button
                      onClick={() => {
                        setSelectedPlayer(null);
                        // Reset scroll position when going back
                        setTimeout(() => {
                          const mainContent = document.querySelector('.main-content');
                          if (mainContent) {
                            mainContent.scrollTop = 0;
                          }
                          window.scrollTo(0, 0);
                        }, 0);
                      }}
                      style={{
                        background: '#0f1317',
                        border: '1px solid rgba(42, 52, 65, 0.5)',
                        borderRadius: '6px',
                        padding: '0.5rem 1rem',
                        color: '#ece8e1',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#1a2332';
                        e.currentTarget.style.borderColor = 'rgba(255, 70, 85, 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#0f1317';
                        e.currentTarget.style.borderColor = 'rgba(42, 52, 65, 0.5)';
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                      </svg>
                      Back to Your Profile
                    </button>
                    <h2 style={{ 
                      fontFamily: "'Tungsten', sans-serif",
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      color: '#ece8e1',
                      margin: 0,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {selectedPlayer.Name || 'Player Profile'}
                    </h2>
                  </div>
                  <Overview
                    localPlayer={selectedPlayer}
                    match={match}
                    userProfileImage={(() => {
                      // Get player's card image
                      const cardUrl = playerCardSmallCache[selectedPlayer.Subject] || playerCardCache[selectedPlayer.Subject];
                      return cardUrl || './assets/default.png';
                    })()}
                    localPlayerFullName={selectedPlayer.Name || ''}
                    localPlayerName={(() => {
                      // Extract game name from "Name#Tag" format
                      const name = selectedPlayer.Name || '';
                      return name.includes('#') ? name.split('#')[0] : name;
                    })()}
                    savedPlayerInfo={(() => {
                      // Parse player name to get gameName and tag
                      const name = selectedPlayer.Name || '';
                      if (name.includes('#')) {
                        const [gameName] = name.split('#');
                        return {
                          gameName: gameName || '',
                          fullName: name,
                          puuid: selectedPlayer.Subject,
                          region: savedPlayerInfo.region || 'na' // Use saved region as fallback
                        };
                      }
                      return {
                        gameName: name,
                        fullName: name,
                        puuid: selectedPlayer.Subject,
                        region: savedPlayerInfo.region || 'na'
                      };
                    })()}
                    henrikApiKey={henrikApiKey}
                    getRankImage={getRankImage}
                    getAgentImage={getAgentImage}
                    valorantNotRunning={valorantNotRunning}
                  />
                </>
              ) : (
                <Overview
                  localPlayer={(() => {
                    // Find local player in current match
                    // Try to match by PUUID first (more reliable), then by name
                    const localPlayerByPuuid = localPlayerPuuid && match?.Players?.find(p => p.Subject === localPlayerPuuid);
                    if (localPlayerByPuuid) {
                      return localPlayerByPuuid;
                    }
                    // Fallback to name matching
                    return match?.Players?.find(p => {
                      const playerName = p.Name || '';
                      return localPlayerName && (playerName === localPlayerName || playerName.startsWith(localPlayerName + '#'));
                    }) || null;
                  })()}
                  match={match}
                  userProfileImage={userProfileImage}
                  localPlayerFullName={localPlayerFullName}
                  localPlayerName={localPlayerName}
                  savedPlayerInfo={savedPlayerInfo}
                  henrikApiKey={henrikApiKey}
                  getRankImage={getRankImage}
                  getAgentImage={getAgentImage}
                  valorantNotRunning={valorantNotRunning}
                />
              )}
            </div>
          )}

          {activeTab === 'live-match' && valorantNotRunning !== true && (
            <div className="live-stats-content">
              {(() => {
                const matchState = match?.state;
                const shouldShow = !!match || loading || currentGameState === 'PREGAME' || currentGameState === 'INGAME' || matchState === 'PREGAME' || matchState === 'INGAME';
                return shouldShow ? (() => {
                // If no match yet but we're in a game phase, create a minimal match object for skeleton display
                // Use current game state if available, otherwise default to PREGAME
                const detectedState = match?.state || currentGameState || 'PREGAME';
                const displayMatch = match || {
                  state: detectedState,
                  isLobby: detectedState === 'MENUS',
                  Players: [],
                  map: 'Unknown',
                  mode: 'Unknown',
                  queue: 'Unknown',
                } as MatchData;
                // Determine expected player count based on game phase
                const isPregame = displayMatch?.state === 'PREGAME' || detectedState === 'PREGAME' || currentGameState === 'PREGAME';
                const isIngame = displayMatch?.state === 'INGAME' || detectedState === 'INGAME' || currentGameState === 'INGAME';
                const isInMenus = displayMatch?.isLobby || displayMatch?.state === 'MENUS' || detectedState === 'MENUS' || currentGameState === 'MENUS';
                
                // Expected player counts - always show 5 skeletons in PREGAME/INGAME if no players yet
                const expectedAllies = (isPregame || isIngame) ? 5 : (displayMatch.Players?.length || (isInMenus ? displayMatch.Players?.length || 0 : 0));
                const expectedEnemies = (isPregame || isIngame) ? 5 : 0;
                
                // Find local player's team
                const localPlayer = displayMatch.Players?.find(p => {
                  const playerName = p.Name || '';
                  return localPlayerName && (playerName === localPlayerName || playerName.startsWith(localPlayerName + '#'));
                });
                const localPlayerTeam = localPlayer?.team;
                
                // Split players into allies and enemies
                const allies = displayMatch.Players?.filter(p => p.team === localPlayerTeam) || [];
                const enemies = displayMatch.Players?.filter(p => p.team && p.team !== localPlayerTeam) || [];
                
                // Create skeleton players for missing slots
                const createSkeletonPlayer = (index: number, team: string): Player => ({
                  Subject: `skeleton-${team}-${index}`,
                  Name: '',
                  CharacterID: '',
                  AgentName: '',
                  PlayerIdentity: {
                    AccountLevel: 0,
                    Incognito: false,
                    HideAccountLevel: false,
                    PlayerCardID: '',
                  },
                  currenttier: 0,
                  currenttierpatched: '',
                  rankingInTier: 0,
                  peakrank: '',
                  peakrankTier: 0,
                  peakrankep: '',
                  peakrankact: '',
                  previousRank: '',
                  leaderboard: 0,
                  winRate: 0,
                  numberofgames: 0,
                  headshotPercentage: 0,
                  kd: 0,
                  RankedRatingEarned: 'N/A',
                  AFKPenalty: 'N/A',
                  skinData: { skinName: '' },
                  loadout: {},
                  team: team,
                });
                
                // Fill missing ally slots with skeletons
                // But only if we're still waiting for players to load
                // Once all real players have loaded, don't show skeleton placeholders (could be custom game with <5 players)
                const allySkeletons: Player[] = [];
                // Check if all real players have finished loading
                const allAlliesLoaded = allies.length > 0 && allies.every(player => !isPlayerStatsLoading(player));
                
                // Only create skeleton placeholders if:
                // 1. We have some players but not all are loaded yet, OR
                // 2. We have no players at all (initial state)
                // Don't create skeletons if all players are loaded (could be custom game with fewer players)
                if (!allAlliesLoaded) {
                  // In PREGAME/INGAME, show skeletons up to expected count, but only while players are loading
                  const targetAllies = (isPregame || isIngame) && allies.length === 0 ? 5 : expectedAllies;
                  for (let i = allies.length; i < targetAllies; i++) {
                    allySkeletons.push(createSkeletonPlayer(i, localPlayerTeam || 'Blue'));
                  }
                }
                const allAllies = [...allies, ...allySkeletons];
                
                // Fill missing enemy slots with skeletons (only in ingame, not pregame, and only for team-based modes)
                const enemySkeletons: Player[] = [];
                const gameMode = displayMatch?.mode || '';
                const isCustomGame = gameMode.toLowerCase().includes('custom');
                const isTeamBasedMode = gameMode && 
                  !gameMode.toLowerCase().includes('deathmatch') && 
                  !gameMode.toLowerCase().includes('spike rush') &&
                  !gameMode.toLowerCase().includes('swiftplay');
                
                // Only create enemy skeletons in INGAME (not PREGAME), and only for team-based modes
                // Don't create enemy skeletons for custom games if no enemies exist (you might be alone)
                if (isIngame && isTeamBasedMode && !isPregame && !isCustomGame) {
                  // Check if all real enemies have finished loading
                  const allEnemiesLoaded = enemies.length > 0 && enemies.every(player => !isPlayerStatsLoading(player));
                  
                  // Only create skeleton placeholders if enemies are still loading
                  // Don't create skeletons if all enemies are loaded (could be custom game with fewer players)
                  if (!allEnemiesLoaded) {
                    // Only create enemy skeletons for team-based modes (not deathmatch, spike rush, swiftplay, etc.)
                    const targetEnemies = enemies.length === 0 ? 5 : expectedEnemies;
                    for (let i = enemies.length; i < targetEnemies; i++) {
                      enemySkeletons.push(createSkeletonPlayer(i, localPlayerTeam === 'Blue' ? 'Red' : 'Blue'));
                    }
                  }
                } else if (isIngame && isTeamBasedMode && !isPregame && isCustomGame) {
                  // For custom games, only create enemy skeletons if we actually have some enemies
                  // Don't create skeletons if no enemies exist (you might be alone in the game)
                  if (enemies.length > 0) {
                    const allEnemiesLoaded = enemies.every(player => !isPlayerStatsLoading(player));
                    if (!allEnemiesLoaded) {
                      // Only create skeletons for existing enemies that are still loading
                      // Don't create extra skeletons beyond what exists
                      const targetEnemies = enemies.length;
                      for (let i = enemies.length; i < targetEnemies; i++) {
                        enemySkeletons.push(createSkeletonPlayer(i, localPlayerTeam === 'Blue' ? 'Red' : 'Blue'));
                      }
                    }
                  }
                  // If no enemies exist in custom game, don't create any skeletons
                }
                const allEnemies = [...enemies, ...enemySkeletons];
                
                // If in lobby or no teams, show all players together
                if (displayMatch.isLobby || !localPlayerTeam) {
                  const allPlayers = displayMatch.Players || [];
                  // In lobby, only show skeletons for actual players while their stats load
                  // Don't create placeholder skeletons - just show skeleton for existing players
                  return (
                    <div className="live-stats-container">
                      {allPlayers.map((player) => {
                        // Check if this player should show skeleton (stats loading)
                        if (isPlayerStatsLoading(player)) {
                          return renderPlayerSkeleton(player);
                        }
                        return renderPlayerLiveStats(player);
                      })}
                    </div>
                  );
                }
                
                return (
                  <div className="live-stats-container">
                    {/* Always show allies section if in pregame/ingame, or if we have players/skeletons */}
                    {((isPregame || isIngame) || allAllies.length > 0) && (
                      <div className="team-section">
                        {/* Hide "Allies" header in non-team modes like deathmatch */}
                        {!isPregame && isTeamBasedMode && <h3 className="team-header team-ally">Allies</h3>}
                        <div className="team-players">
                          {allAllies.map((player) => {
                            // Check if this is a skeleton placeholder or if stats are loading
                            if (player.Subject.startsWith('skeleton-') || isPlayerStatsLoading(player)) {
                              return renderPlayerSkeleton(player);
                            }
                            return renderPlayerLiveStats(player);
                          })}
                        </div>
                      </div>
                    )}
                    {/* Only show enemies section in INGAME (not PREGAME), and only for team-based modes */}
                    {/* In PREGAME, only show team (allies), not enemies */}
                    {/* For custom games, only show enemies section if enemies actually exist */}
                    {((isIngame && isTeamBasedMode && (!isCustomGame || allEnemies.length > 0)) || (allEnemies.length > 0 && isTeamBasedMode && !isPregame)) ? (
                      <div className="team-section">
                        <h3 className="team-header team-enemy">Enemies</h3>
                        <div className="team-players">
                          {allEnemies.map((player) => {
                            // Check if this is a skeleton placeholder or if stats are loading
                            if (player.Subject.startsWith('skeleton-') || isPlayerStatsLoading(player)) {
                              return renderPlayerSkeleton(player);
                            }
                            return renderPlayerLiveStats(player);
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })() : !loading ? (
                <div className="info-message">Waiting for players...</div>
              ) : (
                <div className="info-message">Initializing...</div>
              );
              })()}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default LiveMatch;

