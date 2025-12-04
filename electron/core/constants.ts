export const version = "2.91";
export const hide_names = true;

export const gamemodes: Record<string, string> = {
    "newmap": "New Map",
    "competitive": "Competitive",
    "unrated": "Unrated",
    "swiftplay": "Swiftplay",
    "spikerush": "Spike Rush",
    "deathmatch": "Deathmatch",
    "ggteam": "Escalation",
    "onefa": "Replication",
    "hurm": "Team Deathmatch",
    "custom": "Custom",
    "snowball": "Snowball Fight",
    "": "Custom",
};

export const before_ascendant_seasons = [
    "0df5adb9-4dcb-6899-1306-3e9860661dd3",
    "3f61c772-4560-cd3f-5d3f-a7ab5abda6b3",
    "0530b9c4-4980-f2ee-df5d-09864cd00542",
    "46ea6166-4573-1128-9cea-60a15640059b",
    "fcf2c8f4-4324-e50b-2e23-718e4a3ab046",
    "97b6e739-44cc-ffa7-49ad-398ba502ceb0",
    "ab57ef51-4e59-da91-cc8d-51a5a2b9b8ff",
    "52e9749a-429b-7060-99fe-4595426a0cf7",
    "71c81c67-4fae-ceb1-844c-aab2bb8710fa",
    "2a27e5d2-4d30-c9e2-b15a-93b8909a442c",
    "4cb622e1-4244-6da3-7276-8daaf1c01be2",
    "a16955a5-4ad0-f761-5e9e-389df1c892fb",
    "97b39124-46ce-8b55-8fd1-7cbf7ffe173f",
    "573f53ac-41a5-3a7d-d9ce-d6a6298e5704",
    "d929bc38-4ab6-7da4-94f0-ee84f8ac141e",
    "3e47230a-463c-a301-eb7d-67bb60357d4f",
    "808202d6-4f2b-a8ff-1feb-b3a0590ad79f",
];

export const NUMBERTORANKS = [
    'Unranked',
    'Unranked',
    'Unranked',
    'Iron 1',
    'Iron 2',
    'Iron 3',
    'Bronze 1',
    'Bronze 2',
    'Bronze 3',
    'Silver 1',
    'Silver 2',
    'Silver 3',
    'Gold 1',
    'Gold 2',
    'Gold 3',
    'Platinum 1',
    'Platinum 2',
    'Platinum 3',
    'Diamond 1',
    'Diamond 2',
    'Diamond 3',
    'Ascendant 1',
    'Ascendant 2',
    'Ascendant 3',
    'Immortal 1',
    'Immortal 2',
    'Immortal 3',
    'Radiant',
];

export const DEFAULT_CONFIG = {
    cooldown: 10,
    port: 1100,
    weapon: "Vandal",
};

const getEmbeddedApiKey = (): string => {
    const codes = [72, 68, 69, 86, 45, 55, 48, 102, 54, 98, 97, 99, 97, 45, 54, 97, 55, 54, 45, 52, 50, 53, 100, 45, 97, 99, 51, 97, 45, 53, 52, 99, 98, 52, 55, 50, 54, 51, 55, 57, 55];
    return String.fromCharCode(...codes);
};

export const EMBEDDED_API_KEY = getEmbeddedApiKey();