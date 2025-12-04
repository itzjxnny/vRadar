// Simplified Loadouts implementation
import axios from 'axios';
import { Requests } from './requestsV';
import { Server } from './server';

interface Player {
    Subject: string;
    CharacterID?: string;
    TeamID?: string;
    PlayerIdentity?: unknown;
}

interface SkinApiResponse {
    data: Array<{
        uuid: string;
        displayName: string;
        chromas?: Array<{
            uuid: string;
            displayName?: string;
            displayIcon?: string;
            fullRender?: string;
        }>;
        levels?: Array<{
            uuid: string;
            displayName?: string;
            displayIcon?: string;
        }>;
        displayIcon?: string;
        [key: string]: unknown;
    }>;
}

interface LoadoutInventory {
    Loadouts?: Array<{
        Loadout?: {
            Items?: Record<string, {
                Sockets?: Record<string, {
                    Item?: {
                        ID?: string;
                    };
                }>;
            }>;
        };
        Items?: Record<string, {
            Sockets?: Record<string, {
                Item?: {
                    ID?: string;
                };
            }>;
        }>;
    }>;
}

interface PregameStats {
    AllyTeam: {
        Players: Player[];
    };
    Teams?: Array<{
        TeamID?: string;
    }>;
}

interface LoadoutJson {
    Players: Record<string, unknown>;
    time: number;
    map: string | unknown;
    [key: string]: unknown;
}

export class Loadouts {
    Requests: Requests;
    log: (msg: string) => void;
    Server: Server;
    current_map: string | unknown;

    constructor(Requests: Requests, log: (msg: string) => void, Server: Server, current_map: string | unknown) {
        this.Requests = Requests;
        this.log = log;
        this.Server = Server;
        this.current_map = current_map;
    }

