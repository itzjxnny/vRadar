import * as fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';
import { version } from './constants';
import { Error } from './errors';

export class Server {
    private error: Error;
    log: (msg: string) => void;
    private lastMessages: Record<string, string>;
    private wss: WebSocketServer | null = null;
    private port: number;

    constructor(log: (msg: string) => void, Error: Error) {
        this.error = Error;
        this.log = log;
        this.lastMessages = {};
        this.port = 1100;
    }

    start_server(): void {
        try {
            if (fs.existsSync("config.json")) {
                const config = JSON.parse(fs.readFileSync("config.json", 'utf-8'));
                this.port = config.port || 1100;
            }

            this.wss = new WebSocketServer({ host: "0.0.0.0", port: this.port });
            this.wss.on('connection', (ws: WebSocket) => {
                this.handle_new_client(ws);
            });

            this.log(`WebSocket server started on port ${this.port}`);
        } catch {
            this.error.PortError(this.port);
        }
    }

    private broadcastToClients(message: string): void {
        if (!this.wss) return;
        
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    handle_new_client(_ws: WebSocket): void {
        this.send_payload("version", { core: version });
        
        for (const key in this.lastMessages) {
            if (key !== "chat" && key !== "version") {
                this.broadcastToClients(this.lastMessages[key]);
            }
        }
    }

    private send_message(message: string): void {
        this.broadcastToClients(message);
    }

    send_payload(type: string, payload: Record<string, unknown>): void {
        const payloadWithType = { ...payload, type };
        const msg_str = JSON.stringify(payloadWithType);
        this.lastMessages[type] = msg_str;
        this.send_message(msg_str);
    }
}

