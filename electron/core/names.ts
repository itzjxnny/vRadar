import axios from 'axios';
import * as https from 'https';
import { Requests } from './requestsV';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

export interface Player {
    Subject: string;
    GameName?: string;
    TagLine?: string;
    [key: string]: unknown;
}

interface NameServiceResponse {
    Subject: string;
    GameName: string;
    TagLine: string;
    [key: string]: unknown;
}

interface ErrorResponse {
    errorCode?: string;
    message?: string;
    [key: string]: unknown;
}

export class Names {
    Requests: Requests;
    log: (msg: string) => void;
    hide_names: boolean;
    agent_dict: Record<string, string>;

    constructor(Requests: Requests, log: (msg: string) => void, hide_names: boolean = false, agent_dict: Record<string, string> = {}) {
        this.Requests = Requests;
        this.log = log;
        this.hide_names = hide_names;
        this.agent_dict = agent_dict;
    }

    set_agent_dict(agent_dict: Record<string, string>): void {
        this.agent_dict = agent_dict;
    }

    get_display_name(
        name: string,
        playerPuuid: string,
        agent?: string,
        party_members?: string[],
        incognito?: boolean
    ): string {
        // Only hide names if player has incognito/streamer mode enabled AND hide_names is true
        // Don't hide names for party members
        if (incognito && this.hide_names) {
            if (!party_members || !party_members.includes(playerPuuid)) {
                // If agent is available, use agent name
                if (agent !== undefined && agent !== "") {
                    const agentName = this.agent_dict[agent.toLowerCase()];
                    if (agentName && agentName !== "") {
                        return agentName;
                    }
                }
                // If agent not selected yet (e.g., in pregame), use generic "Player" placeholder
                return "Player";
            }
        }
        return name;
    }

    private buildNameDict(responseData: NameServiceResponse[]): Record<string, string> {
        const name_dict: Record<string, string> = {};
        for (const player of responseData) {
            name_dict[player.Subject] = `${player.GameName}#${player.TagLine}`;
        }
        return name_dict;
    }

    private buildFallbackDict(puuids: string[]): Record<string, string> {
        const fallback_dict: Record<string, string> = {};
        for (const puuid of puuids) {
            fallback_dict[puuid] = puuid.substring(0, 8) + "...";
        }
        return fallback_dict;
    }

    async get_multiple_names_from_puuid(puuids: string[]): Promise<Record<string, string>> {
        const validPuuids = puuids.filter((puuid): puuid is string => 
            puuid !== null && puuid !== undefined && typeof puuid === 'string' && puuid.length > 0
        );
        
        if (validPuuids.length === 0) {
            return {};
        }
        
        const makeRequest = async (refreshToken: boolean = false): Promise<NameServiceResponse[]> => {
            const response = await axios.put(
                this.Requests.pd_url + "/name-service/v2/players",
                validPuuids,
                {
                    headers: await this.Requests.get_headers(refreshToken),
                    httpsAgent: httpsAgent
                }
            );

            // Check if response has error code (some APIs return 200 with errorCode)
            if (response.data && (response.data as unknown as ErrorResponse).errorCode) {
                if (!refreshToken) {
                    this.log(`${(response.data as unknown as ErrorResponse).errorCode}, refreshing token`);
                    return makeRequest(true);
                }
            }

            return response.data as NameServiceResponse[];
        };
        
        try {
            const responseData = await makeRequest();
            return this.buildNameDict(responseData);
        } catch (error: unknown) {
            // Handle 400 errors (like BAD_CLAIMS) by refreshing token and retrying
            if (axios.isAxiosError(error) && error.response?.status === 400) {
                const errorData = error.response.data as ErrorResponse;
                if (errorData?.errorCode === 'BAD_CLAIMS' || errorData?.message?.includes('token')) {
                    this.log(`Token error (${errorData.errorCode || errorData.message}), refreshing token`);
                    try {
                        this.Requests.headers = {};
                        this.Requests.lockfile = this.Requests.get_lockfile();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        const refreshedHeaders = await this.Requests.get_headers(true);
                        const response = await axios.put<NameServiceResponse[]>(
                            this.Requests.pd_url + "/name-service/v2/players",
                            validPuuids,
                            {
                                headers: refreshedHeaders,
                                httpsAgent: httpsAgent
                            }
                        );
                        return this.buildNameDict(response.data);
                    } catch (retryError: unknown) {
                        const errorMessage = axios.isAxiosError(retryError) 
                            ? (retryError.response?.data as ErrorResponse)?.errorCode || retryError.message || 'Unknown error'
                            : retryError instanceof Error ? retryError.message : 'Unknown error';
                        this.log(`Failed to get names after token refresh: ${errorMessage}`);
                    }
                }
            }
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching names: ${errorMessage}, using PUUIDs as fallback`);
            return this.buildFallbackDict(validPuuids);
        }
    }

    async get_names_from_puuids(players: Player[]): Promise<Record<string, string>> {
        const puuids = Array.from(new Set(
            players
                .filter(p => p?.Subject && typeof p.Subject === 'string')
                .map(p => p.Subject)
        ));
        
        return this.get_multiple_names_from_puuid(puuids);
    }

    get_players_puuid(Players: Player[]): string[] {
        return Players.map(player => player.Subject);
    }
}