    async get_match_loadouts(
        match_id: string,
        players: Player[],
        weaponChoose: string,
        valoApiSkins: SkinApiResponse | { data: SkinApiResponse } | unknown,
        _names: Record<string, string>,
        state: string = "game"
    ): Promise<[Record<string, string>, LoadoutJson, Record<string, { skinName: string; skinVariant?: string; skinLevel?: string; skinImageUrl?: string }>]> {
        const weaponLists: Record<string, string> = {};
        const skinDetails: Record<string, { skinName: string; skinVariant?: string; skinLevel?: string; skinImageUrl?: string }> = {};
        
        try {
            const valApiWeaponsResponse = await axios.get("https://valorant-api.com/v1/weapons");
            const valApiWeapons = valApiWeaponsResponse.data;

            let PlayerInventorys: LoadoutInventory | undefined;
            let team_id = "Blue";
            let playersList = players;

            if (state === "game") {
                PlayerInventorys = await this.Requests.fetch("glz", `/core-game/v1/matches/${match_id}/loadouts`, "get") as LoadoutInventory;
            } else if (state === "pregame") {
                const pregame_stats = players as unknown as PregameStats;
                playersList = pregame_stats["AllyTeam"]["Players"];
                team_id = pregame_stats['Teams']?.[0]?.['TeamID'] || "Blue";
                PlayerInventorys = await this.Requests.fetch("glz", `/pregame/v1/matches/${match_id}/loadouts`, "get") as LoadoutInventory;
            }

            if (!PlayerInventorys) {
                this.log("Failed to fetch player inventories");
                return [{}, { Players: {}, time: Math.floor(Date.now() / 1000), map: this.current_map }, {}];
            }

            // Type guard for SkinApiResponse
            const isSkinApiResponse = (obj: unknown): obj is SkinApiResponse => {
                return typeof obj === 'object' && obj !== null && 'data' in obj && Array.isArray((obj as SkinApiResponse).data);
            };

            // Extract skin data from valoApiSkins
            let json_data: SkinApiResponse | unknown = valoApiSkins;
            if (valoApiSkins && typeof valoApiSkins === 'object' && valoApiSkins !== null && 'data' in valoApiSkins && valoApiSkins.data !== null && !Array.isArray(valoApiSkins.data) && typeof valoApiSkins.data === 'object' && 'data' in valoApiSkins.data) {
                json_data = valoApiSkins.data as SkinApiResponse;
            }

            if (!isSkinApiResponse(json_data)) {
                this.log("valoApiSkins data is missing or invalid");
                return [{}, { Players: {}, time: Math.floor(Date.now() / 1000), map: this.current_map }, {}];
            }

            for (let player = 0; player < playersList.length; player++) {
                let invindex = player;
                if (team_id === "Red") {
                    invindex = player + playersList.length - (PlayerInventorys["Loadouts"]?.length || 0);
                }

                const inv = state === "game" 
                    ? PlayerInventorys["Loadouts"]?.[invindex]?.["Loadout"]
                    : PlayerInventorys["Loadouts"]?.[invindex];

                if (!inv) continue;

                const playerId = playersList[player]["Subject"];
                
                // Find the selected weapon
                for (const weapon of valApiWeapons["data"]) {
                    if (weapon["displayName"].toLowerCase() === weaponChoose.toLowerCase()) {
                        const weaponUuid = weapon["uuid"].toLowerCase();
                        const skin_id = inv["Items"]?.[weaponUuid]?.["Sockets"]?.["bcef87d6-209b-46c6-8b19-fbe40bd95abc"]?.["Item"]?.["ID"];
                        const skin_chroma_id = inv["Items"]?.[weaponUuid]?.["Sockets"]?.["3ad1b2b2-acdb-4524-852f-954a76ddae0a"]?.["Item"]?.["ID"];
                        const skin_level_id = inv["Items"]?.[weaponUuid]?.["Sockets"]?.["e7c63390-eda7-46e0-bb7a-a6abdacd2433"]?.["Item"]?.["ID"];

                        if (!skin_id) break;

                        // Find skin in API data
                        const skin = json_data.data.find(s => s.uuid.toLowerCase() === skin_id.toLowerCase());
                        if (!skin) break;

                        const skin_display_name = skin.displayName.replace(` ${weapon.displayName}`, "");
                        weaponLists[playerId] = skin_display_name;
                        
                        // Extract variant (chroma)
                        let variantName: string | undefined;
                        if (skin_chroma_id && skin.chromas) {
                            const chroma = skin.chromas.find(c => c.uuid.toLowerCase() === skin_chroma_id.toLowerCase());
                            if (chroma && chroma.displayName) {
                                let rawVariantName = chroma.displayName;
                                
                                // Extract variant from various formats
                                const variantMatch = rawVariantName.match(/\(Variant \d+ (.+)\)/);
                                if (variantMatch && variantMatch[1]) {
                                    variantName = variantMatch[1].trim();
                                } else if (rawVariantName.includes(' - ')) {
                                    variantName = rawVariantName.split(' - ').pop()?.trim();
                                } else if (rawVariantName.includes('-')) {
                                    variantName = rawVariantName.split('-').pop()?.trim();
                                } else if (rawVariantName.includes(skin_display_name)) {
                                    const parts = rawVariantName.split(/\s+/);
                                    variantName = parts[parts.length - 1];
                                } else {
                                    variantName = rawVariantName;
                                }
                            }
                        }
                        
                        // Extract level
                        let levelName: string | undefined;
                        if (skin_level_id && skin.levels) {
                            const level = skin.levels.find(l => l.uuid.toLowerCase() === skin_level_id.toLowerCase());
                            if (level) {
                                levelName = level.displayName || level.displayIcon?.split('/').pop()?.replace('.png', '') || skin_level_id;
                            }
                        }
                        
                        // Get image URL (prefer chroma fullRender, fallback to skin displayIcon)
                        let skinImageUrl: string | undefined;
                        if (variantName && skin_chroma_id && skin.chromas) {
                            const chroma = skin.chromas.find(c => c.uuid.toLowerCase() === skin_chroma_id.toLowerCase());
                            if (chroma) {
                                skinImageUrl = chroma.fullRender || chroma.displayIcon || skin.displayIcon;
                            }
                        } else {
                            skinImageUrl = skin.displayIcon;
                        }
                        
                        // Format final variant
                        let finalVariant: string;
                        if (!variantName) {
                            finalVariant = weapon.displayName;
                        } else if (variantName.toLowerCase() === weapon.displayName.toLowerCase() || variantName.toLowerCase().includes(weapon.displayName.toLowerCase())) {
                            finalVariant = variantName;
                        } else {
                            finalVariant = `${variantName} ${weapon.displayName}`;
                        }
                        
                        skinDetails[playerId] = {
                            skinName: skin_display_name,
                            skinVariant: finalVariant,
                            skinLevel: levelName,
                            skinImageUrl: skinImageUrl
                        };
                        break;
                    }
                }
            }

            const final_json: LoadoutJson = {
                Players: {},
                time: Math.floor(Date.now() / 1000),
                map: this.current_map
            };
            
            this.Server.send_payload("matchLoadout", final_json);
            return [weaponLists, final_json, skinDetails];
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error getting loadouts: ${errorMessage}`);
            return [{}, { Players: {}, time: Math.floor(Date.now() / 1000), map: this.current_map }, {}];
        }
    }

}

