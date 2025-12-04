export interface Player {
    Subject: string;
    Name: string;
    CharacterID: string;
    AgentName: string;
    AgentImageUrl?: string | null;
    PlayerIdentity: {
        AccountLevel: number;
        Incognito: boolean;
        HideAccountLevel: boolean;
        PlayerCardID?: string;
        LevelBorderUrl?: string | null;
    };
    currenttier: number;
    currenttierpatched: string;
    rankingInTier: number;
    peakrank: string;
    peakrankTier: number;
    peakrankep: string;
    peakrankact: string;
    previousRank: string;
    leaderboard: number;
    winRate?: number;
    numberofgames: number;
    headshotPercentage: number;
    kd: number;
    RankedRatingEarned: number | "N/A";
    AFKPenalty: number | "N/A";
    skinData: {
        skinName: string;
        skinVariant?: string;
        skinLevel?: string;
        skinImageUrl?: string;
    };
    loadout: Record<string, unknown>;
    team?: string;
    characterSelectionState?: string;
    isLobby?: boolean;
    isPartyMember?: boolean;
    partyId?: string;
    statsFetched?: boolean; // Flag to track if stats were actually fetched (even if 0/N/A)
    hasCompetitiveStats?: boolean; // Flag to track if player has competitive stats (not unrated only)
}

export interface MatchData {
    map: string;
    mode: string;
    queue: string;
    state: string;
    mapImageUrl?: string | null;
    Players: Player[];
    isLobby: boolean;
    metadata?: Record<string, unknown>;
    teams?: Record<string, unknown>;
    players?: Record<string, unknown>;
    _timestamp?: number;
}

