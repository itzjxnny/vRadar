import { Requests } from '../requestsV';

interface PregameResponse {
    MatchID?: string;
    errorCode?: string;
    [key: string]: unknown;
}

export class Pregame {
    log: (msg: string) => void;
    Requests: Requests;

    constructor(Requests: Requests, log: (msg: string) => void) {
        this.log = log;
        this.Requests = Requests;
    }

    async get_pregame_match_id(): Promise<string> {
        try {
            const response = await this.Requests.fetch("glz", `/pregame/v1/players/${this.Requests.puuid}`, "get") as PregameResponse;
            
            if (response?.errorCode === "RESOURCE_NOT_FOUND") {
                return "0";
            }
            
            return response.MatchID || "0";
        } catch {
            // Expected when not in pregame - return "0" silently
            return "0";
        }
    }

    async get_pregame_stats(): Promise<PregameResponse | null> {
        const match_id = await this.get_pregame_match_id();
        if (match_id === "0") {
            return null;
        }
        
        // Add timestamp query parameter to bypass caching and ensure fresh data
        const timestamp = Date.now();
        try {
            return await this.Requests.fetch("glz", `/pregame/v1/matches/${match_id}?t=${timestamp}`, "get") as PregameResponse;
        } catch {
            return null;
        }
    }
}

