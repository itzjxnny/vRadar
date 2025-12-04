import { Requests } from './requestsV';

export interface Presence {
    puuid?: string;
    private?: string;
    get?: (key: string) => unknown;
    championId?: unknown;
    product?: string;
    [key: string]: unknown;
}

interface PresenceResponse {
    presences?: Presence[];
    [key: string]: unknown;
}

interface MatchPresenceData {
    sessionLoopState?: string;
    [key: string]: unknown;
}

interface PrivatePresence {
    matchPresenceData?: MatchPresenceData;
    sessionLoopState?: string;
    [key: string]: unknown;
}

interface DecodedPresence {
    isValid?: boolean;
    partyId?: string | number;
    partySize?: number;
    partyVersion?: number;
    partyPresenceData?: unknown;
    [key: string]: unknown;
}

export class Presences {
    Requests: Requests;
    log: (msg: string) => void;

    constructor(Requests: Requests, log: (msg: string) => void) {
        this.Requests = Requests;
        this.log = log;
    }

    async get_presence(): Promise<Presence[] | null> {
        const presences = await this.Requests.fetch("local", "/chat/v4/presences", "get");
        if (presences === null) {
            return null;
        }
        const response = presences as PresenceResponse;
        return response.presences || null;
    }

    get_game_state(presences: Presence[]): string | null {
        const private_presence = this.get_private_presence(presences);
        if (!private_presence) {
            return null;
        }
        
        if (private_presence.matchPresenceData?.sessionLoopState) {
            return private_presence.matchPresenceData.sessionLoopState;
        }
        
        if (private_presence.sessionLoopState) {
            return private_presence.sessionLoopState;
        }
        
        this.log("ERROR: Unknown presence API structure in 'get_game_state'.");
        return null;
    }

    get_private_presence(presences: Presence[]): PrivatePresence | null {
        for (const presence of presences) {
            if (presence.puuid !== this.Requests.puuid) {
                continue;
            }
            
            // Skip League of Legends presences
            if (presence.get?.("championId") !== undefined || 
                presence.get?.("product") === "league_of_legends" || 
                presence.championId !== undefined || 
                presence.product === "league_of_legends") {
                return null;
            }
            
            if (!presence.private || presence.private === "") {
                return null;
            }
            
            try {
                const decoded = Buffer.from(presence.private, 'base64').toString('utf-8');
                return JSON.parse(decoded) as PrivatePresence;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log(`Error decoding presence: ${errorMessage}`);
                return null;
            }
        }
        return null;
    }

    decode_presence(private_data: string): DecodedPresence {
        const emptyPresence: DecodedPresence = {
            isValid: false,
            partyId: 0,
            partySize: 0,
            partyVersion: 0,
        };
        
        if (!private_data || typeof private_data !== 'string' || private_data === "" || private_data.includes('{')) {
            return emptyPresence;
        }
        
        try {
            const decoded = Buffer.from(private_data, 'base64').toString('utf-8');
            const dict = JSON.parse(decoded) as DecodedPresence;
            return dict.isValid === true ? dict : { ...dict, isValid: false };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error decoding presence: ${errorMessage}`);
            return emptyPresence;
        }
    }

    async wait_for_presence(PlayersPuuids: string[]): Promise<void> {
        const maxAttempts = 10;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            const presence = await this.get_presence();
            if (!presence) {
                attempts++;
                await this.sleep(1000);
                continue;
            }
            
            const presenceStr = JSON.stringify(presence);
            const allFound = PlayersPuuids.every(puuid => presenceStr.includes(puuid));
            
            if (allFound) {
                return;
            }
            
            attempts++;
            await this.sleep(1000);
        }
        
        this.log(`Warning: Not all players found in presence after ${maxAttempts} attempts, continuing anyway`);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

