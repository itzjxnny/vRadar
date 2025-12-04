import { EventEmitter } from 'events';
import axios from 'axios';
import { version, hide_names, gamemodes, NUMBERTORANKS, before_ascendant_seasons } from './constants';
import { Logging } from './logs';
import { Config } from './config';
import { Error as ErrorSRC } from './errors';
import { Requests } from './requestsV';
import type { Lockfile } from './requestsV';
import { Presences, Presence } from './presences';
import { Names, Player as NamesPlayer } from './names';
import { Menu, PartyMember } from './states/menu';
import { Pregame } from './states/pregame';
import { Coregame } from './states/coregame';
import { Content } from './content';
import { Rank } from './rank';
import { PlayerStats } from './player_stats';
import { Server } from './server';
import { Ws } from './websocket';
import { Loadouts } from './Loadouts';
import { MatchData, Player } from '../../src/types/match';

interface LevelBorder {
    startingLevel: number;
    levelNumberAppearance: string;
}

interface AgentDict {
    [agentId: string]: string;
}

interface ValoApiSkin {
    uuid?: string;
    displayName?: string;
    displayIcon?: string;
    [key: string]: unknown;
}

interface ValoApiSkinsResponse {
    data?: ValoApiSkin[];
    [key: string]: unknown;
}

interface GameContent {
    [key: string]: unknown;
}

interface MatchInfo {
    map: string;
    mode: string;
    queue: string;
    state: string;
    mapImageUrl?: string | null;
}

interface NamesMap {
    [puuid: string]: string;
}

interface LoadoutsMap {
    [puuid: string]: string | { text: string };
}

interface LoadoutsData {
    Players?: {
        [puuid: string]: unknown;
    };
    [key: string]: unknown;
}

interface RanksMap {
    [tier: number]: string;
}

