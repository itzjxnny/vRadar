import { Requests } from '../requestsV';
import { Presences } from '../presences';
import { Presence } from '../presences';

interface AccountLevelResponse {
    Progress?: {
        Level?: number;
    };
    [key: string]: unknown;
}

interface PresenceData {
    partyId: string;
    accountLevel: number;
    playerCardId: string;
}

export interface PartyMember {
    Subject: string;
    PlayerIdentity: {
        AccountLevel: number;
        PlayerCardID: string;
    };
}

export class Menu {
    Requests: Requests;
    log: (msg: string) => void;
    presences: Presences;

    constructor(Requests: Requests, log: (msg: string) => void, presences: Presences) {
        this.Requests = Requests;
        this.log = log;
        this.presences = presences;
    }

    async get_account_level(puuid: string): Promise<number> {
        try {
            const response = await this.Requests.fetch("pd", `/account-xp/v1/players/${puuid}`, "get");
            const responseWithData = response as { data?: AccountLevelResponse } | AccountLevelResponse;
            const data = ('data' in responseWithData && responseWithData.data) 
                ? responseWithData.data 
                : (responseWithData as AccountLevelResponse);
            
            if (data && typeof data === 'object' && 'Progress' in data) {
                const progress = data.Progress;
                if (progress && typeof progress === 'object' && 'Level' in progress && typeof progress.Level === 'number') {
                    return progress.Level;
                }
            }
        } catch {
            // Expected when account level can't be fetched
        }
        return 0;
    }

    private extractPresenceData(decodedPresence: ReturnType<Presences['decode_presence']>): PresenceData {
        const partyPresenceData = decodedPresence.partyPresenceData as { partyId?: string } | undefined;
        const playerPresenceData = decodedPresence.playerPresenceData as { accountLevel?: number; playerCardId?: string } | undefined;
        
        if (partyPresenceData && typeof partyPresenceData === 'object') {
            return {
                partyId: partyPresenceData.partyId || "",
                accountLevel: playerPresenceData?.accountLevel || 0,
                playerCardId: playerPresenceData?.playerCardId || ""
            };
        } else if ("partyId" in decodedPresence) {
            return {
                partyId: (decodedPresence.partyId as string) || "",
                accountLevel: (decodedPresence.accountLevel as number) || 0,
                playerCardId: (decodedPresence.playerCardId as string) || ""
            };
        }
        
        return { partyId: "", accountLevel: 0, playerCardId: "" };
    }

    get_party_members(self_puuid: string, presencesDICT: Presence[]): PartyMember[] {
        const res: PartyMember[] = [];
        const seen = new Set<string>();
        let party_id = "";
        
        // First pass: find self and get party_id
        for (const presence of presencesDICT) {
            if (presence.puuid === self_puuid && !seen.has(self_puuid)) {
                const decodedPresence = this.presences.decode_presence(presence.private || "");
                const data = this.extractPresenceData(decodedPresence);
                party_id = data.partyId;
                
                res.push({
                    Subject: presence.puuid || "",
                    PlayerIdentity: {
                        AccountLevel: data.accountLevel,
                        PlayerCardID: data.playerCardId
                    }
                });
                seen.add(self_puuid);
            }
        }
        
        // If user's presence wasn't found, add them anyway
        if (!seen.has(self_puuid)) {
            res.push({
                Subject: self_puuid,
                PlayerIdentity: { AccountLevel: 0, PlayerCardID: "" }
            });
            seen.add(self_puuid);
        }
        
        // Second pass: Find other party members
        for (const presence of presencesDICT) {
            const puuid = presence.puuid;
            if (!puuid || puuid === self_puuid || seen.has(puuid)) {
                continue;
            }
            
            const decodedPresence = this.presences.decode_presence(presence.private || "");
            const data = this.extractPresenceData(decodedPresence);
            
            if (data.partyId === party_id) {
                res.push({
                    Subject: puuid,
                    PlayerIdentity: {
                        AccountLevel: data.accountLevel,
                        PlayerCardID: data.playerCardId
                    }
                });
                seen.add(puuid);
            }
        }
        
        return res;
    }
}

