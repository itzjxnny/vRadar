import axios from 'axios';
import { Requests } from './requestsV';

interface Season {
    ID: string;
    IsActive?: boolean;
    Type?: string;
    StartTime?: string;
    EndTime?: string;
    Name?: string;
    [key: string]: unknown;
}

interface ContentData {
    Seasons?: Season[];
    [key: string]: unknown;
}

interface Agent {
    uuid: string;
    displayName: string;
    displayIcon?: string;
    [key: string]: unknown;
}

interface AgentApiResponse {
    data: Agent[];
}

interface Map {
    mapUrl?: string;
    displayName: string;
    splash?: string;
    [key: string]: unknown;
}

interface MapApiResponse {
    data: Map[];
}

interface Tier {
    tier?: number;
    tierName?: string;
    smallIcon?: string;
    [key: string]: unknown;
}

interface CompetitiveTierData {
    uuid?: string;
    assetObjectName?: string;
    tiers?: Tier[];
    [key: string]: unknown;
}

interface CompetitiveTierApiResponse {
    data: CompetitiveTierData[];
}

export class Content {
    Requests: Requests;
    log: (msg: string) => void;

    constructor(Requests: Requests, log: (msg: string) => void) {
        this.Requests = Requests;
        this.log = log;
    }

    async get_content(): Promise<ContentData> {
        return await this.Requests.fetch("custom", `https://shared.${this.Requests.region}.a.pvp.net/content-service/v3/content`, "get") as ContentData;
    }

    get_latest_season_id(content: ContentData): string | undefined {
        if (!content.Seasons || !Array.isArray(content.Seasons)) {
            return undefined;
        }
        for (const season of content.Seasons) {
            if (season.IsActive && season.Type === "act") {
                return season.ID;
            }
        }
        return undefined;
    }

    get_previous_season_id(content: ContentData): string | undefined {
        if (!content.Seasons || !Array.isArray(content.Seasons)) {
            return undefined;
        }
        let currentseason: Season | null = null;
        for (const season of content.Seasons) {
            if (season.IsActive && season.Type === "act") {
                currentseason = season;
            }
        }

        for (const season of content.Seasons) {
            if (currentseason && currentseason.StartTime === season.EndTime && season.Type === "act") {
                return season.ID;
            }
        }
        return undefined;
    }

