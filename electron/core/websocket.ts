import WebSocket from 'ws';
import { Requests, Lockfile } from './requestsV';

export class Ws {
    private lockfile: Lockfile | null;
    private Requests: Requests;
    log: (msg: string) => void;

    constructor(lockfile: Lockfile | null, Requests: Requests, _cfg: unknown, _hide_names: boolean, _server: unknown) {
        this.lockfile = lockfile;
        this.Requests = Requests;
        this.log = Requests.log;
    }

    updateLockfile(lockfile: Lockfile | null): void {
        this.lockfile = lockfile;
    }

    async reconnect_to_websocket(initial_game_state: string): Promise<string> {
        if (!this.lockfile) {
            return "DISCONNECTED";
        }

        const authString = Buffer.from(`riot:${this.lockfile.password}`).toString('base64');
        const local_headers = { 'Authorization': `Basic ${authString}` };
        const url = `wss://127.0.0.1:${this.lockfile.port}`;

        const max_retries = 5;
        let retry_delay = 2000;

        for (let attempt = 0; attempt < max_retries; attempt++) {
            try {
                const ws = new WebSocket(url, {
                    headers: local_headers,
                    rejectUnauthorized: false
                } as WebSocket.ClientOptions);

                return await new Promise<string>((resolve, reject) => {
                    let resolved = false;

                    ws.on('open', () => {
                        ws.send('[5, "OnJsonApiEvent_chat_v4_presences"]');
                        ws.send('[5, "OnJsonApiEvent_chat_v6_messages"]');
                        ws.send('[5, "OnJsonApiEvent_pregame_v1_matches"]');
                    });

                    ws.on('error', (error: Error) => {
                        if (!resolved) {
                            resolved = true;
                            ws.close();
                            reject(error);
                        }
                    });

                    ws.on('close', (code: number, reason: Buffer) => {
                        if (!resolved) {
                            this.log(`Websocket closed: code=${code}, reason=${reason.toString()}`);
                            resolved = true;
                            resolve("DISCONNECTED");
                        }
                    });

                    ws.on('message', (data: WebSocket.Data) => {
                        const messageStr = String(data);
                        const result = this.handle(messageStr, initial_game_state);
                        if (result !== null && !resolved) {
                            resolved = true;
                            ws.close();
                            resolve(result);
                        }
                    });
                });
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log(`Websocket failed (attempt ${attempt + 1}/${max_retries}): ${errorMessage}`);
                if (attempt < max_retries - 1) {
                    await this.sleep(retry_delay);
                    retry_delay *= 2;
                } else {
                    this.log(`Websocket failed after ${max_retries} attempts.`);
                    return "DISCONNECTED";
                }
            }
        }

        return "DISCONNECTED";
    }

    handle(m: string, initial_game_state: string): string | null {
        try {
            if (!m || m.length <= 10) {
                return null;
            }
            const resp_json = JSON.parse(m);
            
            if (resp_json[2]?.uri === "/chat/v4/presences") {
                const presences = resp_json[2]?.data?.presences || [];
                for (const presence of presences) {
                    if (presence?.puuid === this.Requests.puuid) {
                        if (presence.product === "league_of_legends") {
                            return null;
                        }

                        try {
                            const privateField = presence['private'] as string | undefined;
                            if (!privateField) {
                                break;
                            }
                            const decoded = Buffer.from(privateField, 'base64').toString('utf-8');
                            const private_data = JSON.parse(decoded) as Record<string, unknown>;
                            
                            let state: string | null = null;
                            const matchPresenceData = private_data.matchPresenceData as { sessionLoopState?: string } | undefined;
                            if (matchPresenceData) {
                                state = matchPresenceData.sessionLoopState || null;
                            } else if ("sessionLoopState" in private_data) {
                                state = (private_data.sessionLoopState as string) || null;
                            } else {
                                this.log(`ERROR: Unknown presence API structure in 'websocket.handle': ${JSON.stringify(private_data)}`);
                                const fallbackMatchPresenceData = private_data.matchPresenceData as { sessionLoopState?: string } | undefined;
                                state = fallbackMatchPresenceData?.sessionLoopState || null;
                            }

                            if (state !== null) {
                                this.log(`Websocket detected state: ${state} (initial: ${initial_game_state})`);
                                if (state !== initial_game_state) {
                                    this.log(`State changed from ${initial_game_state} to ${state}`);
                                    return state;
                                } else {
                                    this.log(`State is still ${state}, waiting for change...`);
                                }
                            } else {
                                this.log(`State is null for puuid ${presence?.puuid}`);
                            }
                        } catch (error: unknown) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            this.log(`Failed to decode private presence data: ${errorMessage}`);
                        }
                        break;
                    }
                }
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to parse websocket message: ${errorMessage}`);
        }
        return null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
