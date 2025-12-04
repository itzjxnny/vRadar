import { Requests } from '../requestsV';

interface CoregameResponse {
    MatchID?: string;
    MapID?: string;
    errorCode?: string;
    [key: string]: unknown;
}

export class Coregame {
    log: (msg: string) => void;
    Requests: Requests;

    constructor(Requests: Requests, log: (msg: string) => void) {
        this.log = log;
        this.Requests = Requests;
    }

    async get_coregame_match_id(): Promise<string> {
        try {
            const response = await this.Requests.fetch("glz", `/core-game/v1/players/${this.Requests.puuid}`, "get") as CoregameResponse;
            
            if (response?.errorCode === "RESOURCE_NOT_FOUND") {
                return "0";
            }
            
            return response.MatchID || "0";
        } catch (error) {
            // Expected when not in a match - return "0" silently
            return "0";
        }
    }

    async get_coregame_stats(): Promise<CoregameResponse | null> {
        const match_id = await this.get_coregame_match_id();
        if (match_id === "0") {
            return null;
        }
        
        try {
            return await this.Requests.fetch("glz", `/core-game/v1/matches/${match_id}`, "get") as CoregameResponse;
        } catch {
            return null;
        }
    }

    async get_current_map(map_urls: Record<string, string>, map_splashes: Record<string, string>): Promise<{ name: string; splash: string } | string> {
        const coregame_stats = await this.get_coregame_stats();
        if (!coregame_stats?.MapID) {
            return 'N/A';
        }
        
        const mapId = coregame_stats.MapID.toLowerCase();
        const current_map = map_urls[mapId];
        
        if (!current_map) {
            return 'N/A';
        }
        
        return { name: current_map, splash: map_splashes[current_map] || '' };
    }
}