    async get_all_agents(): Promise<Record<string, string>> {
        // Hardcoded fallback agent list in case API fails
        const fallback_agents: Record<string, string> = {
            "": "",
            "null": "",
            "e370fa57-4757-3604-3648-499e1f642d3f": "Gekko",
            "dade69b4-4f5a-8528-247b-219e5a1facd6": "Fade",
            "5f8d3a7f-467b-97f3-062c-13acf203c006": "Breach",
            "cc8b64c8-4b25-4ff9-6e7f-37b4da43d235": "Deadlock",
            "b444168c-4e35-8076-db47-ef9bf368f384": "Tejo",
            "f94c3b30-42be-e959-889c-5aa313dba261": "Raze",
            "22697a3d-45bf-8dd7-4fec-84a9e28c69d7": "Chamber",
            "601dbbe7-43ce-be57-2a40-4abd24953621": "KAY/O",
            "6f2a04ca-43e0-be17-7f36-b3908627744d": "Skye",
            "117ed9e3-49f3-6512-3ccf-0cada7e3823b": "Cypher",
            "320b2a48-4d9b-a075-30f1-1f93a9b638fa": "Sova",
            "1e58de9c-4950-5125-93e9-a0aee9f98746": "Killjoy",
            "95b78ed7-4637-86d9-7e41-71ba8c293152": "Harbor",
            "efba5359-4016-a1e5-7626-b1ae76895940": "Vyse",
            "707eab51-4836-f488-046a-cda6bf494859": "Viper",
            "eb93336a-449b-9c1b-0a54-a891f7921d69": "Phoenix",
            "92eeef5d-43b5-1d4a-8d03-b3927a09034b": "Veto",
            "41fb69c1-4189-7b37-f117-bcaf1e96f1bf": "Astra",
            "9f0d8ba9-4140-b941-57d3-a7ad57c6b417": "Brimstone",
            "0e38b510-41a8-5780-5e8f-568b2a4f2d6c": "Iso",
            "1dbf2edd-4729-0984-3115-daa5eed44993": "Clove",
            "bb2a4828-46eb-8cd1-e765-15848195d751": "Neon",
            "7f94d92c-4234-0a36-9646-3a87eb8b5c89": "Yoru",
            "df1cb487-4902-002e-5c17-d28e83e78588": "Waylay",
            "569fdd95-4d10-43ab-ca70-79becc718b46": "Sage",
            "a3bfb853-43b2-7238-a4f1-ad90e9e46bcc": "Reyna",
            "8e253930-4c05-31dd-1b6c-968525494517": "Omen",
            "add6443a-41bd-e414-f6ad-e58d267f4e95": "Jett"
        };

        try {
            const response = await axios.get("https://valorant-api.com/v1/agents?isPlayableCharacter=true", {
                timeout: 10000 // 10 second timeout
            });
            const rAgents = response.data as AgentApiResponse;
            const agent_dict: Record<string, string> = {};
            agent_dict[""] = "";
            for (const agent of rAgents.data) {
                agent_dict[agent.uuid.toLowerCase()] = agent.displayName;
            }
            return agent_dict;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching agents from API: ${errorMessage}, using fallback agent list`);
            // Return fallback agent dict so the app can still function
            return fallback_agents;
        }
    }

    async get_agent_images(): Promise<Record<string, string>> {
        // Returns a map of agent displayName -> displayIcon URL
        try {
            const response = await axios.get("https://valorant-api.com/v1/agents?isPlayableCharacter=true", {
                timeout: 10000
            });
            const rAgents = response.data as AgentApiResponse;
            const agent_images: Record<string, string> = {};
            for (const agent of rAgents.data) {
                if (agent.displayIcon) {
                    agent_images[agent.displayName] = agent.displayIcon;
                }
            }
            return agent_images;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching agent images from API: ${errorMessage}`);
            return {};
        }
    }

    async get_rank_images(): Promise<Record<number, string>> {
        // Returns a map of tier number -> smallIcon URL
        try {
            const response = await axios.get("https://valorant-api.com/v1/competitivetiers", {
                timeout: 10000
            });
            const tierData = response.data as CompetitiveTierApiResponse;
            const rank_images: Record<number, string> = {};
            
            // Use the latest competitive tier data (first item in array, or the one with most recent assetPath)
            if (tierData.data && Array.isArray(tierData.data) && tierData.data.length > 0) {
                // Get the latest tier data (usually the last one in the array)
                const latestTierData = tierData.data[tierData.data.length - 1];
                if (latestTierData.tiers && Array.isArray(latestTierData.tiers)) {
                    for (const tier of latestTierData.tiers) {
                        if (tier.tier !== undefined && tier.smallIcon) {
                            rank_images[tier.tier] = tier.smallIcon;
                        }
                    }
                }
            }
            return rank_images;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching rank images from API: ${errorMessage}`);
            return {};
        }
    }

    async get_all_maps(): Promise<MapApiResponse> {
        try {
            const response = await axios.get("https://valorant-api.com/v1/maps");
            return response.data as MapApiResponse;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching maps from API: ${errorMessage}`);
            return { data: [] };
        }
    }

    get_map_urls(maps: MapApiResponse): Record<string, string> {
        const map_dict: Record<string, string> = {};
        for (const Vmap of maps.data) {
            if (Vmap.mapUrl) {
                map_dict[Vmap.mapUrl.toLowerCase()] = Vmap.displayName;
            }
        }
        return map_dict;
    }

    get_act_episode_from_act_id(content: ContentData, act_id: string): { act: string | number | null; episode: string | number | null } {
        const final: { act: string | number | null; episode: string | number | null } = {
            act: null,
            episode: null
        };

        const has_letter_and_number = (text: string): boolean => {
            return /[a-zA-Z]/.test(text) && /\d/.test(text);
        };

        const roman_to_int = (roman: string): number | null => {
            const roman_values: Record<string, number> = {
                'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100
            };
            
            let total = 0;
            let prev_value = 0;

            for (let i = roman.length - 1; i >= 0; i--) {
                const char = roman[i].toUpperCase();
                if (!(char in roman_values)) {
                    return null;
                }
                
                const current_value = roman_values[char];
                if (current_value < prev_value) {
                    total -= current_value;
                } else {
                    total += current_value;
                }
                prev_value = current_value;
            }

            return total;
        };

        const parse_season_number = (name: string): string | number | null => {
            if (!name || typeof name !== 'string') {
                return null;
            }

            const parts = name.split(' ');
            if (parts.length === 0) {
                return null;
            }

            const number_part = parts[parts.length - 1];
            
            if (has_letter_and_number(number_part)) {
                return number_part.toLowerCase();
            }

            if (name.startsWith('EPISODE')) {
                const num = parseInt(number_part);
                if (!isNaN(num)) {
                    return num;
                }
                return roman_to_int(number_part);
            } else if (name.startsWith('ACT')) {
                const roman_result = roman_to_int(number_part);
                if (roman_result !== null) {
                    return roman_result;
                }
                const num = parseInt(number_part);
                if (!isNaN(num)) {
                    return num;
                }
            }

            return null;
        };

        if (!content.Seasons || !Array.isArray(content.Seasons) || content.Seasons.length === 0) {
            return final;
        }

        let act_found = false;
        let episode: Season = content.Seasons[0];
        
        for (const season of content.Seasons) {
            if (season.ID && season.ID.toLowerCase() === act_id.toLowerCase()) {
                const act_num = parse_season_number(season.Name || "");
                if (act_num !== null) {
                    final.act = act_num;
                }
                act_found = true;
            }
        
            if (act_found && season.Type === "episode") {
                const episode_num = parse_season_number(episode.Name || "");
                if (episode_num !== null) {
                    final.episode = episode_num;
                }
                break;
            }

            if (season.Type === "episode") {
                episode = season;
            }
        }

        return final;
    }
}

