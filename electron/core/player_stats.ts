import { Requests } from './requestsV';

export interface PlayerStatsData {
    kd: number | string;
    hs: number | string;
    RankedRatingEarned: number | string;
    AFKPenalty: number | string;
}

interface Damage {
    legshots?: number;
    bodyshots?: number;
    headshots?: number;
    [key: string]: unknown;
}

interface RoundPlayerStats {
    subject?: string;
    damage?: Damage[];
    [key: string]: unknown;
}

interface RoundResult {
    playerStats?: RoundPlayerStats[];
    [key: string]: unknown;
}

interface PlayerMatchStats {
    kills?: number;
    deaths?: number;
    [key: string]: unknown;
}

interface MatchPlayer {
    subject?: string;
    stats?: PlayerMatchStats;
    [key: string]: unknown;
}

interface MatchData {
    roundResults?: RoundResult[];
    players?: MatchPlayer[];
    [key: string]: unknown;
}

interface MatchSummary {
    RankedRatingEarned?: number | string;
    AFKPenalty?: number | string;
    MatchID?: string;
    [key: string]: unknown;
}

export class PlayerStats {
    Requests: Requests;
    log: (msg: string) => void;
    private requestMap: Record<string, PlayerStatsData>;

    constructor(Requests: Requests, log: (msg: string) => void) {
        this.Requests = Requests;
        this.log = log;
        this.requestMap = {};
    }

    invalidate_cached_responses(): void {
        this.requestMap = {};
    }

    private getEmptyStats(): PlayerStatsData {
        return {
            kd: "N/A",
            hs: "N/A",
            RankedRatingEarned: "N/A",
            AFKPenalty: "N/A",
        };
    }

    private extractMatches(response: unknown): MatchSummary[] {
        const data = ('data' in (response as object) && (response as { data?: { Matches?: MatchSummary[] } }).data) 
            ? (response as { data: { Matches?: MatchSummary[] } }).data 
            : response as { Matches?: MatchSummary[] };
        return data?.Matches || [];
    }

    private extractMatchData(response: unknown): MatchData | null {
        const responseObj = response as { status?: number; data?: MatchData | { status?: number } };
        const responseStatus = responseObj.status;
        const responseData = responseObj.data;
        const responseDataStatus = (responseData && typeof responseData === 'object' && 'status' in responseData) 
            ? (responseData as { status?: number }).status 
            : undefined;
        
        if (responseStatus === 404 || responseDataStatus === 404) {
            return null;
        }
        
        return (responseData && !('status' in responseData)) 
            ? responseData as MatchData
            : response as MatchData;
    }

    private async fetchMatchStats(puuid: string, queue: string): Promise<PlayerStatsData | null> {
        try {
            const response = await this.Requests.fetch(
                "pd",
                `/mmr/v1/players/${puuid}/competitiveupdates?startIndex=0&endIndex=1&queue=${queue}`,
                "get",
            );
            
            const matches = this.extractMatches(response);
            if (matches.length === 0) {
                return null;
            }

            const match_id = matches[0]?.MatchID;
            if (!match_id) {
                return null;
            }

            const match_response = await this.Requests.fetch(
                "pd",
                `/match-details/v1/matches/${match_id}`,
                "get",
            );

            const match_data = this.extractMatchData(match_response);
            if (!match_data) {
                return null;
            }

            const matchSummary: MatchSummary = queue === "competitive" 
                ? matches[0] as MatchSummary
                : { RankedRatingEarned: "N/A", AFKPenalty: "N/A" };
            
            return this._process_match_data(puuid, match_data, matchSummary);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching ${queue} stats: ${errorMessage}`);
            return null;
        }
    }

    async get_stats(puuid: string, queue?: string, competitiveOnly?: boolean): Promise<PlayerStatsData> {
        // Return cached response if available (but only if it has actual stats, not all N/A)
        // Include queue in cache key to avoid mixing competitive and unrated stats
        // For competitive-only mode, use a special cache key
        const cacheKey = competitiveOnly ? `${puuid}:competitive-only` : (queue ? `${puuid}:${queue}` : puuid);
        const cached = this.requestMap[cacheKey];
        if (cached) {
            // Only use cache if we have actual numeric stats (KD or HS is a number, not "N/A")
            const hasStats = (typeof cached.kd === 'number' && cached.kd > 0) || 
                           (typeof cached.hs === 'number' && cached.hs > 0);
            if (hasStats) {
                return cached;
            }
            // If cached result is all N/A, don't use cache - allow retry (might have been a temporary failure)
        }
        // Always fetch stats for React UI

        // If competitiveOnly is true, only fetch competitive stats (no fallback to unrated)
        if (competitiveOnly) {
            const result = await this.fetchMatchStats(puuid, "competitive");
            if (result) {
                this.requestMap[cacheKey] = result;
                return result;
            }
            const emptyStats = this.getEmptyStats();
            this.requestMap[cacheKey] = emptyStats;
            return emptyStats;
        }

        // Determine which queue to try first based on current game mode
        const primaryQueue = queue === "unrated" ? "unrated" : "competitive";
        const fallbackQueue = queue === "unrated" ? "competitive" : "unrated";

        // Try primary queue first
        const primaryResult = await this.fetchMatchStats(puuid, primaryQueue);
        if (primaryResult) {
            this.requestMap[cacheKey] = primaryResult;
            return primaryResult;
        }

        // Fallback to secondary queue
        const fallbackResult = await this.fetchMatchStats(puuid, fallbackQueue);
        if (fallbackResult) {
            this.requestMap[cacheKey] = fallbackResult;
            return fallbackResult;
        }

        // No matches found in either queue
        const emptyStats = this.getEmptyStats();
        this.requestMap[cacheKey] = emptyStats;
        return emptyStats;
    }

    private _process_match_data(puuid: string, match_data: MatchData, match_summary: MatchSummary): PlayerStatsData {
        let total_hits = 0;
        let total_headshots = 0;
        let kills = 0;
        let deaths = 0;

        // Extract round stats
        const roundResults = match_data?.roundResults || [];
        for (const round of roundResults) {
            const playerStats = round?.playerStats || [];
            for (const player of playerStats) {
                if (player.subject === puuid) {
                    const damage = player.damage || [];
                    for (const hits of damage) {
                        total_hits += (hits.legshots || 0) + (hits.bodyshots || 0) + (hits.headshots || 0);
                        total_headshots += hits.headshots || 0;
                    }
                }
            }
        }

        // Extract overall player stats
        const players = match_data?.players || [];
        for (const player of players) {
            if (player.subject === puuid) {
                kills = player.stats?.kills || 0;
                deaths = player.stats?.deaths || 0;
                break;
            }
        }

        // Calculate KD
        const kd = deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills;

        const result: PlayerStatsData = {
            kd: kd,
            hs: total_hits > 0 ? Math.floor((total_headshots / total_hits) * 100) : "N/A",
            RankedRatingEarned: match_summary?.RankedRatingEarned ?? "N/A",
            AFKPenalty: match_summary?.AFKPenalty ?? "N/A",
        };
        return result;
    }
}

