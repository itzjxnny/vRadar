import { Requests } from './requestsV';
import { Content } from './content';

export interface RankData {
    rank: number;
    rr: number;
    leaderboard: number;
    peakrank: number;
    wr: number | string | undefined;
    numberofgames: number;
    peakrankact: string | null;
    peakrankep: string | null;
    statusgood: boolean | null;
    statuscode: number | null;
}

interface WinsByTier {
    [tier: string]: number;
}

interface SeasonalInfo {
    CompetitiveTier?: number;
    RankedRating?: number;
    LeaderboardRank?: number;
    NumberOfWinsWithPlacements?: number;
    NumberOfGames?: number;
    WinsByTier?: WinsByTier;
    [key: string]: unknown;
}

interface QueueSkills {
    competitive?: {
        SeasonalInfoBySeasonID?: Record<string, SeasonalInfo>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface RankResponse {
    status?: number;
    data?: {
        QueueSkills?: QueueSkills;
        [key: string]: unknown;
    };
    QueueSkills?: QueueSkills;
    [key: string]: unknown;
}

export class Rank {
    Requests: Requests;
    log: (msg: string) => void;
    ranks_before: string[];
    content: Content;
    requestMap: Record<string, RankResponse>;

    constructor(Requests: Requests, log: (msg: string) => void, content: Content, ranks_before: string[]) {
        this.Requests = Requests;
        this.log = log;
        this.ranks_before = ranks_before;
        this.content = content;
        this.requestMap = {};
    }

    private isSuccessResponse(response: RankResponse | null): boolean {
        if (!response) return false;
        if (response.status === 200) return true;
        const dataStatus = response.data && typeof response.data === 'object' && 'status' in response.data 
            ? (response.data as { status?: number }).status 
            : undefined;
        return dataStatus === 200;
    }

    private async get_request(puuid: string): Promise<RankResponse> {
        const cached = this.requestMap[puuid];
        if (cached && this.isSuccessResponse(cached)) {
            return cached;
        }

        try {
            const response = await this.Requests.fetch('pd', `/mmr/v1/players/${puuid}`, "get") as RankResponse;
            if (this.isSuccessResponse(response)) {
                this.requestMap[puuid] = response;
            }
            return response;
        } catch (error) {
            throw error;
        }
    }

    invalidate_cached_responses(): void {
        this.requestMap = {};
    }

    private getQueueSkills(response: RankResponse | null): QueueSkills['competitive'] | null {
        if (!response) return null;
        const r = response.data || response;
        return r.QueueSkills?.competitive || null;
    }

    private extractCurrentRank(seasonData: SeasonalInfo | undefined): { rank: number; rr: number; leaderboard: number } {
        if (!seasonData) {
            return { rank: 0, rr: 0, leaderboard: 0 };
        }

        const rankTIER = seasonData.CompetitiveTier;
        if (rankTIER === undefined) {
            return { rank: 0, rr: 0, leaderboard: 0 };
        }

        if (rankTIER >= 21) {
            return {
                rank: rankTIER,
                rr: seasonData.RankedRating || 0,
                leaderboard: seasonData.LeaderboardRank || 0,
            };
        }

        if (rankTIER !== 0 && rankTIER !== 1 && rankTIER !== 2) {
            return {
                rank: rankTIER,
                rr: seasonData.RankedRating || 0,
                leaderboard: 0,
            };
        }

        return { rank: 0, rr: 0, leaderboard: 0 };
    }

    async get_rank(puuid: string, seasonID: string): Promise<RankData> {
        const final: RankData = {
            rank: 0,
            rr: 0,
            leaderboard: 0,
            peakrank: 0,
            wr: undefined,
            numberofgames: 0,
            peakrankact: null,
            peakrankep: null,
            statusgood: null,
            statuscode: null,
        };

        let response: RankResponse | null = null;
        try {
            response = await this.get_request(puuid);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching rank data: ${errorMessage}`);
            return final;
        }

        if (!this.isSuccessResponse(response)) {
            this.log("failed getting rank");
            if (response?.data) {
                this.log(JSON.stringify(response.data));
            }
            final.statusgood = false;
            final.statuscode = response?.status || null;
            return final;
        }

        const queueSkills = this.getQueueSkills(response);
        const seasonData = queueSkills?.SeasonalInfoBySeasonID?.[seasonID];
        const currentRank = this.extractCurrentRank(seasonData);
        final.rank = currentRank.rank;
        final.rr = currentRank.rr;
        final.leaderboard = currentRank.leaderboard;

        let max_rank = final.rank;
        let max_rank_season = seasonID;
        
        try {
            const seasons = queueSkills?.SeasonalInfoBySeasonID;
            if (seasons) {
                for (const [season, seasonInfo] of Object.entries(seasons)) {
                    const winsByTier = seasonInfo?.WinsByTier;
                    if (winsByTier) {
                        for (const tierStr of Object.keys(winsByTier)) {
                            let tier = parseInt(tierStr, 10);
                            if (this.ranks_before.includes(season) && tier > 20) {
                                tier += 3;
                            }
                            if (tier > max_rank) {
                                max_rank = tier;
                                max_rank_season = season;
                            }
                        }
                    }
                }
            }
        } catch {
            // Keep default max_rank
        }
        final.peakrank = max_rank;

        try {
            if (seasonData) {
                const wins = seasonData.NumberOfWinsWithPlacements;
                const total_games = seasonData.NumberOfGames || 0;
                final.numberofgames = total_games;
                
                if (wins !== undefined && total_games > 0) {
                    final.wr = Math.floor((wins / total_games) * 100);
                } else {
                    // No games played - return undefined so UI can show "—"
                    final.wr = undefined;
                }
            }
        } catch {
            final.wr = undefined;
        }

        final.statusgood = response?.status === 200;
        final.statuscode = response?.status || null;

        try {
            const contentData = await this.content.get_content();
            const peak_rank_act_ep = this.content.get_act_episode_from_act_id(contentData, max_rank_season);
            final.peakrankact = peak_rank_act_ep.act ? String(peak_rank_act_ep.act) : null;
            final.peakrankep = peak_rank_act_ep.episode ? String(peak_rank_act_ep.episode) : null;
        } catch {
            final.peakrankact = null;
            final.peakrankep = null;
        }

        return final;
    }
}