interface CoregamePlayer {
    Subject: string;
    CharacterID?: string;
    TeamID?: string;
    PlayerIdentity?: {
        AccountLevel?: number;
        Incognito?: boolean;
        HideAccountLevel?: boolean;
        PlayerCardID?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface PregamePlayer {
    Subject: string;
    CharacterID?: string;
    CharacterSelectionState?: string;
    PregamePlayerState?: string;
    PlayerIdentity?: {
        AccountLevel?: number;
        Incognito?: boolean;
        HideAccountLevel?: boolean;
        PlayerCardID?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface CoregameStats {
    MapID?: string;
    Players?: CoregamePlayer[];
    [key: string]: unknown;
}

interface PregameStats {
    MapID?: string;
    GameMode?: string;
    AllyTeam?: {
        Players?: PregamePlayer[];
        [key: string]: unknown;
    };
    Teams?: Array<{
        TeamID?: string;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
}

interface ConfigData {
    weapon?: string;
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

interface VisibilitySettings {
    showKD: boolean;
    showHS: boolean;
    showWR: boolean;
    showRR: boolean;
    showSkin: boolean;
    showRank: boolean;
    showPeak: boolean;
    showLevel: boolean;
    showParty: boolean;
}

export class ValorantService extends EventEmitter {
    private log: (msg: string) => void;
    private loggingInstance!: Logging; // Initialized in constructor
    private cfg: Config;
    private requests: Requests;
    private content: Content;
    private rank: Rank;
    private pstats: PlayerStats;
    private namesClass: Names;
    private presences: Presences;
    private menu: Menu;
    private pregame: Pregame;
    private coregame: Coregame;
    private server: Server;
    private wss: Ws;
    private loadoutsClass: Loadouts;

    private currentGameState: string = "MENUS";
    private previousProcessedState: string = "";
    private isRunning: boolean = false;
    private lastMatchData: MatchData | null = null;
    private valorantNotRunning: boolean = false;
    private lastNotRunningLogTime: number = 0; // Track when we last logged "not running" to avoid spam
    private readonly NOT_RUNNING_LOG_INTERVAL = 5 * 60 * 1000; // Log every 5 minutes when not running
    private lastValorantProcessState: boolean | null = null; // Track last known Valorant.exe process state
    private lockfileLogged: boolean = false; // Track if we've already logged lockfile (persists across loop iterations)
    private processCheckLogged: boolean = false; // Track if we've already logged process check (persists across loop iterations)
    private previousPregamePlayerStates: Map<string, { CharacterID?: string; CharacterSelectionState?: string; PregamePlayerState?: string }> = new Map();
    // Cache for ally player data from PREGAME (excluding skinData which is only available in-game)
    private pregameAllyCache: Map<string, Omit<Player, 'skinData' | 'team' | 'characterSelectionState'>> = new Map();
    // Track last processed match ID to detect new matches
    private lastProcessedMatchId: string | null = null;
    private henrikApiKey: string = "";
    private apiKeyLogged: boolean = false; // Track if we've already logged the API key message

    // Cache for content
    private agentDict: AgentDict = {};
    private agentImages: Record<string, string> = {}; // Agent displayName -> displayIcon URL
    private rankImages: Record<number, string> = {}; // Tier number -> smallIcon URL
    private mapUrls: Record<string, string> = {};
    private mapStylizedImages: Record<string, string> = {}; // Map UUID -> stylizedBackgroundImage (for pre-game regular)
    private mapSplashImages: Record<string, string> = {}; // Map UUID -> splash (for in-game regular)
    private mapPremierImages: Record<string, string> = {}; // Map UUID -> premierBackgroundImage (for premier pre-game and in-game)
    private levelBorders: LevelBorder[] = []; // Level borders sorted by startingLevel
    private valoApiSkins: ValoApiSkinsResponse = { data: [] };
    private gameContent: GameContent = {};
    private seasonID: string = "";
    private previousSeasonID: string = "";

    constructor() {
        super();
        try {
            this.loggingInstance = new Logging();
            this.log = this.loggingInstance.log.bind(this.loggingInstance);
            this.log('Starting ValorantService...');
        } catch (error) {
            // If logging fails, use console as fallback
            console.error('Failed to initialize logging:', error);
            this.log = (msg: string) => console.log(`[ValorantService] ${msg}`);
            this.log('Starting ValorantService (using console fallback)...');
        }

        try {
            const errorSRC = new ErrorSRC(this.log);
        this.requests = new Requests(version, this.log, errorSRC, async () => {
            // Callback when connection fails
            // Don't immediately mark as not running - check if Valorant.exe is actually running
            // and if lockfile exists, be more patient
            const lockfile = this.requests.get_lockfile();
            let valorantProcessRunning = false;
            
            if (process.platform === 'win32') {
                try {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execAsync = promisify(exec);
                    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Valorant.exe" /FO CSV');
                    valorantProcessRunning = stdout.includes('Valorant.exe');
                } catch (error) {
                    // Ignore errors checking process
                }
            }
            
            // Only mark as not running if:
            // 1. No lockfile exists AND
            // 2. Valorant.exe is not running
            // Otherwise, be patient - Valorant might still be starting
            if (!lockfile && !valorantProcessRunning) {
                if (!this.valorantNotRunning) {
                    this.valorantNotRunning = true;
                    this.log('Connection failure detected - no lockfile and Valorant.exe not running - emitting valorant_not_running status');
                    this.emit('status', { status: "valorant_not_running" });
                }
            } else {
                // Lockfile exists or Valorant.exe is running - don't mark as not running yet
                // The loop will handle this more gracefully
                // Only log periodically to avoid spam
                const timeSinceLastLog = Date.now() - this.lastNotRunningLogTime;
                if (timeSinceLastLog >= this.NOT_RUNNING_LOG_INTERVAL) {
                    this.log('Connection failure but lockfile or Valorant.exe exists - will retry in loop');
                    this.lastNotRunningLogTime = Date.now();
                }
            }
        });
            this.cfg = new Config(this.log);
            this.log('Config initialized');
            this.content = new Content(this.requests, this.log);
            this.log('Content initialized');
            this.rank = new Rank(this.requests, this.log, this.content, before_ascendant_seasons);
            this.log('Rank initialized');
            this.pstats = new PlayerStats(this.requests, this.log);
            this.log('PlayerStats initialized');
            this.namesClass = new Names(this.requests, this.log, hide_names, {});
            this.log('Names initialized');
            this.presences = new Presences(this.requests, this.log);
            this.log('Presences initialized');
            this.menu = new Menu(this.requests, this.log, this.presences);
            this.log('Menu initialized');
            this.pregame = new Pregame(this.requests, this.log);
            this.log('Pregame initialized');
            this.coregame = new Coregame(this.requests, this.log);
            this.log('Coregame initialized');
            this.server = new Server(this.log, errorSRC);
            this.log('Server initialized');

            // Initial placeholders, will be re-initialized in start()
            this.loadoutsClass = new Loadouts(this.requests, this.log, this.server, "N/A");
            this.log('Loadouts initialized');
            this.wss = new Ws(this.requests.lockfile, this.requests, this.cfg, hide_names, this.server);
            this.log('WebSocket initialized');
            this.log('ValorantService constructor completed successfully');
        } catch (error) {
            const errorMessage = error instanceof globalThis.Error ? error.message : String(error);
            const errorStack = error instanceof globalThis.Error ? error.stack : undefined;
            this.log(`Error in ValorantService constructor: ${errorMessage}`);
            if (errorStack) {
                this.log(`Stack trace: ${errorStack}`);
            }
            throw error; // Re-throw to let main.ts handle it
        }
    }

    public async start() {
        if (this.isRunning) {
            this.log('Service already running, skipping start');
            return;
        }
        this.isRunning = true;
        this.log('Starting ValorantService...');

        try {
            this.log('Checking version and status...');
            await Requests.check_version(version);
            await Requests.check_status();
            this.log('Version and status checks completed');

            this.log('Starting server...');
            this.server.start_server();
            this.log('Server started');

            // Initialize content
            this.log('Initializing content (agents, ranks, maps)...');
            const [agent_dict, agent_images, rank_images, map_info] = await Promise.all([
                this.content.get_all_agents(),
                this.content.get_agent_images(),
                this.content.get_rank_images(),
                this.content.get_all_maps()
            ]);
            this.log('Content initialization completed');
            this.agentDict = agent_dict;
            this.agentImages = agent_images;
            this.rankImages = rank_images;
            this.mapUrls = this.content.get_map_urls(map_info);

            // Update Names class with agent dict for name hiding
            this.namesClass.set_agent_dict(this.agentDict);

            // Initialize WebSocket
            this.wss = new Ws(this.requests.lockfile, this.requests, this.cfg, hide_names, this.server);

            // Fetch skins, maps, level borders, and game content
            try {
                const [skinsResponse, mapsResponse, levelBordersResponse, contentData] = await Promise.all([
                    axios.get("https://valorant-api.com/v1/weapons/skins").catch(() => ({ data: { data: [] } })),
                    axios.get("https://valorant-api.com/v1/maps").catch(() => ({ data: { data: [] } })),
                    axios.get("https://valorant-api.com/v1/levelborders").catch(() => ({ data: { data: [] } })),
                    this.content.get_content().catch(() => ({}))
                ]);
                this.valoApiSkins = skinsResponse.data;
                this.gameContent = contentData;
                this.seasonID = this.content.get_latest_season_id(this.gameContent) || "";
                this.previousSeasonID = this.content.get_previous_season_id(this.gameContent) || "";
                
                // Store level borders from API
                if (levelBordersResponse.data && levelBordersResponse.data.data && Array.isArray(levelBordersResponse.data.data)) {
                    this.levelBorders = (levelBordersResponse.data.data as LevelBorder[])
                        .map((border) => ({
                            startingLevel: border.startingLevel || 0,
                            levelNumberAppearance: border.levelNumberAppearance || ''
                        }))
                        .filter((border) => border.levelNumberAppearance)
                        .sort((a, b) => b.startingLevel - a.startingLevel); // Sort descending (highest first)
                    this.log(`Loaded ${this.levelBorders.length} level borders from API`);
                }
                
                // Store map images from API
                if (mapsResponse.data && mapsResponse.data.data && Array.isArray(mapsResponse.data.data)) {
                    for (const map of mapsResponse.data.data) {
                        const mapUuid = map.uuid?.toLowerCase();
                        const mapName = map.displayName;
                        if (mapUuid && mapName) {
                            // Store stylized background image (for pre-game regular)
                            const stylizedImageUrl = map.stylizedBackgroundImage || map.splash || map.displayIcon;
                            if (stylizedImageUrl) {
                                this.mapStylizedImages[mapUuid] = stylizedImageUrl;
                                this.mapStylizedImages[mapName.toLowerCase()] = stylizedImageUrl;
                            }
                            
                            // Store splash image (for in-game regular)
                            const splashImageUrl = map.splash || map.stylizedBackgroundImage || map.displayIcon;
                            if (splashImageUrl) {
                                this.mapSplashImages[mapUuid] = splashImageUrl;
                                this.mapSplashImages[mapName.toLowerCase()] = splashImageUrl;
                            }
                            
                            // Store premier background image (for premier pre-game and in-game)
                            const premierImageUrl = map.premierBackgroundImage || map.stylizedBackgroundImage || map.splash || map.displayIcon;
                            if (premierImageUrl) {
                                this.mapPremierImages[mapUuid] = premierImageUrl;
                                this.mapPremierImages[mapName.toLowerCase()] = premierImageUrl;
                            }
                        }
                    }
                    this.log(`Loaded ${Object.keys(this.mapStylizedImages).length} map images from API`);
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log(`Error fetching initial data: ${errorMessage}`);
            }

            await this.sleep(1000); // Give frontend a moment to set up listeners
            
            // Check for Valorant.exe process first (more reliable than lockfile on startup)
            let valorantProcessRunning = false;
            if (process.platform === 'win32') {
                try {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execAsync = promisify(exec);
                    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Valorant.exe"');
                    valorantProcessRunning = stdout.toLowerCase().includes('valorant.exe');
                    if (valorantProcessRunning) {
                        this.log('Valorant.exe process detected - will wait for lockfile');
                        // Only emit loading if Valorant.exe is actually running
                        this.emit('status', { status: "loading" });
                    }
                } catch (error) {
                    // Ignore errors checking process
                }
            }
            
            // If Valorant.exe is not running, emit not_running status immediately
            if (!valorantProcessRunning) {
                this.log('Valorant.exe not running - emitting valorant_not_running status');
                this.valorantNotRunning = true;
                this.emit('status', { status: "valorant_not_running" });
            }
            
            // Check for lockfile with retries (Valorant might be starting)
            let initialLockfile: Lockfile | null = null;
            const maxLockfileRetries = valorantProcessRunning ? 15 : 5; // More retries if process is running
            for (let retry = 0; retry < maxLockfileRetries; retry++) {
                initialLockfile = this.requests.get_lockfile();
                if (initialLockfile) {
                    break;
                }
                if (retry < maxLockfileRetries - 1) {
                    this.log(`Lockfile not found, retrying (${retry + 1}/${maxLockfileRetries})...`);
                    await this.sleep(valorantProcessRunning ? 2000 : 2000); // Wait 2 seconds between retries
                }
            }
            
            if (!initialLockfile) {
                // If Valorant.exe is running but no lockfile, wait a bit more
                if (valorantProcessRunning) {
                    this.log('Valorant.exe is running but lockfile not ready yet - will continue checking in loop');
                    this.valorantNotRunning = false; // Don't mark as not running if process exists
                    this.emit('status', { status: "loading" }); // Keep showing loading
                } else {
                    this.valorantNotRunning = true;
                    this.log('No lockfile found and Valorant.exe not running - emitting valorant_not_running status');
                    this.emit('status', { status: "valorant_not_running" });
                    // Emit it again after a short delay to ensure frontend receives it
                    setTimeout(() => {
                        this.emit('status', { status: "valorant_not_running" });
                    }, 500);
                }
            } else {
                // Try presence check with more retries and longer timeouts (Valorant might be starting)
                let initialFailures = 0;
                let initialCheckSucceeded = false;
                const maxRetries = 5; // Increased from 2 to 5
                const timeoutMs = 5000; // Increased from 2000 to 5000
                
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        const initialPresence = await Promise.race([
                            this.presences.get_presence(),
                            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
                        ]);
                        if (initialPresence === null || (Array.isArray(initialPresence) && initialPresence.length === 0)) {
                            initialFailures++;
                            // Only log first, last, and every 2nd failure to reduce spam
                            if (initialFailures === 1 || initialFailures === maxRetries || initialFailures % 2 === 0) {
                                this.log(`Initial presence check failed (${initialFailures}/${maxRetries})`);
                            }
                            if (i < maxRetries - 1) {
                                // Wait longer between retries (3 seconds)
                                await this.sleep(3000);
                            }
                        } else {
                            this.log('Initial presence check succeeded');
                            initialCheckSucceeded = true;
                            break;
                        }
                    } catch (error) {
                        initialFailures++;
                        this.log(`Initial presence check error (${initialFailures}/${maxRetries}): ${error}`);
                        if (i < maxRetries - 1) {
                            await this.sleep(3000);
                        }
                    }
                }
                
                // Only mark as not running if all retries failed
                // Otherwise, let the loop handle detection (it's more patient)
                if (initialFailures >= maxRetries && !initialCheckSucceeded) {
                    // Check if Valorant.exe is still running before emitting loading
                    let stillRunning = false;
                    if (process.platform === 'win32') {
                        try {
                            const { exec } = require('child_process');
                            const { promisify } = require('util');
                            const execAsync = promisify(exec);
                            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Valorant.exe"');
                            stillRunning = stdout.toLowerCase().includes('valorant.exe');
                        } catch (error) {
                            // Ignore errors
                        }
                    }
                    
                    // Only emit loading if Valorant.exe is still running
                    if (stillRunning) {
                        this.log('Initial presence check failed, but Valorant.exe is still running - will retry in main loop');
                        this.valorantNotRunning = false;
                        this.emit('status', { status: "loading" }); // Keep showing loading
                    } else {
                        this.log('Initial presence check failed and Valorant.exe not running - emitting valorant_not_running status');
                        this.valorantNotRunning = true;
                        this.emit('status', { status: "valorant_not_running" });
                    }
                } else if (initialCheckSucceeded) {
                    // Successfully detected Valorant - emit connected status
                    this.valorantNotRunning = false;
                    this.log('Initial check succeeded - emitting connected status');
                    this.emit('status', { status: "connected" });
                }
            }
            
            // Always start the loop, even if initial check failed
            // The loop will handle detection and recovery
            this.log('Starting main service loop...');

            // Start the main loop (don't await - it runs indefinitely)
            // Use setImmediate to ensure it starts even if there are pending promises
            setImmediate(() => {
                this.log('Main service loop starting now...');
                this.loop().catch((error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorStack = error instanceof Error ? error.stack : undefined;
                    this.log(`Error in main loop: ${errorMessage}`);
                    if (errorStack) {
                        this.log(`Stack trace: ${errorStack}`);
                    }
                    this.isRunning = false;
                    // Try to restart the loop after a delay
                    setTimeout(() => {
                        if (!this.isRunning) {
                            this.log('Attempting to restart service loop...');
                            this.isRunning = true;
                            this.loop().catch((err) => {
                                this.log(`Failed to restart loop: ${err}`);
                            });
                        }
                    }, 5000);
                });
            });
            
            this.log('Service start() method completed - loop should be starting');

        } catch (error) {
            this.log(`Fatal error starting service: ${error}`);
            this.isRunning = false;
        }
    }

    private async loop() {
        this.log('Main service loop entered - starting detection cycle');
        let firstTime = true;
        let lastProcessedState = "";
        let consecutiveFailures = 0;
        const maxFailures = 3;
        let loopIteration = 0;

        while (this.isRunning) {
            loopIteration++;
            // Log every 30 iterations (about every 30 seconds) to confirm loop is running
            if (loopIteration % 30 === 0) {
                this.log(`Service loop running (iteration ${loopIteration}) - checking for Valorant...`);
            }
            
            try {
                // Check if lockfile exists and if we can connect
                const lockfile = this.requests.get_lockfile();
                if (!lockfile) {
                    // Before marking as not running, also check if Valorant.exe process is running
                    // This helps detect when Valorant is starting but lockfile isn't ready yet
                    let valorantProcessRunning = false;
                    if (process.platform === 'win32') {
                        try {
                            const { exec } = require('child_process');
                            const { promisify } = require('util');
                            const execAsync = promisify(exec);
                            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Valorant.exe" /FO CSV');
                            valorantProcessRunning = stdout.includes('Valorant.exe');
                        } catch (error) {
                            // Ignore errors checking process
                        }
                    }
                    
                    if (valorantProcessRunning) {
                        // Valorant.exe is running but lockfile not ready yet - wait and retry
                        this.log('Valorant.exe process detected but lockfile not ready yet - waiting...');
                        await this.sleep(2000);
                        continue;
                    }
                    
                    // No process and no lockfile - Valorant is not running
                    if (!this.valorantNotRunning) {
                        this.valorantNotRunning = true;
                        this.lastNotRunningLogTime = Date.now();
                        this.log('No lockfile found and Valorant.exe not running - Valorant is not running');
                        this.emit('status', { status: "valorant_not_running" });
                    } else {
                        // Already in not-running state - only log periodically to avoid spam
                        const timeSinceLastLog = Date.now() - this.lastNotRunningLogTime;
                        if (timeSinceLastLog >= this.NOT_RUNNING_LOG_INTERVAL) {
                            this.lastNotRunningLogTime = Date.now();
                            this.log('Valorant is still not running (checking every 2 seconds)');
                        }
                    }
                    // Check more frequently when Valorant is not running (every 2 seconds)
                    // This allows faster detection when Valorant starts
                    await this.sleep(2000);
                    continue;
                } else {
                    // Lockfile exists - only log once per session (instance variable persists across loop iterations)
                    if (!this.lockfileLogged) {
                        this.log(`Lockfile found: name=${lockfile.name}, port=${lockfile.port}`);
                        this.lockfileLogged = true;
                    }
                    
                    // If lockfile shows "Riot Client", check if Valorant.exe is actually running
                    // Riot Client lockfile doesn't mean Valorant is ready
                    if (lockfile.name === 'Riot Client' || lockfile.name === 'RiotClient') {
                        let valorantProcessRunning = false;
                        if (process.platform === 'win32') {
                            try {
                                const { exec } = require('child_process');
                                const { promisify } = require('util');
                                const execAsync = promisify(exec);
                                // Use LIST format instead of CSV for more reliable detection
                                const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Valorant.exe"');
                                // Check for Valorant.exe in the output (LIST format includes it in the process name column)
                                valorantProcessRunning = stdout.toLowerCase().includes('valorant.exe');
                                
                                // Only log when state actually changes (running <-> not running)
                                // Don't log if state is the same as before
                                const previousState = this.lastValorantProcessState;
                                if (previousState !== null && previousState !== valorantProcessRunning) {
                                    // State changed - log it
                                    if (valorantProcessRunning) {
                                        this.log('Valorant.exe process confirmed running (detected via tasklist)');
                                        this.processCheckLogged = true;
                                    } else {
                                        this.log('Valorant.exe process not found in tasklist');
                                        this.processCheckLogged = true;
                                    }
                                } else if (previousState === null && !valorantProcessRunning && !this.processCheckLogged) {
                                    // First time checking and it's not running - log once
                                    this.log('Valorant.exe process not found in tasklist');
                                    this.processCheckLogged = true;
                                }
                                // Always update state to track changes
                                this.lastValorantProcessState = valorantProcessRunning;
                            } catch (error: unknown) {
                                // Only log errors on first time or periodically
                                const timeSinceLastLog = Date.now() - this.lastNotRunningLogTime;
                                if (this.lastValorantProcessState === null || timeSinceLastLog >= this.NOT_RUNNING_LOG_INTERVAL) {
                                    const errorMessage = error instanceof globalThis.Error ? error.message : String(error);
                                    this.log(`Error checking for Valorant.exe process: ${errorMessage}`);
                                }
                                // If check fails, assume it's not running to be safe
                                valorantProcessRunning = false;
                                // Update state if this is first time
                                if (this.lastValorantProcessState === null) {
                                    this.lastValorantProcessState = false;
                                }
                            }
                        }
                        
                        if (!valorantProcessRunning) {
                            // Riot Client is running but Valorant.exe is not - emit not_running status
                            if (!this.valorantNotRunning) {
                                this.valorantNotRunning = true;
                                this.lastNotRunningLogTime = Date.now();
                                this.log('Lockfile shows Riot Client but Valorant.exe not running - emitting valorant_not_running status');
                                this.emit('status', { status: "valorant_not_running" });
                            } else {
                                // Already in not-running state - only log periodically to avoid spam
                                const timeSinceLastLog = Date.now() - this.lastNotRunningLogTime;
                                if (timeSinceLastLog >= this.NOT_RUNNING_LOG_INTERVAL) {
                                    this.lastNotRunningLogTime = Date.now();
                                    this.log('Valorant.exe still not running (Riot Client lockfile exists)');
                                }
                            }
                            await this.sleep(3000);
                            continue;
                        } else {
                            // Valorant.exe is running - proceed with connection attempts
                            // Don't wait for a VALORANT lockfile that doesn't exist - just use the Riot Client lockfile
                        if (this.valorantNotRunning) {
                            this.valorantNotRunning = false;
                            this.lastNotRunningLogTime = 0; // Reset log time when Valorant is detected
                            this.lastValorantProcessState = true; // Update process state
                            this.log('Valorant.exe detected - switching to loading status and attempting to connect');
                            this.emit('status', { status: "loading" });
                        }
                            // Continue with the loop to attempt connection - don't wait for VALORANT lockfile
                            // The lockfile will always be "Riot Client", so proceed with connection attempts
                        }
                    }
                }
                
                // Lockfile found (always Riot Client) - check if Valorant.exe is running
                // Only emit loading if Valorant.exe is actually running
                let valorantProcessRunning = false;
                if (process.platform === 'win32') {
                    try {
                        const { exec } = require('child_process');
                        const { promisify } = require('util');
                        const execAsync = promisify(exec);
                        const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Valorant.exe"');
                        valorantProcessRunning = stdout.toLowerCase().includes('valorant.exe');
                    } catch (error) {
                        // Ignore errors
                    }
                }
                
                // Lockfile found - if we were in "not running" state and Valorant.exe is running, reset and try to connect
                if (this.valorantNotRunning && valorantProcessRunning) {
                    this.log('Lockfile detected and Valorant.exe is running - Valorant appears to be running, attempting to connect...');
                    this.valorantNotRunning = false;
                    consecutiveFailures = 0; // Reset failure counter
                    // Emit loading status immediately to let frontend know we're connecting
                    this.emit('status', { status: "loading" });
                    // Don't emit connected yet - wait for presence check to succeed
                } else if (!valorantProcessRunning) {
                    // We have a lockfile (Riot Client) but Valorant.exe is not running
                    // Don't emit loading - show not running instead
                    if (!this.valorantNotRunning) {
                        this.valorantNotRunning = true;
                        this.lastNotRunningLogTime = Date.now();
                        this.log('Lockfile exists but Valorant.exe not running - emitting valorant_not_running status');
                        this.emit('status', { status: "valorant_not_running" });
                    } else {
                        // Already in not-running state - only log periodically to avoid spam
                        const timeSinceLastLog = Date.now() - this.lastNotRunningLogTime;
                        if (timeSinceLastLog >= this.NOT_RUNNING_LOG_INTERVAL) {
                            this.lastNotRunningLogTime = Date.now();
                            this.log('Valorant.exe still not running (lockfile exists)');
                        }
                    }
                }

                // Try to get presence to verify Valorant is running
                // When Valorant.exe is first detected, the API might not be ready yet
                // Wait a bit and refresh lockfile before attempting connection
                if (this.valorantNotRunning === false && consecutiveFailures === 0) {
                    // First time detecting Valorant.exe - wait a bit for API to be ready
                    this.log('Valorant.exe detected, waiting for API to be ready...');
                    await this.sleep(3000); // Wait 3 seconds for Valorant API to initialize
                    // Refresh lockfile in case it changed
                    const refreshedLockfile = this.requests.get_lockfile();
                    if (refreshedLockfile) {
                        this.requests.lockfile = refreshedLockfile;
                        // Update WebSocket with new lockfile
                        this.wss.updateLockfile(refreshedLockfile);
                        this.log(`Refreshed lockfile: port=${refreshedLockfile.port}`);
                    }
                }
                
                // Use a longer timeout to give Valorant time to fully start
                try {
                    const presence = await Promise.race([
                        this.presences.get_presence(),
                        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)) // Increased timeout to 10 seconds
                    ]);
                    
                    if (presence === null || (Array.isArray(presence) && presence.length === 0)) {
                        consecutiveFailures++;
                        this.log(`Presence check failed (${consecutiveFailures}/${maxFailures}) - lockfile exists, will retry`);
                        
                        // If lockfile exists, be more patient - don't mark as not running immediately
                        // Only mark as not running if we've failed many times AND lockfile disappears
                        if (consecutiveFailures >= maxFailures * 2) { // Double the failures when lockfile exists
                            // Check if lockfile still exists before marking as not running
                            const stillHasLockfile = this.requests.get_lockfile();
                            if (!stillHasLockfile) {
                                // Lockfile disappeared, Valorant really isn't running
                                if (!this.valorantNotRunning) {
                                    this.valorantNotRunning = true;
                                    this.log('Lockfile disappeared after many failures - emitting valorant_not_running status');
                                    this.emit('status', { status: "valorant_not_running" });
                                }
                                await this.sleep(5000);
                                continue;
                            } else {
                                // Lockfile still exists, just presence is failing - keep trying
                                this.log('Lockfile still exists, presence check failing but will continue trying');
                                consecutiveFailures = maxFailures; // Reset to maxFailures to keep trying
                                await this.sleep(3000);
                                continue;
                            }
                        } else {
                            // Haven't failed enough yet, just wait and retry
                            await this.sleep(3000);
                            continue;
                        }
                    } else {
                        consecutiveFailures = 0;
                        // Reset flag if we successfully get presence
                        // IMPORTANT: Refresh headers when transitioning from not-running to connected
                        // This ensures we have valid authentication tokens for API calls
                        try {
                            await this.requests.get_headers(true); // Force refresh headers
                            this.log('Headers refreshed after successful connection');
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            this.log(`Warning: Failed to refresh headers after connection: ${errorMessage}`);
                            // Continue anyway - headers might still be valid
                        }
                        
                        if (this.valorantNotRunning) {
                            this.valorantNotRunning = false;
                            this.lastNotRunningLogTime = 0; // Reset log time when Valorant is detected
                            this.lastValorantProcessState = true; // Update process state
                            this.log('Valorant connection restored - emitting connected status');
                            this.emit('status', { status: "connected" });
                            // Emit again after a short delay to ensure frontend receives it
                            setTimeout(() => {
                                this.emit('status', { status: "connected" });
                            }, 500);
                        } else if (firstTime) {
                            // Also emit connected on first successful check
                            this.log('Initial connection successful - emitting connected status');
                            this.emit('status', { status: "connected" });
                            // Emit again after a short delay to ensure frontend receives it
                            setTimeout(() => {
                                this.emit('status', { status: "connected" });
                            }, 500);
                        } else if (!this.valorantNotRunning && consecutiveFailures === 0) {
                            // Ensure we emit connected status if we're not in not-running state and presence succeeded
                            this.emit('status', { status: "connected" });
                        }
                    }
                } catch (error) {
                    consecutiveFailures++;
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.log(`Presence check error (${consecutiveFailures}/${maxFailures * 2}): ${errorMessage}`);
                    
                    // Check if lockfile still exists
                    const stillHasLockfile = this.requests.get_lockfile();
                    if (!stillHasLockfile) {
                        // Lockfile disappeared
                        if (!this.valorantNotRunning) {
                            this.valorantNotRunning = true;
                            this.log('Lockfile disappeared after error - emitting valorant_not_running status');
                            this.emit('status', { status: "valorant_not_running" });
                        }
                        await this.sleep(5000);
                        continue;
                    } else if (consecutiveFailures >= maxFailures * 2) {
                        // Too many failures even with lockfile - but lockfile exists, so keep trying
                        this.log('Many presence check failures but lockfile exists - will keep trying');
                        consecutiveFailures = maxFailures; // Reset to keep trying
                        await this.sleep(3000);
                        continue;
                    } else {
                        // Not enough failures yet, retry
                        await this.sleep(3000);
                        continue;
                    }
                }

                if (firstTime) {
                    // Give Valorant more time to fully start before initial detection
                    // This is especially important on system startup when Valorant might be launching
                    await this.sleep(3000); // Increased from 2000 to 3000
                    
                    // Ensure headers are initialized before initial state detection
                    // This is critical when transitioning from "not running" to "connected"
                    try {
                        await this.requests.get_headers(true); // Force refresh headers
                        this.log('Headers refreshed before initial state detection');
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.log(`Warning: Failed to refresh headers before initial detection: ${errorMessage}`);
                        // Continue anyway - might still work
                    }
                    
                    let detected = await this.detectInitialState();
                    if (!detected) {
                        // Failed to detect initial state - but don't immediately mark as not running
                        // Give it more tries since Valorant might still be starting (especially on system startup)
                        // Only increment failures if we've already had presence check failures
                        // Otherwise, just retry detection a few more times
                        if (consecutiveFailures > 0) {
                            consecutiveFailures++;
                        }
                        
                        // Allow up to 5 retries for initial detection (more patient)
                        const maxInitialRetries = 5;
                        let initialDetectionRetries = 0;
                        while (initialDetectionRetries < maxInitialRetries && !detected) {
                            initialDetectionRetries++;
                            this.log(`Initial state detection failed, retrying (${initialDetectionRetries}/${maxInitialRetries})...`);
                            await this.sleep(4000); // Wait 4 seconds between retries
                            detected = await this.detectInitialState();
                            if (detected) {
                                consecutiveFailures = 0;
                                // Successfully detected state, reset flag
                                if (this.valorantNotRunning) {
                                    this.valorantNotRunning = false;
                                    this.log('Valorant connection restored - emitting connected status (initial detection retry)');
                                    this.emit('status', { status: "connected" });
                                } else {
                                    // First time success after retry
                                    this.log('Initial detection succeeded after retry - emitting connected status');
                                    this.emit('status', { status: "connected" });
                                }
                                firstTime = false;
                                break; // Exit the retry loop
                            }
                        }
                        
                        // If we still haven't detected after all retries, check if we should mark as not running
                        if (!detected) {
                            // Only mark as not running if we've also had presence check failures
                            if (consecutiveFailures >= maxFailures) {
                                if (!this.valorantNotRunning) {
                                    this.valorantNotRunning = true;
                                    this.emit('status', { status: "valorant_not_running" });
                                }
                                await this.sleep(5000);
                                continue;
                            } else {
                                // Still have hope - continue to next iteration
                                // Don't set firstTime to false yet, let it try again
                                await this.sleep(5000);
                                continue;
                            }
                        }
                    }
                    
                    // If we got here and detected is true, we successfully detected
                    if (detected) {
                        consecutiveFailures = 0;
                        // Successfully detected state, reset flag
                        if (this.valorantNotRunning) {
                            this.valorantNotRunning = false;
                            this.log('Valorant connection restored - emitting connected status (initial detection)');
                            this.emit('status', { status: "connected" });
                        } else {
                            // First time success
                            this.log('Initial detection succeeded - emitting connected status');
                            this.emit('status', { status: "connected" });
                        }
                        firstTime = false;
                    }
                } else {
                    // Skip WebSocket reconnect if we're in PREGAME (we're polling manually)
                    if (this.currentGameState !== "PREGAME") {
                        const previous_game_state = this.currentGameState;
                        
                        // Check presence FIRST, especially when in MENUS, to catch PREGAME transitions
                        // This prevents the WebSocket from skipping PREGAME and going directly to INGAME
                        let presence_detected_state: string | null = null;
                        try {
                            const presence_check = await this.presences.get_presence();
                            if (presence_check === null) {
                                consecutiveFailures++;
                                if (consecutiveFailures >= maxFailures) {
                                    if (!this.valorantNotRunning) {
                                        this.valorantNotRunning = true;
                                        this.emit('status', { status: "valorant_not_running" });
                                    }
                                    await this.sleep(5000);
                                    continue;
                                }
                            } else {
                                consecutiveFailures = 0;
                                if (this.valorantNotRunning) {
                                    this.valorantNotRunning = false;
                                }
                                presence_detected_state = this.presences.get_game_state(presence_check);
                                
                                if (presence_detected_state !== null && presence_detected_state !== this.currentGameState) {
                                    // State changed! Update immediately and reset lastProcessedState
                                    const previousState = this.currentGameState;
                                    this.currentGameState = presence_detected_state;
                                    lastProcessedState = ""; // Reset to force processing of new state
                                    // Update previousProcessedState when state changes to ensure cache invalidation works
                                    if (presence_detected_state === "MENUS" && previousState !== "MENUS") {
                                        this.previousProcessedState = previousState;
                                    }
                                    this.log(`State change detected via presence: ${previousState} -> ${presence_detected_state}`);
                                    
                                    // If we detected PREGAME, skip WebSocket and continue to process PREGAME immediately
                                    if (presence_detected_state === "PREGAME") {
                                        continue;
                                    }
                                }
                            }
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            this.log(`[STATE CHECK ERROR] ${errorMessage}`);
                            // Ignore errors in state detection
                            consecutiveFailures++;
                            if (consecutiveFailures >= maxFailures) {
                                if (!this.valorantNotRunning) {
                                    this.valorantNotRunning = true;
                                    this.emit('status', { status: "valorant_not_running" });
                                }
                                await this.sleep(5000);
                                continue;
                            }
                        }
                        
                        // Only use WebSocket if presence didn't detect a state change
                        // Skip WebSocket if we're already in PREGAME
                        if (this.currentGameState !== "PREGAME" && (presence_detected_state === null || presence_detected_state === this.currentGameState)) {
                            const new_state = await this.wss.reconnect_to_websocket(this.currentGameState);
                            
                            if (new_state !== "DISCONNECTED" && new_state !== previous_game_state) {
                                // If WebSocket detects INGAME from MENUS, double-check with presence for PREGAME
                                if (new_state === "INGAME" && previous_game_state === "MENUS") {
                                    try {
                                        const quick_check = await this.presences.get_presence();
                                        if (quick_check) {
                                            const quick_state = this.presences.get_game_state(quick_check);
                                            if (quick_state === "PREGAME") {
                                                this.currentGameState = "PREGAME";
                                                lastProcessedState = "";
                                                continue;
                                            }
                                        }
                                    } catch {
                                        // If check fails, proceed with WebSocket result
                                    }
                                }
                                
                                // Only update if WebSocket detected a different state than what presence detected
                                if (presence_detected_state === null || new_state !== presence_detected_state) {
                                    this.currentGameState = new_state;
                                    lastProcessedState = ""; // Reset to force processing of new state
                                    // Update previousProcessedState when state changes to ensure cache invalidation works
                                    if (new_state === "MENUS" && previous_game_state !== "MENUS") {
                                        this.previousProcessedState = previous_game_state;
                                        this.rank.invalidate_cached_responses();
                                        this.pstats.invalidate_cached_responses();
                                        this.log('Invalidated rank and player stats caches - transitioning to MENUS');
                                    }
                                    this.log(`State change detected via WebSocket: ${previous_game_state} -> ${new_state}`);
                                    
                                    // If transitioning to MENUS or PREGAME, immediately process the new state
                                    if (new_state === "MENUS" || new_state === "PREGAME") {
                                        // Reset lastProcessedState to force processing
                                        lastProcessedState = "";
                                        // If transitioning to MENUS, process it immediately to ensure matchData is emitted
                                        if (new_state === "MENUS") {
                                            this.emit('status', { status: "loading", state: this.currentGameState });
                                            await this.processGameState();
                                            this.previousProcessedState = this.currentGameState;
                                            firstTime = false;
                                            await this.sleep(500);
                                        }
                                        continue; // Process new state immediately (or continue if already processed)
                                    }
                                }
                            }
                        }

                        if (previous_game_state !== this.currentGameState && this.currentGameState === "MENUS") {
                            this.rank.invalidate_cached_responses();
                            this.pstats.invalidate_cached_responses();
                            this.log('Invalidated rank and player stats caches - transitioning to MENUS');
                        }
                    }
                }

                if (this.currentGameState === "DISCONNECTED") {
                    this.emit('status', { status: "disconnected" });
                    await this.handleReconnect();
                    firstTime = true;
                    lastProcessedState = "";
                    continue;
                }

                // Don't process if Valorant is not running
                if (this.valorantNotRunning) {
                    await this.sleep(5000);
                    continue;
                }

                // For PREGAME, poll every 250ms to detect agent selection changes faster
                if (this.currentGameState === "PREGAME") {
                    // Check for state changes via presence (to detect transition to INGAME or back to MENUS)
                    try {
                        const presence_check = await this.presences.get_presence();
                        if (presence_check) {
                            const detected_state = this.presences.get_game_state(presence_check);
                            if (detected_state !== null && detected_state !== "PREGAME" && detected_state !== this.currentGameState) {
                                // State changed from PREGAME to something else (likely INGAME or MENUS)
                                this.currentGameState = detected_state;
                                lastProcessedState = ""; // Reset to force processing of new state
                                if (detected_state === "MENUS") {
                                    this.lastProcessedMatchId = null; // Clear match ID when returning to MENUS
                                    this.log(`State change detected: PREGAME -> MENUS (left pregame)`);
                                }
                                // Continue to process the new state
                            }
                        }
                    } catch {
                        // Ignore errors in state detection
                    }
                    
                    // Only process PREGAME if we're still in PREGAME
                    if (this.currentGameState === "PREGAME") {
                        // Always process PREGAME first
                        this.emit('status', { status: "loading", state: this.currentGameState });
                        await this.processGameState();
                        // Then sleep 250ms before next poll for faster detection (reduced from 500ms)
                        await this.sleep(250);
                        // Reset firstTime to false so we don't trigger initial state detection again
                        firstTime = false;
                        // Don't update lastProcessedState for PREGAME so we keep processing
                        continue;
                    }
                    // If state changed, fall through to process the new state
                }

                // For MENUS (lobby), poll every 500ms to detect when players join and state changes
                if (this.currentGameState === "MENUS") {
                    // Check if we've transitioned to PREGAME - check BEFORE processing
                    try {
                        const pregame_check = await this.presences.get_presence();
                        if (pregame_check) {
                            const detected_state = this.presences.get_game_state(pregame_check);
                            if (detected_state === "PREGAME" && this.currentGameState === "MENUS") {
                                this.currentGameState = "PREGAME";
                                lastProcessedState = ""; // Reset to force processing of new state
                                this.log(`State change detected: MENUS -> PREGAME`);
                                // Continue to process PREGAME state
                                continue;
                            }
                        }
                    } catch (error) {
                        // Ignore errors
                    }
                    
                    this.emit('status', { status: "loading", state: this.currentGameState });
                    await this.processGameState();
                    // Update previous processed state after processing
                    this.previousProcessedState = this.currentGameState;
                    // Sleep 500ms before next poll
                    await this.sleep(500);
                    firstTime = false;
                    continue;
                }

                // For INGAME, poll every 500ms to detect when you leave the game
                if (this.currentGameState === "INGAME") {
                    let stateChanged = false;
                    
                    // First, check if match ID is "0" (match ended) - this is the most reliable indicator
                    try {
                        const currentMatchId = await this.coregame.get_coregame_match_id();
                        
                        if (currentMatchId === "0" || !currentMatchId || currentMatchId === "") {
                            // Match ended - we've left the game, transition to MENUS
                            this.currentGameState = "MENUS";
                            lastProcessedState = ""; // Reset to force processing of new state
                            this.lastProcessedMatchId = null; // Clear match ID
                            this.log(`State change detected: INGAME -> MENUS (match ID is 0/null/empty)`);
                            stateChanged = true;
                        } else if (currentMatchId !== "0" && currentMatchId !== this.lastProcessedMatchId && this.lastProcessedMatchId !== null) {
                            // New match detected (different match ID)
                            this.lastProcessedMatchId = currentMatchId;
                            this.pregameAllyCache.clear(); // Clear cache for new match
                        } else if (this.lastProcessedMatchId === null) {
                            // First time processing this match, store the match ID
                            this.lastProcessedMatchId = currentMatchId;
                        }
                    } catch (error) {
                        // If we can't get match ID (API error), it might mean we're no longer in game
                        // Check presence to confirm
                        try {
                            const presence_check = await this.presences.get_presence();
                            if (presence_check) {
                                const detected_state = this.presences.get_game_state(presence_check);
                                if (detected_state === "MENUS") {
                                    this.currentGameState = "MENUS";
                                    lastProcessedState = ""; // Reset to force processing of new state
                                    this.lastProcessedMatchId = null; // Clear match ID
                                    this.log(`State change detected: INGAME -> MENUS (match ID API error, presence confirms MENUS)`);
                                    stateChanged = true;
                                }
                            }
                        } catch {
                            // Ignore errors
                        }
                    }
                    
                    // If state already changed, skip other checks
                    if (!stateChanged) {
                        // Also check for state changes via presence (to detect transition to MENUS or PREGAME)
                        try {
                            const presence_check = await this.presences.get_presence();
                            if (presence_check) {
                                const detected_state = this.presences.get_game_state(presence_check);
                                
                                if (detected_state !== null && detected_state !== "INGAME" && detected_state !== this.currentGameState) {
                                    // State changed from INGAME to something else (likely MENUS or PREGAME)
                                    this.currentGameState = detected_state;
                                    lastProcessedState = ""; // Reset to force processing of new state
                                    if (detected_state === "MENUS") {
                                        this.lastProcessedMatchId = null; // Clear match ID when returning to MENUS
                                        this.log(`State change detected: INGAME -> MENUS (via presence)`);
                                    } else if (detected_state === "PREGAME") {
                                        this.lastProcessedMatchId = null; // Clear match ID
                                        this.log(`State change detected: INGAME -> PREGAME (via presence)`);
                                    }
                                    stateChanged = true;
                                }
                            }
                        } catch {
                            // Ignore errors
                        }
                    }
                    
                    // If state changed, process the new state immediately
                    if (stateChanged) {
                        continue; // Process new state immediately
                    }
                    
                    // Only process INGAME if we're still in INGAME
                    if (this.currentGameState === "INGAME") {
                        // Check if state changed (new match or first time)
                        const shouldProcess = lastProcessedState !== this.currentGameState || firstTime;
                        if (shouldProcess) {
                            lastProcessedState = this.currentGameState;
                            this.emit('status', { status: "loading", state: this.currentGameState });
                            await this.processGameState();
                            // Update previous processed state after processing
                            this.previousProcessedState = this.currentGameState;
                        }
                        // Sleep 500ms before next poll (similar to MENUS)
                        await this.sleep(500);
                        firstTime = false;
                        continue;
                    }
                    // If state changed, fall through to process the new state
                }

                // For other states, only process when state changes
                let shouldProcess = lastProcessedState !== this.currentGameState || firstTime;
                
                if (!shouldProcess) {
                    // State hasn't changed and it's not a new match, wait a bit before checking again
                    await this.sleep(1000); // Check every 1 second for state changes
                    continue;
                }

                lastProcessedState = this.currentGameState;
                this.emit('status', { status: "loading", state: this.currentGameState });
                
                await this.processGameState();
                
                // Update previous processed state after processing
                this.previousProcessedState = this.currentGameState;

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;
                this.log(`Error in loop: ${errorMessage}${errorStack ? '\n' + errorStack : ''}`);
                
                // Don't count non-critical errors as failures (like name fetching errors)
                // Only count errors that indicate Valorant is not running
                const isNonCriticalError = errorMessage.includes('substring') || 
                                          errorMessage.includes('names') || 
                                          errorMessage.includes('400') ||
                                          errorMessage.includes('404');
                
                if (!isNonCriticalError) {
                    consecutiveFailures++;
                    if (consecutiveFailures >= maxFailures) {
                        if (!this.valorantNotRunning) {
                            this.valorantNotRunning = true;
                            this.emit('status', { status: "valorant_not_running" });
                        }
                    }
                } else {
                    // Reset failure count for non-critical errors
                    consecutiveFailures = 0;
                }
                
                // Only sleep if it's a critical error, otherwise continue quickly
                if (!isNonCriticalError) {
                    await this.sleep(5000);
                } else {
                    await this.sleep(250); // Quick retry for non-critical errors
                }
            }
        }
    }

    private async detectInitialState(): Promise<boolean> {
        let attempts = 0;
        const maxAttempts = 15;
        const failureThreshold = 3; // Emit status after 3 consecutive failures
        let consecutiveFailures = 0;
        let run = true;

        while (run && attempts < maxAttempts) {
            const presence = await this.presences.get_presence();
            if (presence === null) {
                // Can't get presence - Valorant might not be running
                consecutiveFailures++;
                attempts++;
                if (consecutiveFailures >= failureThreshold) {
                    // Emit status early if we consistently can't connect
                    this.emit('status', { status: "valorant_not_running" });
                }
                if (run) await this.sleep(1000);
                continue;
            }
            
            // Reset failure count on success
            consecutiveFailures = 0;
            
            const private_presence = this.presences.get_private_presence(presence || []);
            if (private_presence !== null) {
                const detected_state = this.presences.get_game_state(presence || []);
                if (detected_state !== null) {
                    this.currentGameState = detected_state;
                    run = false;
                    return true;
                }
            }
            attempts++;
            if (run) await this.sleep(1000);
        }

        if (attempts >= maxAttempts && this.currentGameState === "MENUS") {
            // Fallback checks
            try {
                const coregame_match_id = await this.coregame.get_coregame_match_id();
                if (coregame_match_id && coregame_match_id !== "0") {
                    this.currentGameState = "INGAME";
                    return true;
                } else {
                    const pregame_match_id = await this.pregame.get_pregame_match_id();
                    if (pregame_match_id && pregame_match_id !== "0") {
                        // Clear previous states when entering pregame (fresh start)
                        this.previousPregamePlayerStates.clear();
                        // Fetch match data from Henrik API
                        this.fetchHenrikMatch(pregame_match_id).then((matchData) => {
                            if (matchData) {
                                this.log(`[HENRIK API] Match data received for PREGAME match ${pregame_match_id}`);
                            }
                        }).catch(() => {
                            // Error already logged in fetchHenrikMatch
                        });
                        this.currentGameState = "PREGAME";
                        return true;
                    }
                }
            } catch {
                // Ignore errors in fallback state detection
            }
        }

        // If we got here and still haven't detected a state, Valorant is likely not running
        if (consecutiveFailures >= failureThreshold || (attempts >= maxAttempts && this.currentGameState === "MENUS")) {
            this.emit('status', { status: "valorant_not_running" });
            return false;
        }
        return attempts < maxAttempts || this.currentGameState !== "MENUS";
    }

    private async handleReconnect() {
        while (this.isRunning) {
            const refreshedLockfile = this.requests.get_lockfile();
            if (refreshedLockfile) {
                this.requests.lockfile = refreshedLockfile;
                // Update WebSocket with new lockfile
                this.wss.updateLockfile(refreshedLockfile);
            }
            if (this.requests.lockfile === null) {
                this.emit('status', { status: "valorant_not_running" });
                await this.sleep(5000);
                continue;
            }
            const presence_check = await this.presences.get_presence();
            if (presence_check !== null) {
                // Successfully reconnected
                this.emit('status', { status: "loading", state: "reconnecting" });
                break;
            }
            this.emit('status', { status: "valorant_not_running" });
            await this.sleep(5000);
        }
        await this.requests.get_headers(true);
        this.wss = new Ws(this.requests.lockfile, this.requests, this.cfg, hide_names, this.server);
    }

    private async processGameState() {
        const Ranks = NUMBERTORANKS;
        const presence = await this.presences.get_presence();
        const priv_presence = this.presences.get_private_presence(presence || []);

        let playersData: Player[] = [];
        let matchInfo: MatchInfo = {
            map: "Unknown",
            mode: "Unknown",
            queue: "Unknown",
            state: this.currentGameState
        };

        // Determine mode and queue
        let gamemode = "Custom Game";
        let party_state = "";
        if (priv_presence) {
            const partyPresenceData = priv_presence.partyPresenceData as { partyState?: string } | undefined;
            const queueId = priv_presence.queueId as string | undefined;
            const provisioningFlow = priv_presence.provisioningFlow as string | undefined;
            
            if (partyPresenceData) {
                party_state = partyPresenceData.partyState || "";
            } else if ("partyState" in priv_presence) {
                party_state = (priv_presence.partyState as string) || "";
            }

            if (provisioningFlow !== "CustomGame" && party_state !== "CUSTOM_GAME_SETUP") {
                gamemode = queueId ? (gamemodes[queueId] || "Unknown") : "Unknown";
            }
            matchInfo.mode = gamemode;
            matchInfo.queue = queueId || "Unknown";
        }

        if (this.currentGameState === "INGAME") {
            // Clear pregame states when transitioning to INGAME
            if (this.previousPregamePlayerStates.size > 0) {
                this.previousPregamePlayerStates.clear();
            }
            // Keep pregame ally cache - we'll use it to avoid refetching ally stats
            const coregame_stats: CoregameStats | null = await this.coregame.get_coregame_stats() as CoregameStats | null;
            if (coregame_stats) {
                const mapId = (coregame_stats.MapID as string | undefined)?.toLowerCase() || "";
                matchInfo.map = mapId ? (this.mapUrls[mapId] || "Unknown") : "Unknown";
                
                // Check if it's a premier game (queueId contains "premier" or is "premier")
                const isPremier = matchInfo.queue && matchInfo.queue.toLowerCase().includes("premier");
                // In-game: use splash for regular, premierBackgroundImage for premier
                // Try both mapId (UUID or URL path) and map name
                const mapName = matchInfo.map.toLowerCase();
                const premierUrl = (mapId ? this.mapPremierImages[mapId] : undefined) || (mapName ? this.mapPremierImages[mapName] : undefined) || null;
                const splashUrl = (mapId ? this.mapSplashImages[mapId] : undefined) || (mapName ? this.mapSplashImages[mapName] : undefined) || null;
                const stylizedUrl = (mapId ? this.mapStylizedImages[mapId] : undefined) || (mapName ? this.mapStylizedImages[mapName] : undefined) || null;
                matchInfo.mapImageUrl = isPremier 
                    ? (premierUrl || null)
                    : (splashUrl || stylizedUrl || null);
                
                const Players = (coregame_stats.Players as CoregamePlayer[]) || [];
                
                const match_id = await this.coregame.get_coregame_match_id();
                
                // Check if this is a new match (different match ID)
                if (this.lastProcessedMatchId !== null && this.lastProcessedMatchId !== match_id && match_id !== "0") {
                    this.log(`New INGAME match detected: ${this.lastProcessedMatchId} -> ${match_id}, clearing caches`);
                    // Clear pregame ally cache for new match
                    this.pregameAllyCache.clear();
                    // Invalidate stats cache for new match (stats might have changed)
                    this.pstats.invalidate_cached_responses();
                }
                if (match_id !== "0") {
                    // Log match ID when entering INGAME (only log if it's a new match or first time)
                    if (this.lastProcessedMatchId === null || this.lastProcessedMatchId !== match_id) {
                        this.log(`[MATCH] INGAME - Match ID: ${match_id}`);
                        // Fetch match data from Henrik API
                        this.fetchHenrikMatch(match_id).then((matchData) => {
                            if (matchData) {
                                this.log(`[HENRIK API] Match data received for INGAME match ${match_id}`);
                            }
                        }).catch(() => {
                            // Error already logged in fetchHenrikMatch
                        });
                    }
                    this.lastProcessedMatchId = match_id;
                }
                
                await this.presences.wait_for_presence(this.namesClass.get_players_puuid(Players as unknown as NamesPlayer[]));
                const names = await this.namesClass.get_names_from_puuids(Players as unknown as NamesPlayer[]);
                
                // Fetch loadouts for the selected weapon
                const loadouts_arr = await this.loadoutsClass.get_match_loadouts(match_id, Players as unknown as NamesPlayer[], this.cfg.weapon, this.valoApiSkins, names, "game");
                const loadouts = loadouts_arr[0] as LoadoutsMap;
                const loadouts_data = loadouts_arr[1] as unknown as LoadoutsData;
                const skinDetails = (loadouts_arr[2] as Record<string, { skinName: string; skinVariant?: string; skinLevel?: string; skinImageUrl?: string }>) || {};
                
                // Get party members for name hiding logic
                const partyMembers = this.menu.get_party_members(this.requests.puuid, presence || []);
                const partyMembersList = partyMembers.map((p) => p.Subject);

                // Process players - reuse cached ally data from PREGAME if available
                for (const player of Players) {
                    const puuid = player.Subject;
                    const cachedAllyData = this.pregameAllyCache.get(puuid);
                    
                    let pData: Player;
                    try {
                        if (cachedAllyData) {
                            // This is an ally from PREGAME - reuse cached stats, only fetch skin data
                        
                        // Get skin data (only thing that changes in-game)
                        const skinNameRaw = loadouts[puuid];
                        let processedSkinName = "";
                        if (skinNameRaw) {
                            if (typeof skinNameRaw === 'object' && 'text' in skinNameRaw) {
                                processedSkinName = skinNameRaw.text || "";
                            } else if (typeof skinNameRaw === 'string') {
                                processedSkinName = skinNameRaw.replace(/\u001b\[[0-9;]*m/g, '');
                            }
                        }
                        const playerSkinDetails = skinDetails[puuid] || {};
                        const finalSkinName = playerSkinDetails.skinName || processedSkinName;
                        
                        // Create player data with cached stats but fresh skin data
                        // Preserve cached stats (kd, headshotPercentage, winRate) since they don't change during a match
                        pData = {
                            ...cachedAllyData,
                            skinData: {
                                skinName: finalSkinName || "",
                                skinVariant: playerSkinDetails.skinVariant,
                                skinLevel: playerSkinDetails.skinLevel,
                                skinImageUrl: playerSkinDetails.skinImageUrl
                            },
                            team: player["TeamID"] as string,
                            // Update agent info in case it changed
                            CharacterID: (player.CharacterID as string | undefined)?.toLowerCase() || cachedAllyData.CharacterID,
                            AgentName: cachedAllyData.AgentName, // Keep cached agent name
                            AgentImageUrl: cachedAllyData.AgentImageUrl, // Keep cached agent image
                            // Explicitly preserve stats from cache - don't refetch during INGAME updates
                            kd: cachedAllyData.kd,
                            headshotPercentage: cachedAllyData.headshotPercentage,
                            winRate: cachedAllyData.winRate,
                            numberofgames: cachedAllyData.numberofgames,
                            // Stats were already fetched in PREGAME
                            statsFetched: cachedAllyData.statsFetched !== undefined ? cachedAllyData.statsFetched : true,
                            // Preserve competitive stats flag from PREGAME
                            hasCompetitiveStats: cachedAllyData.hasCompetitiveStats
                        };
                        
                    } else {
                        // This is an enemy (or ally not in cache) - fetch everything fresh
                        this.log(`Fetching fresh data for ${names[puuid] || puuid} (enemy or not cached)`);
                        
                        // Check if we have existing valid data for this player to preserve if fetch fails
                        const existingPlayer = this.lastMatchData?.Players?.find(p => p.Subject === puuid);
                        const hasValidExistingData = existingPlayer && (
                            (existingPlayer.currenttier && existingPlayer.currenttier > 0) ||
                            (existingPlayer.kd && existingPlayer.kd > 0) ||
                            (existingPlayer.winRate && existingPlayer.winRate > 0)
                        );
                        
                        try {
                            pData = await this.processPlayer(player as CoregamePlayer, names, loadouts, loadouts_data, Ranks, presence, skinDetails, player["TeamID"] as string, partyMembersList, matchInfo.queue);
                            pData.team = player["TeamID"] as string;
                            
                            // Check if stats fetch actually succeeded (not all zeros/N/A)
                            const statsFetched = (pData.kd && pData.kd > 0) || 
                                                (pData.headshotPercentage && pData.headshotPercentage > 0) || 
                                                (pData.winRate && pData.winRate > 0) ||
                                                (pData.currenttier && pData.currenttier > 0) ||
                                                (pData.numberofgames && pData.numberofgames > 0);
                            
                            // If stats fetch failed (all zeros) but we have valid existing data, preserve it
                            if (!statsFetched && hasValidExistingData && existingPlayer) {
                                this.log(`Stats fetch failed for ${names[puuid] || puuid}, preserving existing valid data`);
                                // Preserve existing stats and rank if new fetch failed
                                if (existingPlayer.currenttier && existingPlayer.currenttier > 0) {
                                    pData.currenttier = existingPlayer.currenttier;
                                    pData.currenttierpatched = existingPlayer.currenttierpatched;
                                    pData.rankingInTier = existingPlayer.rankingInTier || 0;
                                }
                                if (existingPlayer.kd !== undefined && existingPlayer.kd > 0) {
                                    pData.kd = existingPlayer.kd;
                                }
                                if (existingPlayer.headshotPercentage !== undefined && existingPlayer.headshotPercentage > 0) {
                                    pData.headshotPercentage = existingPlayer.headshotPercentage;
                                }
                                if (existingPlayer.winRate !== undefined && existingPlayer.winRate > 0) {
                                    pData.winRate = existingPlayer.winRate;
                                }
                                if (existingPlayer.numberofgames !== undefined && existingPlayer.numberofgames > 0) {
                                    pData.numberofgames = existingPlayer.numberofgames;
                                }
                            } else if (!statsFetched) {
                                // Stats fetch failed and no existing data - log for debugging
                                this.log(`Stats fetch returned no data for ${names[puuid] || puuid} - may need retry`);
                            }
                        } catch (playerError) {
                            const errorMessage = playerError instanceof Error ? playerError.message : String(playerError);
                            this.log(`Error processing player ${names[puuid] || puuid}: ${errorMessage}`);
                            
                            // If we have existing valid data, use it instead of creating empty player
                            if (hasValidExistingData && existingPlayer) {
                                this.log(`Using existing valid data for ${names[puuid] || puuid} due to processing error`);
                                pData = {
                                    ...existingPlayer,
                                    team: player["TeamID"] as string,
                                    CharacterID: (player.CharacterID as string | undefined)?.toLowerCase() || existingPlayer.CharacterID,
                                };
                            } else {
                                // Create minimal player data to prevent crash
                                // Don't set statsFetched to true here - stats weren't actually fetched
                                pData = {
                                    Subject: puuid,
                                    Name: names[puuid] || "Unknown",
                                    CharacterID: (player.CharacterID as string | undefined)?.toLowerCase() || "",
                                    AgentName: "Unknown",
                                    AgentImageUrl: null,
                                    PlayerIdentity: {
                                        AccountLevel: 0,
                                        Incognito: false,
                                        HideAccountLevel: false,
                                        PlayerCardID: "",
                                        LevelBorderUrl: null
                                    },
                                    currenttier: 0,
                                    currenttierpatched: "UNRANKED",
                                    rankingInTier: 0,
                                    peakrank: "UNRANKED",
                                    peakrankTier: 0,
                                    peakrankep: "",
                                    peakrankact: "",
                                    previousRank: "UNRANKED",
                                    leaderboard: 0,
                                    winRate: 0,
                                    numberofgames: 0,
                                    headshotPercentage: 0,
                                    kd: 0,
                                    RankedRatingEarned: "N/A",
                                    AFKPenalty: "N/A",
                                    skinData: { skinName: "" },
                                    loadout: {},
                                    team: player["TeamID"] as string || "Unknown",
                                    statsFetched: false // Stats weren't fetched due to error
                                };
                            }
                        }
                    }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.log(`Error processing player ${names[puuid] || puuid}: ${errorMessage}`);
                        // Create minimal player data to prevent crash
                        // Don't set statsFetched to true here - stats weren't actually fetched
                        pData = {
                            Subject: puuid,
                            Name: names[puuid] || "Unknown",
                            CharacterID: (player.CharacterID as string | undefined)?.toLowerCase() || "",
                            AgentName: "Unknown",
                            AgentImageUrl: null,
                            PlayerIdentity: {
                                AccountLevel: 0,
                                Incognito: false,
                                HideAccountLevel: false,
                                PlayerCardID: "",
                                LevelBorderUrl: null
                            },
                            currenttier: 0,
                            currenttierpatched: "UNRANKED",
                            rankingInTier: 0,
                            peakrank: "UNRANKED",
                            peakrankTier: 0,
                            peakrankep: "",
                            peakrankact: "",
                            previousRank: "UNRANKED",
                            leaderboard: 0,
                            winRate: 0,
                            numberofgames: 0,
                            headshotPercentage: 0,
                            kd: 0,
                            RankedRatingEarned: "N/A",
                            AFKPenalty: "N/A",
                            skinData: { skinName: "" },
                            loadout: {},
                            team: player["TeamID"] as string || "Unknown",
                            statsFetched: false // Stats weren't fetched due to error
                        };
                    }
                    playersData.push(pData);
                }
            }
        } else if (this.currentGameState === "PREGAME") {
            // Fetch pregame stats every 250ms to detect agent selection changes faster
            try {
                const pregame_stats = await this.pregame.get_pregame_stats() as PregameStats | null;
                if (pregame_stats) {
                const allyTeam = pregame_stats.AllyTeam as { Players?: PregamePlayer[] } | undefined;
                const Players = (allyTeam?.Players || []) as PregamePlayer[];
                
                await this.presences.wait_for_presence(this.namesClass.get_players_puuid(Players as unknown as NamesPlayer[]));
                const names = await this.namesClass.get_names_from_puuids(Players as unknown as NamesPlayer[]);
                
                // Get party members for name hiding logic
                const partyMembers = this.menu.get_party_members(this.requests.puuid, presence || []);
                const partyMembersList = partyMembers.map((p) => p.Subject);

                for (const player of Players) {
                    const pData = await this.processPlayer(player as PregamePlayer, names, {}, {}, Ranks, presence, {}, pregame_stats["Teams"]?.[0]?.["TeamID"] as string || "Blue", partyMembersList, matchInfo.queue);
                    pData.team = "Blue"; // Pregame usually just one team we can see
                    pData.characterSelectionState = (player as PregamePlayer).CharacterSelectionState;
                    
                    
                    // Cache ally data (excluding skinData, team, characterSelectionState which change in-game)
                    const puuid = player.Subject;
                    const { skinData, team, characterSelectionState, ...allyDataToCache } = pData;
                    this.pregameAllyCache.set(puuid, allyDataToCache);
                    
                    // Update previous state for agent selection tracking
                    this.previousPregamePlayerStates.set(puuid, {
                        CharacterID: player.CharacterID || "",
                        CharacterSelectionState: player.CharacterSelectionState || "",
                        PregamePlayerState: player.PregamePlayerState || ""
                    });
                    
                    playersData.push(pData);
                }
                
                
                // Update matchInfo with pregame map and mode
                const pregameMapId = pregame_stats.MapID as string | undefined;
                if (pregameMapId) {
                    const mapId = pregameMapId.toLowerCase();
                    matchInfo.map = this.mapUrls[mapId] || "Unknown";
                    
                    // Check if it's a premier game
                    const isPremier = matchInfo.queue && matchInfo.queue.toLowerCase().includes("premier");
                    // Pre-game: use stylizedBackgroundImage for regular, premierBackgroundImage for premier
                    // Try both UUID and map name lookup
                    const mapName = matchInfo.map.toLowerCase();
                    const stylizedUrl = this.mapStylizedImages[mapId] || this.mapStylizedImages[mapName] || null;
                    const premierUrl = this.mapPremierImages[mapId] || this.mapPremierImages[mapName] || null;
                    const splashUrl = this.mapSplashImages[mapId] || this.mapSplashImages[mapName] || null;
                    matchInfo.mapImageUrl = isPremier 
                        ? (premierUrl || null)
                        : (stylizedUrl || splashUrl || null);
                    
                    if (!matchInfo.mapImageUrl) {
                        this.log(`PREGAME lookup failed - checking available keys:`);
                        this.log(`  stylizedKeys (first 10): ${Object.keys(this.mapStylizedImages).slice(0, 10).join(', ')}`);
                        this.log(`  premierKeys (first 10): ${Object.keys(this.mapPremierImages).slice(0, 10).join(', ')}`);
                        this.log(`  Looking for: mapId="${mapId}", mapName="${mapName}"`);
                    }
                }
                // Mode is already set from priv_presence above, but we can override if pregame has it
                const gameMode = pregame_stats.GameMode as string | undefined;
                if (gameMode) {
                    matchInfo.mode = gamemodes[gameMode] || matchInfo.mode;
                }
                }
            } catch (pregameError) {
                const errorMessage = pregameError instanceof Error ? pregameError.message : String(pregameError);
                this.log(`Error processing PREGAME state: ${errorMessage}`);
                // Continue processing even if there's an error - don't crash the loop
            }
        } else if (this.currentGameState === "MENUS") {
            // Clear pregame states when transitioning to MENUS
            if (this.previousPregamePlayerStates.size > 0) {
                this.previousPregamePlayerStates.clear();
            }
            // Clear pregame ally cache when leaving to MENUS (new match will start)
            if (this.pregameAllyCache.size > 0) {
                this.pregameAllyCache.clear();
                this.log('Cleared pregame ally cache - transitioning to MENUS');
            }
            // Invalidate caches to ensure fresh data when returning to lobby
            // This ensures updated rank and stats are fetched after a match
            if (this.previousProcessedState !== "MENUS") {
                this.rank.invalidate_cached_responses();
                this.pstats.invalidate_cached_responses();
                this.log('Invalidated rank and player stats caches - processing MENUS state (transitioned from ' + this.previousProcessedState + ')');
            }
            const Players = this.menu.get_party_members(this.requests.puuid, presence || []);
            const names = await this.namesClass.get_names_from_puuids(Players as unknown as NamesPlayer[]);

            for (const player of Players) {
                // In MENUS, always use competitive stats regardless of selected queue
                const pData = await this.processPlayer(player as PartyMember, names, {}, {}, Ranks, presence, {}, undefined, undefined, "competitive");
                pData.isLobby = true;
                playersData.push(pData);
            }
        }

        // Format data for frontend
        const newMatchData: MatchData = {
            map: matchInfo.map || "Unknown",
            mode: matchInfo.mode || "Unknown",
            queue: matchInfo.queue || "Unknown",
            state: matchInfo.state || this.currentGameState,
            mapImageUrl: matchInfo.mapImageUrl,
            Players: playersData,
            isLobby: this.currentGameState === "MENUS"
        };

        const stateChanged = this.lastMatchData && this.lastMatchData.state && this.lastMatchData.state !== newMatchData.state;
        
        if (stateChanged && this.lastMatchData) {
            this.log(`[STATE TRANSITION] State changed from ${this.lastMatchData.state} to ${newMatchData.state} - emitting matchData`);
            this.lastMatchData = newMatchData;
            this.emit('matchData', this.lastMatchData);
            return;
        }
        
        if (this.currentGameState === "MENUS" && (!this.lastMatchData || !this.lastMatchData.state || this.lastMatchData.state !== "MENUS")) {
            const lastState = this.lastMatchData?.state || 'null';
            this.log(`[MENUS TRANSITION] Transitioning to MENUS (lastMatchData.state: ${lastState}, newMatchData.state: ${newMatchData.state}) - emitting matchData`);
            this.lastMatchData = newMatchData;
            this.emit('matchData', this.lastMatchData);
            return;
        }

        if (this.currentGameState === "PREGAME" && this.lastMatchData) {
            const playerKey = (p: Player) => `${p.Subject}-${p.CharacterID}-${p.characterSelectionState}`;
            const playersChanged = JSON.stringify(newMatchData.Players.map(playerKey)) !== JSON.stringify(this.lastMatchData.Players.map(playerKey));
            const mapChanged = newMatchData.map !== this.lastMatchData.map;
            const modeChanged = newMatchData.mode !== this.lastMatchData.mode;
            const playerCountChanged = newMatchData.Players.length !== this.lastMatchData.Players.length;
            
            if (!playersChanged && !mapChanged && !modeChanged && !playerCountChanged) {
                this.lastMatchData = newMatchData;
                return;
            }
        }
        
        if (this.currentGameState === "MENUS") {
            const lastStateWasDifferent = this.lastMatchData && this.lastMatchData.state && this.lastMatchData.state !== "MENUS";
            const justTransitionedToMenus = (this.previousProcessedState !== "MENUS" && this.previousProcessedState !== "") || lastStateWasDifferent;
            
            if (justTransitionedToMenus) {
                this.log(`[MENUS] Transitioned from ${this.previousProcessedState || this.lastMatchData?.state || 'unknown'} to MENUS - emitting matchData`);
            } else if (this.lastMatchData) {
                // Compare player list - check if party members changed
                const currentPlayerIds = new Set(newMatchData.Players.map(p => p.Subject).sort());
                const lastPlayerIds = new Set(this.lastMatchData.Players.map(p => p.Subject).sort());
                
                const playerCountChanged = currentPlayerIds.size !== lastPlayerIds.size;
                const playersChanged = playerCountChanged || 
                    ![...currentPlayerIds].every(id => lastPlayerIds.has(id)) ||
                    ![...lastPlayerIds].every(id => currentPlayerIds.has(id));
                
                // Also check if player data changed (rank, stats, etc.) even if same players
                // This ensures UI updates when rank/stats are fetched after initial load
                let playerDataChanged = false;
                if (!playersChanged && currentPlayerIds.size > 0) {
                    // Check if any player's rank or stats have been updated
                    for (const currentPlayer of newMatchData.Players) {
                        const lastPlayer = this.lastMatchData.Players.find(p => p.Subject === currentPlayer.Subject);
                        if (lastPlayer) {
                            // Check if rank or win rate changed (indicating data was fetched)
                            // Use strict comparison to catch undefined -> number transitions
                            const rankChanged = currentPlayer.currenttier !== lastPlayer.currenttier ||
                                currentPlayer.currenttierpatched !== lastPlayer.currenttierpatched;
                            const winRateChanged = currentPlayer.winRate !== lastPlayer.winRate;
                            const statsFetchedChanged = currentPlayer.statsFetched !== lastPlayer.statsFetched;
                            
                            if (rankChanged || winRateChanged || statsFetchedChanged) {
                                // Log the change for debugging (especially for local player)
                                if (currentPlayer.Subject === this.requests.puuid) {
                                    this.log(`[MENUS] Local player data changed - Rank: ${lastPlayer.currenttierpatched || 'N/A'} -> ${currentPlayer.currenttierpatched || 'N/A'}, WR: ${lastPlayer.winRate ?? 'N/A'} -> ${currentPlayer.winRate ?? 'N/A'}`);
                                }
                                playerDataChanged = true;
                                break;
                            }
                        } else {
                            // New player appeared - this should be caught by playersChanged, but check anyway
                            playerDataChanged = true;
                            break;
                        }
                    }
                }
                
                if (!playersChanged && !playerDataChanged) {
                    this.lastMatchData = newMatchData;
                    return;
                }
                if (playersChanged) {
                    this.log(`[MENUS] Party members changed: ${lastPlayerIds.size} -> ${currentPlayerIds.size} players`);
                } else if (playerDataChanged) {
                    this.log(`[MENUS] Player data updated (rank/stats fetched) - emitting matchData`);
                }
            }
        }

        this.lastMatchData = newMatchData;
        this.emit('matchData', this.lastMatchData);
    }

    private async processPlayer(player: CoregamePlayer | PregamePlayer | PartyMember, names: NamesMap, loadouts: LoadoutsMap, loadouts_data: LoadoutsData, Ranks: RanksMap, presence: Presence[] | null, skinDetails: Record<string, { skinName: string; skinVariant?: string; skinLevel?: string; skinImageUrl?: string }> = {}, team?: string, partyMembersList?: string[], queue?: string): Promise<Player> {
        const puuid = player.Subject || "";
        const rawName = names[puuid] || "";
        
        // Process name based on incognito mode and hide_names setting
        let displayName = rawName;
        const playerIdentity = player.PlayerIdentity as { Incognito?: boolean; HideAccountLevel?: boolean; PlayerCardID?: string; AccountLevel?: number } | undefined;
        const isIncognito = playerIdentity?.Incognito || false;
        const characterId = 'CharacterID' in player ? (player.CharacterID as string | undefined)?.toLowerCase() || "" : "";
        const agentId = characterId;
        const agentName = agentId ? (this.agentDict[agentId] || "Unknown") : "Unknown";
        const agentImageUrl = agentName ? (this.agentImages[agentName] || null) : null;
        
        if (team) {
            // Use namesClass.get_display_name to handle name hiding for incognito players
            displayName = this.namesClass.get_display_name(
                rawName,
                puuid,
                agentId,
                partyMembersList || [],
                isIncognito
            );
        }
        
        const name = displayName;
        
        // For PREGAME, INGAME, and MENUS, only fetch competitive stats
        const isPregameIngameOrMenus = this.currentGameState === "PREGAME" || this.currentGameState === "INGAME" || this.currentGameState === "MENUS";
        const competitiveOnly = isPregameIngameOrMenus;
        
        // Fetch rank and stats in parallel for faster loading, especially for enemies
        // Use Promise.allSettled so one failure doesn't block the others
        const [playerRankResult, previousPlayerRankResult, ppstatsResult] = await Promise.allSettled([
            this.rank.get_rank(puuid, this.seasonID),
            this.rank.get_rank(puuid, this.previousSeasonID),
            this.pstats.get_stats(puuid, queue, competitiveOnly)
        ]);
        
        // Extract results with fallbacks
        const playerRank = playerRankResult.status === 'fulfilled' ? playerRankResult.value : { rank: 0, rr: 0, leaderboard: 0, peakrank: 0, wr: undefined, numberofgames: 0, peakrankact: null, peakrankep: null, statusgood: false, statuscode: null };
        const previousPlayerRank = previousPlayerRankResult.status === 'fulfilled' ? previousPlayerRankResult.value : { rank: 0, rr: 0, leaderboard: 0, peakrank: 0, wr: 0, numberofgames: 0, peakrankact: null, peakrankep: null, statusgood: false, statuscode: null };
        const ppstats = ppstatsResult.status === 'fulfilled' ? ppstatsResult.value : { kd: "N/A", hs: "N/A", RankedRatingEarned: "N/A", AFKPenalty: "N/A" };
        
        // Log errors if any occurred
        if (playerRankResult.status === 'rejected') {
            this.log(`[RANK] Error fetching rank for ${name} (${puuid}): ${playerRankResult.reason}`);
        }
        if (previousPlayerRankResult.status === 'rejected') {
            this.log(`[RANK] Error fetching previous rank for ${name} (${puuid}): ${previousPlayerRankResult.reason}`);
        }
        if (ppstatsResult.status === 'rejected') {
            this.log(`[STATS] Error fetching stats for ${name} (${puuid}): ${ppstatsResult.reason}`);
        }
        
        // Log rank fetch result for debugging (especially for local player in MENUS)
        if (this.currentGameState === "MENUS" && puuid === this.requests.puuid) {
            this.log(`[RANK] Local player rank data - Tier: ${playerRank.rank}, RR: ${playerRank.rr}, WR: ${playerRank.wr} (${typeof playerRank.wr}), Games: ${playerRank.numberofgames}, Status: ${playerRank.statusgood}`);
        }
        
        // Log stats fetch result for debugging
        if (ppstats.kd === "N/A" && ppstats.hs === "N/A") {
            this.log(`[STATS] ${name} (${puuid}): Stats API returned N/A - no match history found. Queue: ${queue || 'undefined'}, CompetitiveOnly: ${competitiveOnly}`);
        } else if (typeof ppstats.kd === 'number' || typeof ppstats.hs === 'number') {
            this.log(`[STATS] ${name} (${puuid}): Stats loaded successfully - KD=${ppstats.kd}, HS=${ppstats.hs}, Queue: ${queue || 'undefined'}, CompetitiveOnly: ${competitiveOnly}`);
        } else {
            this.log(`[STATS] ${name} (${puuid}): Stats API returned unexpected format - KD=${ppstats.kd} (${typeof ppstats.kd}), HS=${ppstats.hs} (${typeof ppstats.hs}), Queue: ${queue || 'undefined'}`);
        }
        
        let level = player["PlayerIdentity"]?.AccountLevel || 0;
        if (level === 0 && this.currentGameState === "MENUS") {
            level = await this.menu.get_account_level(puuid);
        }
        
        // Get level border URL
        const levelBorderUrl = this.getLevelBorderUrl(level);

        // Skin info - extract plain string from colored string if needed
        let skinName = loadouts[puuid] || "";
        // If skinName is a colored string object, extract the text
        if (skinName && typeof skinName === 'object' && 'text' in skinName) {
            skinName = skinName.text || "";
        } else if (skinName && typeof skinName === 'string') {
            // Remove ANSI color codes if present
            skinName = skinName.replace(/\u001b\[[0-9;]*m/g, '');
        }
        
        // Get skin details (variant and level) if available
        const playerSkinDetails = skinDetails[puuid] || {};
        const finalSkinName = playerSkinDetails.skinName || skinName;
        
        // Check if player is a party member
        const isPartyMember = partyMembersList ? partyMembersList.includes(puuid) : false;
        
        // Extract party ID from presence data - matching Python implementation structure
        let partyId: string | undefined = undefined;
        if (presence && Array.isArray(presence)) {
            for (const pres of presence) {
                if (pres.puuid === puuid) {
                    try {
                        const decodedPresence = this.presences.decode_presence(pres.private || "");
                        
                        // Try nested structure first (partyPresenceData.partyId)
                        const partyPresenceData = decodedPresence.partyPresenceData as { partyId?: string | number } | undefined;
                        if (partyPresenceData && typeof partyPresenceData === 'object' && 'partyId' in partyPresenceData) {
                            const id = partyPresenceData.partyId;
                            if (id !== undefined && id !== null && id !== "") {
                                partyId = typeof id === 'string' ? id : (typeof id === 'number' ? String(id) : undefined);
                            }
                        }
                        
                        // Fallback: try flat structure (decodedPresence.partyId) - matching Python else-if logic
                        if (!partyId && "partyId" in decodedPresence) {
                            const id = decodedPresence.partyId;
                            if (id !== undefined && id !== null && id !== "" && id !== 0) {
                                partyId = typeof id === 'string' ? id : (typeof id === 'number' ? String(id) : undefined);
                            }
                        }
                    } catch {
                        // Ignore errors in party ID extraction
                    }
                    break;
                }
            }
        }
        
        const characterIdValue = 'CharacterID' in player ? ((player.CharacterID as string | undefined) || "") : "";
        const rankTier = typeof playerRank.rank === 'number' ? playerRank.rank : 0;
        const peakRankTier = typeof playerRank.peakrank === 'number' ? playerRank.peakrank : 0;
        const previousRankTier = typeof previousPlayerRank.rank === 'number' ? previousPlayerRank.rank : 0;
        
        // Only set stats to valid numbers - don't convert "N/A" or invalid strings to 0
        // This prevents stats from being reset to 0 during real-time updates
        let winRate = typeof playerRank.wr === 'number' ? playerRank.wr : undefined;
        
        // If win rate is undefined and this is the local player, try to fetch from Henrik Dev API
        if (winRate === undefined && puuid === this.requests.puuid && this.henrikApiKey && name && name.includes('#')) {
            try {
                const [gameName, tag] = name.split('#');
                if (gameName && tag) {
                    // Get region from requests or default to 'na'
                    const region = this.requests.region || 'na';
                    
                    // Fetch win rate from lifetime matches endpoint
                    const axios = require('axios');
                    const lifetimeUrl = `https://api.henrikdev.xyz/valorant/v1/by-puuid/lifetime/matches/${region}/${puuid}?mode=competitive&size=50`;
                    const lifetimeResponse = await axios.get(lifetimeUrl, {
                        headers: { 'Authorization': this.henrikApiKey },
                        timeout: 5000 // 5 second timeout
                    });
                    
                    if (lifetimeResponse.data && lifetimeResponse.data.status === 200 && lifetimeResponse.data.data && Array.isArray(lifetimeResponse.data.data) && lifetimeResponse.data.data.length > 0) {
                        // Calculate win rate from matches
                        let wins = 0;
                        let totalGames = 0;
                        
                        lifetimeResponse.data.data.forEach((matchData: any) => {
                            let playerData = null;
                            let playerTeam: string | null = null;
                            
                            // Try different API response structures
                            if (matchData.players && Array.isArray(matchData.players)) {
                                playerData = matchData.players.find((p: any) => p.puuid === puuid);
                                if (playerData) {
                                    playerTeam = playerData.team_id || playerData.team;
                                }
                            } else if (matchData.players && matchData.players.all_players) {
                                playerData = matchData.players.all_players.find((p: any) => p.puuid === puuid);
                                if (playerData) {
                                    playerTeam = playerData.team;
                                }
                            } else if (matchData.stats && matchData.stats.puuid === puuid) {
                                playerData = matchData.stats;
                                playerTeam = matchData.stats.team;
                            }
                            
                            if (playerData && playerTeam) {
                                totalGames++;
                                let won = false;
                                
                                if (matchData.teams) {
                                    if (Array.isArray(matchData.teams)) {
                                        const playerTeamObj = matchData.teams.find((t: any) => 
                                            (t.team_id === playerTeam) || 
                                            (t.team_id?.toLowerCase() === playerTeam?.toLowerCase())
                                        );
                                        if (playerTeamObj && playerTeamObj.won !== undefined) {
                                            won = playerTeamObj.won === true;
                                        }
                                    } else if (typeof matchData.teams === 'object') {
                                        if (typeof matchData.teams.red === 'number' && typeof matchData.teams.blue === 'number') {
                                            const redRounds = matchData.teams.red;
                                            const blueRounds = matchData.teams.blue;
                                            const isRed = playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'));
                                            won = (isRed && redRounds > blueRounds) || (!isRed && blueRounds > redRounds);
                                        } else if (matchData.teams.red?.has_won !== undefined) {
                                            const isRed = playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'));
                                            won = isRed ? matchData.teams.red.has_won : (matchData.teams.blue?.has_won || false);
                                        } else if (matchData.teams.red?.won !== undefined) {
                                            const isRed = playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'));
                                            won = isRed ? matchData.teams.red.won : (matchData.teams.blue?.won || false);
                                        } else {
                                            const redRounds = matchData.teams.red?.rounds_won || 0;
                                            const blueRounds = matchData.teams.blue?.rounds_won || 0;
                                            const isRed = playerTeam === 'Red' || (typeof playerTeam === 'string' && playerTeam.toLowerCase().includes('red'));
                                            won = (isRed && redRounds > blueRounds) || (!isRed && blueRounds > redRounds);
                                        }
                                    }
                                }
                                
                                if (won) {
                                    wins++;
                                }
                            }
                        });
                        
                        if (totalGames > 0) {
                            winRate = Math.floor((wins / totalGames) * 100);
                            this.log(`[STATS] Fetched win rate from Henrik Dev API for ${name}: ${winRate}% (${wins}W/${totalGames - wins}L from ${totalGames} matches)`);
                        }
                    }
                }
            } catch (error: unknown) {
                // Silently fail - this is a fallback, not critical
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log(`[STATS] Failed to fetch win rate from Henrik Dev API for ${name}: ${errorMessage}`);
            }
        }
        
        // Handle headshot percentage - only use if it's a valid number, otherwise undefined
        let headshotPercentage: number | undefined = undefined;
        if (typeof ppstats.hs === 'number') {
            headshotPercentage = ppstats.hs;
        } else if (ppstats.hs !== "N/A" && ppstats.hs !== undefined && typeof ppstats.hs === 'string') {
            const parsed = Number(ppstats.hs);
            if (!isNaN(parsed)) {
                headshotPercentage = parsed;
            }
        }
        
        // Handle KD - only use if it's a valid number, otherwise undefined
        let kd: number | undefined = undefined;
        if (typeof ppstats.kd === 'number') {
            kd = ppstats.kd;
        } else if (ppstats.kd !== "N/A" && ppstats.kd !== undefined && typeof ppstats.kd === 'string') {
            const parsed = Number(ppstats.kd);
            if (!isNaN(parsed)) {
                kd = parsed;
            }
        }
        
        const statsWereFetched = ppstatsResult.status === 'fulfilled';
        // hasCompetitiveStats should be true if we have valid stats (KD or HS as numbers, or not "N/A")
        // Only set to false if competitiveOnly is true AND we explicitly got "N/A" for both KD and HS
        const hasCompetitiveStats = competitiveOnly ? 
                                   (statsWereFetched && (typeof ppstats.kd === 'number' || typeof ppstats.hs === 'number' || 
                                    (ppstats.kd !== "N/A" && ppstats.hs !== "N/A" && ppstats.kd !== undefined && ppstats.hs !== undefined))) :
                                   undefined;
        
        return {
            Subject: puuid,
            Name: name || "",
            CharacterID: characterIdValue,
            AgentName: agentName,
            AgentImageUrl: agentImageUrl,
            PlayerIdentity: {
                AccountLevel: level,
                Incognito: playerIdentity?.Incognito || false,
                HideAccountLevel: playerIdentity?.HideAccountLevel || false,
                PlayerCardID: playerIdentity?.PlayerCardID || "",
                LevelBorderUrl: levelBorderUrl
            },
            currenttier: rankTier,
            currenttierpatched: Ranks[rankTier] || "",
            rankingInTier: typeof playerRank.rr === 'number' ? playerRank.rr : 0,
            peakrank: Ranks[peakRankTier] || "",
            peakrankTier: peakRankTier,
            peakrankep: typeof playerRank.peakrankep === 'string' ? playerRank.peakrankep : (typeof playerRank.peakrankep === 'number' ? String(playerRank.peakrankep) : ""),
            peakrankact: typeof playerRank.peakrankact === 'string' ? playerRank.peakrankact : (typeof playerRank.peakrankact === 'number' ? String(playerRank.peakrankact) : ""),
            previousRank: Ranks[previousRankTier] || "",
            leaderboard: typeof playerRank.leaderboard === 'number' ? playerRank.leaderboard : 0,
            // Set winRate - keep undefined if no data (UI will show "—" for undefined)
            // Only set to a number if we have actual win rate data (including 0% which is valid)
            winRate: winRate,
            numberofgames: typeof playerRank.numberofgames === 'number' ? playerRank.numberofgames : 0,
            headshotPercentage: headshotPercentage !== undefined ? headshotPercentage : 0,
            kd: kd !== undefined ? kd : 0,
            RankedRatingEarned: typeof ppstats.RankedRatingEarned === 'number' ? ppstats.RankedRatingEarned : "N/A",
            AFKPenalty: typeof ppstats.AFKPenalty === 'number' ? ppstats.AFKPenalty : "N/A",
            skinData: {
                skinName: finalSkinName || "",
                skinVariant: playerSkinDetails.skinVariant,
                skinLevel: playerSkinDetails.skinLevel,
                skinImageUrl: playerSkinDetails.skinImageUrl
            },
            loadout: (loadouts_data?.Players?.[puuid] as Record<string, unknown>) || {},
            isPartyMember: isPartyMember,
            partyId: partyId,
            statsFetched: statsWereFetched,
            hasCompetitiveStats: competitiveOnly ? hasCompetitiveStats : undefined
        };
    }

    private getLevelBorderUrl(level: number): string | null {
        if (!this.levelBorders || this.levelBorders.length === 0) {
            return null;
        }
        // Find the highest border that the player's level qualifies for
        // Borders are sorted descending, so we find the first one where level >= startingLevel
        for (const border of this.levelBorders) {
            if (level >= border.startingLevel) {
                return border.levelNumberAppearance;
            }
        }
        // If no border found, return the lowest one (last in sorted array)
        return this.levelBorders[this.levelBorders.length - 1]?.levelNumberAppearance || null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public getLatestData(): MatchData | null {
        return this.lastMatchData;
    }

    private async fetchHenrikMatch(matchId: string): Promise<unknown | null> {
        if (!matchId || matchId === "0" || !this.henrikApiKey) {
            return null;
        }

        try {
            const response = await axios.get(
                `https://api.henrikdev.xyz/valorant/v2/match/${matchId}`,
                {
                    headers: {
                        'Authorization': this.henrikApiKey
                    }
                }
            );
            
            if (response.data && response.status === 200) {
                this.log(`[HENRIK API] Successfully fetched match data for ${matchId}`);
                return response.data;
            }
            return null;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const statusText = error.response?.statusText;
                this.log(`[HENRIK API] Failed to fetch match ${matchId}: ${status} ${statusText || errorMessage}`);
            } else {
                this.log(`[HENRIK API] Failed to fetch match ${matchId}: ${errorMessage}`);
            }
            return null;
        }
    }

    public getRankImages(): Record<number, string> {
        return this.rankImages;
    }

    public getAgentImages(): Record<string, string> {
        return this.agentImages;
    }

    public async forceReprocess(): Promise<void> {
        if (!this.lastMatchData) {
            try {
                await this.processGameState();
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log(`[FORCE REPROCESS] Error calling processGameState(): ${errorMessage}`);
            }
        }
        
        const hasMatchData = this.lastMatchData && this.lastMatchData.Players && this.lastMatchData.Players.length > 0;
        const isInGameState = this.currentGameState === "INGAME" || this.lastMatchData?.state === "INGAME";
        const isNotLobby = !this.lastMatchData?.isLobby;
        const isInGame = hasMatchData && (isInGameState || isNotLobby);
        
        if (isInGame) {
            try {
                const match_id = await this.coregame.get_coregame_match_id();
                if (!match_id || match_id === "0" || !this.lastMatchData) {
                    return;
                }
                const Players = this.lastMatchData.Players.map((p) => ({
                    Subject: p.Subject,
                    CharacterID: p.CharacterID,
                    TeamID: p.team || "",
                    PlayerIdentity: p.PlayerIdentity
                }));
                
                const names: Record<string, string> = {};
                for (const player of this.lastMatchData.Players) {
                    names[player.Subject] = player.Name;
                }
                
                const loadouts_arr = await this.loadoutsClass.get_match_loadouts(match_id, Players as unknown as NamesPlayer[], this.cfg.weapon, this.valoApiSkins, names, "game");
                const skinDetails = (loadouts_arr[2] as Record<string, { skinName: string; skinVariant?: string; skinLevel?: string; skinImageUrl?: string }>) || {};
                
                const updatedPlayers = this.lastMatchData.Players.map((player) => {
                    const playerId = player.Subject;
                    return {
                        ...player,
                        skinData: skinDetails[playerId] || {
                            skinName: '',
                            skinVariant: undefined,
                            skinLevel: undefined,
                            skinImageUrl: undefined
                        }
                    };
                });
                
                this.lastMatchData = {
                    ...this.lastMatchData,
                    Players: updatedPlayers
                };
                
                this.emit('matchData', this.lastMatchData);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;
                this.log(`[FORCE REPROCESS] Error: ${errorMessage}${errorStack ? '\n' + errorStack : ''}`);
                throw error;
            }
        } else {
            this.log(`Skipping forceReprocess - not in-game (current state: ${this.currentGameState}) or no match data`);
        }
    }

    public async getMatchHistory(puuid: string, startIndex: number = 0, endIndex: number = 20, queue: string = 'competitive') {
        try {
            if (!this.requests?.lockfile) {
                this.log('Cannot get match history: Requests not initialized');
                return null;
            }
            
            const endpoint = `/match-history/v1/history/${puuid}?startIndex=${startIndex}&endIndex=${endIndex}&queue=${queue}`;
            const response = await this.requests.fetch('pd', endpoint, 'GET', 5);
            
            let responseData: unknown = null;
            if (response && typeof response === 'object') {
                if ('data' in response && response.data !== undefined) {
                    responseData = response.data;
                } else if ('response' in response && response.response && typeof response.response === 'object' && 'data' in response.response) {
                    responseData = (response.response as { data: unknown }).data;
                } else {
                    responseData = response;
                }
            }
            
            if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
                if ('History' in responseData) {
                    return responseData;
                }
                if ('history' in responseData) {
                    return { History: (responseData as { history: unknown }).history };
                }
                if ('data' in responseData && Array.isArray((responseData as { data: unknown }).data)) {
                    return { History: (responseData as { data: unknown[] }).data };
                }
            } else if (Array.isArray(responseData)) {
                return { History: responseData };
            }
            
            this.log('Match history response does not contain expected structure');
            return null;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error getting match history: ${errorMessage}`);
            return null;
        }
    }

    public async getLocalAccount() {
        try {
            if (!this.requests.headers || Object.keys(this.requests.headers).length === 0) {
                await this.requests.get_headers();
            }
            const puuid = this.requests.puuid;
            if (!puuid) return null;

            // Use get_multiple_names_from_puuid directly since we have a puuid string, not a player object
            const names = await this.namesClass.get_multiple_names_from_puuid([puuid]);
            const fullName = names[puuid];
            if (!fullName) return null;

            const [gameName, tagLine] = fullName.split('#');

            return {
                gameName,
                tagLine,
                fullName: fullName,
                puuid: puuid,
                region: this.requests.region
            };
        } catch (error) {
            this.log(`Error getting local account: ${error}`);
            return null;
        }
    }

    public getLastLockfileAccount(): string | null {
        return this.requests.getLastLockfileAccount();
    }

    public getPatchVersion(): string {
        try {
            const version = this.requests.get_current_version();
            if (!version) {
                return '6.9'; // Default fallback
            }
            
            // Parse version string like "release-06.09-shipping-..." or "release-6.9-shipping-..."
            // Extract patch number (e.g., "6.9" from "06.09" or "6.9")
            const match = version.match(/release-(\d+)\.(\d+)/);
            if (match) {
                const major = parseInt(match[1], 10).toString();
                const minor = parseInt(match[2], 10).toString();
                return `${major}.${minor}`;
            }
            
            // Fallback: try to find any X.Y pattern
            const fallbackMatch = version.match(/(\d+)\.(\d+)/);
            if (fallbackMatch) {
                const major = parseInt(fallbackMatch[1], 10).toString();
                const minor = parseInt(fallbackMatch[2], 10).toString();
                return `${major}.${minor}`;
            }
            
            return '6.9'; // Default fallback
        } catch (error) {
            this.log(`Error getting patch version: ${error}`);
            return '6.9'; // Default fallback
        }
    }

    public async getPatchImage(patchVersion: string): Promise<{ image: string | null; title: string | null; description: string | null; url: string | null } | null> {
        try {
            this.log(`Fetching latest game news from Henrik Dev API...`);
            
            // Get API key (use this.henrikApiKey if available, otherwise get from config)
            let apiKey = this.henrikApiKey;
            if (!apiKey || apiKey.length === 0) {
                const configResult = this.getConfig();
                // getConfig() can return either a string (during migration) or a config object
                apiKey = typeof configResult === 'string' ? configResult : configResult.henrikApiKey || '';
            }
            
            // If still no API key, try to get it from electron's getApiKey handler
            if (!apiKey || apiKey.length === 0) {
                try {
                    const { app, safeStorage } = require('electron');
                    const path = require('path');
                    const fs = require('fs');
                    
                    if (safeStorage.isEncryptionAvailable()) {
                        const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
                        if (fs.existsSync(keyPath)) {
                            const encrypted = fs.readFileSync(keyPath);
                            apiKey = safeStorage.decryptString(encrypted);
                            this.log('API key loaded from secure storage for patch notes');
                        }
                    }
                    
                    // If still no key, use embedded default
                    if (!apiKey || apiKey.length === 0) {
                        const { EMBEDDED_API_KEY } = require('./constants');
                        apiKey = EMBEDDED_API_KEY;
                        this.log('Using embedded default API key for patch notes');
                    }
                } catch (err: unknown) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    this.log(`Error loading API key for patch notes: ${errorMessage}`);
                    // Fall back to embedded key
                    const { EMBEDDED_API_KEY } = require('./constants');
                    apiKey = EMBEDDED_API_KEY;
                }
            }
            
            if (!apiKey || apiKey.length === 0) {
                this.log(`No Henrik API key found, cannot fetch game news`);
                return null;
            }
            
            // Default to en-us, but could be made configurable
            const countryCode = 'en-us';
            const apiUrl = `https://api.henrikdev.xyz/valorant/v1/website/${countryCode}`;
            
            this.log(`Fetching from: ${apiUrl}`);
            
            const response = await axios.get(apiUrl, {
                timeout: 30000,
                headers: {
                    'Authorization': apiKey
                }
            });
            
            if (response.data && response.data.status === 200 && response.data.data && Array.isArray(response.data.data)) {
                const articles = response.data.data;
                this.log(`Received ${articles.length} articles from API`);
                
                // Get the first (latest) article
                if (articles.length > 0) {
                    const firstArticle = articles[0];
                    this.log(`Using first article: ${firstArticle.title}`);
                    
                    const result = {
                        image: firstArticle.banner_url || null,
                        title: firstArticle.title || null,
                        description: firstArticle.description || firstArticle.category || null, // Try to get description if available
                        url: firstArticle.url || firstArticle.external_link || null
                    };
                    
                    this.log(`Returning patch data: image=${!!result.image}, title=${!!result.title}, url=${!!result.url}`);
                    return result;
                } else {
                    this.log(`No articles found in API response`);
                    return null;
                }
            } else {
                this.log(`Invalid API response format - status: ${response.data?.status}, hasData: ${!!response.data?.data}, isArray: ${Array.isArray(response.data?.data)}`);
                return null;
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            this.log(`Error getting patch image from Henrik API: ${errorMessage}`);
            if (errorStack) {
                this.log(`Stack trace: ${errorStack}`);
            }
            return null;
        }
    }

    public getConfig() {
        const { app, safeStorage } = require('electron');
        const path = require('path');
        const fs = require('fs');
        
        let henrikApiKey = '';
        
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
                if (fs.existsSync(keyPath)) {
                    const encrypted = fs.readFileSync(keyPath);
                    henrikApiKey = safeStorage.decryptString(encrypted);
                    this.log('API key loaded from secure storage');
                }
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.log(`Error reading from secure storage: ${errorMessage}`);
        }
        
        if (!henrikApiKey) {
            const userDataPath = app.getPath('userData');
            const userDataConfigPath = path.join(userDataPath, 'config.json');
            const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || app.getAppPath();
            const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'config.json');
            
            const possiblePaths = [
                path.join(process.cwd(), 'config.json'),
                userDataConfigPath,
                unpackedPath,
                path.join(app.getAppPath(), 'config.json'),
                path.join(resourcesPath, 'config.json'),
                path.join(__dirname, '..', '..', 'config.json'),
                path.join(__dirname, '..', 'config.json'),
            ];
            
            for (const configPath of possiblePaths) {
                try {
                    if (fs.existsSync(configPath)) {
                        const configContent = fs.readFileSync(configPath, 'utf-8');
                        const config = JSON.parse(configContent);
                        henrikApiKey = config.henrikApiKey || '';
                        if (henrikApiKey) {
                            this.log(`API key found in config.json at: ${configPath}`);
                            if (safeStorage.isEncryptionAvailable()) {
                                try {
                                        const encrypted = safeStorage.encryptString(henrikApiKey);
                                        if (encrypted) {
                                            const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
                                            fs.writeFileSync(keyPath, encrypted);
                                            delete config.henrikApiKey;
                                            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
                                            this.log('Migrated API key from config.json to secure storage');
                                            // Don't save config again at the end if we just migrated
                                            return henrikApiKey; // Return early to avoid duplicate save
                                        }
                                } catch (migrateErr: unknown) {
                                    const errorMessage = migrateErr instanceof Error ? migrateErr.message : String(migrateErr);
                                    this.log(`Failed to migrate API key to secure storage: ${errorMessage}`);
                                }
                            }
                            break;
                        }
                    }
                } catch (err: unknown) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    this.log(`Error checking path ${configPath}: ${errorMessage}`);
                }
            }
        }
        
        if (!henrikApiKey) {
            const { EMBEDDED_API_KEY } = require('./constants');
            henrikApiKey = EMBEDDED_API_KEY;
            // Only log once per app session
            if (!this.apiKeyLogged) {
                this.log('Using embedded default API key (no user key found)');
                this.apiKeyLogged = true;
            }
        } else {
            // Only log if this is a new/different API key
            if (!this.henrikApiKey || this.henrikApiKey !== henrikApiKey) {
                this.log(`API key loaded: ${henrikApiKey ? 'YES (length: ' + henrikApiKey.length + ')' : 'NO'}`);
                this.apiKeyLogged = true;
            }
        }
        
        // Store the API key to avoid duplicate logs
        this.henrikApiKey = henrikApiKey;

        const userDataPath = app.getPath('userData');
        const userDataConfigPath = path.join(userDataPath, 'config.json');
        const configPathForVisibility = app.isPackaged 
            ? userDataConfigPath
            : path.join(process.cwd(), 'config.json');
        
        const defaultVisibility: VisibilitySettings = {
            showKD: true,
            showHS: true,
            showWR: true,
            showRR: true,
            showSkin: true,
            showRank: true,
            showPeak: true,
            showLevel: true,
            showParty: true,
        };
        
        let visibilitySettings = defaultVisibility;
        if (fs.existsSync(configPathForVisibility)) {
            try {
                const configContent = fs.readFileSync(configPathForVisibility, 'utf-8');
                const config = JSON.parse(configContent) as ConfigData;
                visibilitySettings = {
                    showKD: config.showKD ?? true,
                    showHS: config.showHS ?? true,
                    showWR: config.showWR ?? true,
                    showRR: config.showRR ?? true,
                    showSkin: config.showSkin ?? true,
                    showRank: config.showRank ?? true,
                    showPeak: config.showPeak ?? true,
                    showLevel: config.showLevel ?? true,
                    showParty: config.showParty ?? true,
                };
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                this.log(`Error reading visibility settings: ${errorMessage}`);
            }
        }

        this.henrikApiKey = henrikApiKey;

        return {
            region: this.requests.region,
            streamerMode: false,
            autoRefresh: true,
            selectedGun: this.cfg.weapon,
            henrikApiKey: henrikApiKey,
            ...visibilitySettings,
        };
    }

    public saveConfig(newConfig: Partial<ConfigData>) {
        const path = require('path');
        const fs = require('fs');
        const { app, safeStorage } = require('electron');
        
        const configPath = app.isPackaged 
            ? path.join(app.getPath('userData'), 'config.json')
            : path.join(process.cwd(), 'config.json');
        
        let config: ConfigData = {};
        if (fs.existsSync(configPath)) {
            try {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                config = JSON.parse(configContent) as ConfigData;
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                this.log(`Error reading config: ${errorMessage}`);
            }
        }
        
        if (newConfig.selectedGun && typeof newConfig.selectedGun === 'string') {
            this.cfg.weapon = newConfig.selectedGun;
            config.weapon = newConfig.selectedGun;
        }
        
        const visibilityKeys: (keyof VisibilitySettings)[] = ['showKD', 'showHS', 'showWR', 'showRR', 'showSkin', 'showRank', 'showPeak', 'showLevel', 'showParty'];
        for (const key of visibilityKeys) {
            if (newConfig[key] !== undefined) {
                config[key] = newConfig[key];
            }
        }
        
        if (newConfig.henrikApiKey !== undefined) {
            try {
                if (safeStorage.isEncryptionAvailable()) {
                    const encrypted = safeStorage.encryptString(newConfig.henrikApiKey);
                    const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
                    fs.writeFileSync(keyPath, encrypted);
                    this.log('API key saved to secure storage');
                    if (config.henrikApiKey) {
                        delete config.henrikApiKey;
                    }
                } else {
                    this.log('Warning: Secure storage not available, saving to config.json (not recommended)');
                    config.henrikApiKey = newConfig.henrikApiKey;
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                this.log(`Error saving API key: ${errorMessage}`);
            }
        }
        
        try {
            // Only save if config actually changed (avoid duplicate saves)
            let shouldSave = true;
            if (fs.existsSync(configPath)) {
                try {
                    const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                    shouldSave = JSON.stringify(config) !== JSON.stringify(existingConfig);
                } catch {
                    shouldSave = true;
                }
            }
            if (shouldSave) {
                fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
                this.log(`Saved config to: ${configPath}`);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.log(`Error saving config file: ${errorMessage}`);
        }
    }
}


