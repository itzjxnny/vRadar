import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG } from './constants';

export interface ConfigData {
    cooldown: number;
    port: number;
    weapon: string;
}

export class Config {
    log: (msg: string) => void;
    cooldown!: number;
    port!: number;
    weapon!: string;

    constructor(log: (msg: string) => void) {
        this.log = log;

        // Use app.getPath('userData') for packaged apps, fallback to process.cwd() for dev
        let configDir = process.cwd();
        try {
            const { app } = require('electron');
            if (app && app.isReady && app.getPath) {
                configDir = app.getPath('userData');
            }
        } catch (e) {
            // app not available, use process.cwd() (dev mode)
        }
        const configPath = path.join(configDir, "config.json");
        let config: ConfigData;

        if (!fs.existsSync(configPath)) {
            this.log("config.json not found, creating new one");
            config = this.getDefaultConfig();
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        } else {
            try {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                config = JSON.parse(configContent);

                // Add any missing keys from defaults
                const defaultKeys = Object.keys(DEFAULT_CONFIG);
                const missingKeys = defaultKeys.filter(key => !(key in config));

                if (missingKeys.length > 0) {
                    for (const key of missingKeys) {
                        const defaultKey = key as keyof typeof DEFAULT_CONFIG;
                        (config as unknown as Record<string, unknown>)[key] = (DEFAULT_CONFIG as Record<string, unknown>)[defaultKey];
                    }
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
                }
            } catch {
                this.log("Invalid config.json, creating new one");
                config = this.getDefaultConfig();
                fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
            }
        }

        // Merge with defaults and apply to instance
        config = { ...DEFAULT_CONFIG, ...config };
        Object.assign(this, config);
    }

    private getDefaultConfig(): ConfigData {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
}

