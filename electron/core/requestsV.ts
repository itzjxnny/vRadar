import axios, { Method } from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Error } from './errors';

// Disable SSL verification for local requests
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

export interface Lockfile {
    name: string;
    PID: string;
    port: string;
    password: string;
    protocol: string;
}

export class Requests {
    private error: Error;
    headers: Record<string, string>;
    log: (msg: string) => void;
    lockfile: Lockfile | null;
    region: string;
    pd_url: string;
    glz_url: string;
    puuid: string;
    lastLockfileAccount: string | null;
    connectionErrorLogged: boolean;
    private lastConnectionErrorLogTime: number = 0;
    private readonly CONNECTION_ERROR_LOG_INTERVAL = 30 * 1000; // Log connection errors every 30 seconds max
    onConnectionFailure?: () => void | Promise<void>;

    constructor(_version: string, log: (msg: string) => void, Error: Error, onConnectionFailure?: () => void) {
        this.error = Error;
        this.headers = {};
        this.log = log;
        this.lastLockfileAccount = null;
        this.connectionErrorLogged = false;
        this.onConnectionFailure = onConnectionFailure;

        this.lockfile = this.get_lockfile();
        const regionData = this.get_region();
        this.pd_url = `https://pd.${regionData[0]}.a.pvp.net`;
        this.glz_url = `https://glz-${regionData[1][0]}.${regionData[1][1]}.a.pvp.net`;
        this.region = regionData[0];
        
        this.puuid = '';
        // Don't block on header initialization - do it asynchronously
        // This prevents the service from getting stuck on startup
        setImmediate(() => {
        this.initializeHeaders().catch(err => {
            this.log("Error initializing headers: " + err);
            });
        });
    }

    static async check_version(version: string): Promise<void> {
        try {
            const response = await axios.get("https://api.github.com/repos/zayKenyon/VALORANT-rank-yoinker/releases");
            const release_version = response.data[0]?.tag_name;
            if (release_version && parseFloat(release_version) > parseFloat(version)) {
                console.log("[UPDATE] New version available!");
            }
        } catch {
            console.log("[WARNING] Unable to check for updates - skipping...");
        }
    }

    static async check_status(): Promise<void> {
        try {
            const response = await axios.get("https://raw.githubusercontent.com/zayKenyon/VALORANT-rank-yoinker/main/status.json");
            const status_data = response.data;
            if (!status_data.status_good || status_data.print_message) {
                console.log(status_data.message_to_display);
            }
        } catch {
            console.log("[WARNING] Unable to check status - skipping...");
        }
    }

    async fetch(url_type: string, endpoint: string, method: string, rate_limit_seconds: number = 5, retry_count: number = 0): Promise<unknown> {
        try {
            if (url_type === "glz") {
                const response = await axios.request({
                    method: method as Method,
                    url: this.glz_url + endpoint,
                    headers: await this.get_headers(),
                    httpsAgent: httpsAgent
                });
                this.log(`fetch: url: '${url_type}', endpoint: ${endpoint}, method: ${method}, response code: ${response.status}`);

                if (response.status === 404) {
                    return response.data;
                }

                if (response.data?.errorCode === "BAD_CLAIMS") {
                    // Prevent infinite retry loops
                    if (retry_count >= 3) {
                        this.log(`Token refresh failed after ${retry_count} attempts. Token may be expired - please restart Valorant client.`);
                        interface AxiosErrorLike {
                            message: string;
                            response?: { status: number; data: { errorCode: string } };
                        }
                        const axiosError: AxiosErrorLike = {
                            message: "BAD_CLAIMS: Token refresh failed after multiple attempts",
                            response: { status: 400, data: { errorCode: 'BAD_CLAIMS' } }
                        };
                        throw axiosError;
                    }
                    this.log(`detected bad claims (attempt ${retry_count + 1}/3)`);
                    this.headers = {};
                    this.lockfile = this.get_lockfile();
                    await this.sleep(2000); // Increased wait time
                    return this.fetch(url_type, endpoint, method, rate_limit_seconds, retry_count + 1);
                }

                if (response.status !== 200) {
                    if (response.status === 429) {
                        this.log("response not ok glz endpoint: rate limit 429");
                    } else {
                        this.log(`response not ok glz endpoint: ${JSON.stringify(response.data)}`);
                    }
                    await this.sleep(rate_limit_seconds + 5);
                    this.headers = {};
                    return this.fetch(url_type, endpoint, method, rate_limit_seconds, retry_count);
                }
                return response.data;
            } else if (url_type === "pd") {
                try {
                    const response = await axios.request({
                        method: method as Method,
                        url: this.pd_url + endpoint,
                        headers: await this.get_headers(),
                        httpsAgent: httpsAgent
                    });
                    this.log(`fetch: url: '${url_type}', endpoint: ${endpoint}, method: ${method}, response code: ${response.status}`);
                    
                    if (response.status === 404) {
                        return response;
                    }

                if (response.data?.errorCode === "BAD_CLAIMS") {
                    this.log("detected bad claims");
                    this.headers = {};
                    return this.fetch(url_type, endpoint, method, rate_limit_seconds, retry_count);
                }

                    if (response.status !== 200) {
                        if (response.status === 429) {
                            this.log("response not ok pd endpoint, rate limit 429");
                        } else {
                            this.log(`response not ok pd endpoint, ${JSON.stringify(response.data)}`);
                        }
                        await this.sleep(rate_limit_seconds + 5);
                        this.headers = {};
                        return this.fetch(url_type, endpoint, method, rate_limit_seconds + 5);
                    }
                    return response;
                } catch (error: unknown) {
                    // Handle 400 errors (like BAD_CLAIMS) by refreshing token and retrying
                    if (axios.isAxiosError(error) && error.response && error.response.status === 400) {
                        const errorData = error.response.data as { errorCode?: string; message?: string };
                        if (errorData && (errorData.errorCode === 'BAD_CLAIMS' || errorData.message?.includes('token'))) {
                            this.log(`Token error in fetch (${errorData.errorCode || errorData.message}), refreshing token`);
                            this.headers = {};
                            return this.fetch(url_type, endpoint, method, rate_limit_seconds, retry_count);
                        }
                    }
                    // Re-throw if it's not a token error
                    throw error;
                }
            } else if (url_type === "local") {
                if (!this.lockfile) return null;
                
                const authString = Buffer.from(`riot:${this.lockfile.password}`).toString('base64');
                const local_headers = { 'Authorization': `Basic ${authString}` };
                
                const max_retries = 5; // Increased retries for local requests
                for (let i = 0; i < max_retries; i++) {
                    try {
                        // Refresh lockfile before each attempt in case port changed
                        const currentLockfile = this.get_lockfile();
                        if (!currentLockfile) {
                            this.log('Lockfile disappeared during connection attempt');
                            return null;
                        }
                        // Update lockfile if port changed
                        if (currentLockfile.port !== this.lockfile?.port) {
                            this.log(`Lockfile port changed: ${this.lockfile?.port} -> ${currentLockfile.port}`);
                            this.lockfile = currentLockfile;
                        }
                        
                        const authString = Buffer.from(`riot:${this.lockfile.password}`).toString('base64');
                        const local_headers = { 'Authorization': `Basic ${authString}` };
                        
                        const response = await axios.request({
                            method: method as Method,
                            url: `https://127.0.0.1:${this.lockfile.port}${endpoint}`,
                            headers: local_headers,
                            httpsAgent: httpsAgent,
                            timeout: 8000 // Increased timeout
                        });
                        if (response.status === 200 && response.data?.errorCode !== "RPC_ERROR") {
                            if (endpoint !== "/chat/v4/presences") {
                                this.log(`fetch: url: '${url_type}', endpoint: ${endpoint}, method: ${method}, response code: ${response.status}`);
                            }
                            return response.data;
                        } else {
                            // Only log RPC_ERROR periodically to avoid spam
                            const timeSinceLastLog = Date.now() - this.lastConnectionErrorLogTime;
                            if (timeSinceLastLog >= this.CONNECTION_ERROR_LOG_INTERVAL || i === 0 || i === max_retries - 1) {
                                this.log(`Local API is not ready yet (RPC_ERROR or status code ${response.status}). Retrying... (${i + 1}/${max_retries})`);
                                this.lastConnectionErrorLogTime = Date.now();
                            }
                            await this.sleep(1000); // Wait longer between retries
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof globalThis.Error ? error.message : String(error);
                        // Only log connection errors periodically to avoid spam
                        const timeSinceLastLog = Date.now() - this.lastConnectionErrorLogTime;
                        if (timeSinceLastLog >= this.CONNECTION_ERROR_LOG_INTERVAL || i === 0 || i === max_retries - 1) {
                            this.log(`Connection error on local request. Retrying... (${i + 1}/${max_retries}): ${errorMessage}`);
                            this.lastConnectionErrorLogTime = Date.now();
                        }
                        await this.sleep(1000); // Wait longer between retries
                    }
                }
                // Only log final failure if we haven't logged recently
                const timeSinceLastLog = Date.now() - this.lastConnectionErrorLogTime;
                if (timeSinceLastLog >= this.CONNECTION_ERROR_LOG_INTERVAL) {
                this.log(`Failed to connect to local client after ${max_retries} attempts.`);
                    this.lastConnectionErrorLogTime = Date.now();
                }
                // Call connection failure callback if provided
                // Use setImmediate to avoid blocking if callback is async
                if (this.onConnectionFailure) {
                    const result = this.onConnectionFailure();
                    // If callback returns a promise, don't await it - let it run in background
                    if (result instanceof Promise) {
                        result.catch(() => {
                            // Ignore errors in callback
                        });
                    }
                }
                return null;
            } else if (url_type === "custom") {
                const response = await axios.request({
                    method: method as Method,
                    url: endpoint,
                    headers: await this.get_headers(),
                    httpsAgent: httpsAgent
                });
                this.log(`fetch: url: '${url_type}', endpoint: ${endpoint}, method: ${method}, response code: ${response.status}`);
                if (response.status !== 200) {
                    this.headers = {};
                }
                return response.data;
            }
        } catch (error: unknown) {
            if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
                this.log(`Error in fetch function: ${error.message}`);
            } else {
                this.log(`Error in fetch function: ${String(error)}`);
            }
            throw error;
        }
    }

    private readLogFile(): string[] {
        const logPath = path.join(os.homedir(), 'AppData', 'Local', 'VALORANT', 'Saved', 'Logs', 'ShooterGame.log');
        const fileContent = fs.readFileSync(logPath, 'utf8');
        return fileContent.split('\n');
    }

    get_region(): [string, [string, string]] {
        const lines = this.readLogFile();
        let pd_url = '';
        let glz_url: [string, string] = ['', ''];
        
        for (const line of lines) {
            if (line.includes('.a.pvp.net/account-xp/v1/')) {
                const match = line.match(/pd\.([^.]+)\.a\.pvp\.net/);
                if (match) pd_url = match[1];
            } else if (line.includes('https://glz-')) {
                const match = line.match(/https:\/\/glz-([^.]+)\.([^.]+)\./);
                if (match) {
                    glz_url = [match[1], match[2]];
                }
            }
            if (pd_url && glz_url[0] && glz_url[1]) {
                break;
            }
        }
        
        if (pd_url === "pbe") {
            return ["na", ["na-1", "na"]];
        }
        return [pd_url, glz_url];
    }

    get_current_version(): string {
        const lines = this.readLogFile();
        
        for (const line of lines) {
            if (line.includes('CI server version:')) {
                const version_without_shipping = line.split('CI server version: ')[1]?.trim();
                if (version_without_shipping) {
                    const versionParts = version_without_shipping.split("-");
                    versionParts.splice(2, 0, "shipping");
                    return versionParts.join("-");
                }
            }
        }
        return "";
    }

    get_lockfile(ignoreLockfile: boolean = false): Lockfile | null {
        const lockfilePath = path.join(os.homedir(), 'AppData', 'Local', 'Riot Games', 'Riot Client', 'Config', 'lockfile');
        
        if (this.error.LockfileError(lockfilePath, ignoreLockfile)) {
            const data = fs.readFileSync(lockfilePath, 'utf8').split(':');
            const keys: (keyof Lockfile)[] = ['name', 'PID', 'port', 'password', 'protocol'];
            const lockfile: Partial<Lockfile> = {};
            keys.forEach((key, index) => {
                lockfile[key] = data[index];
            });
            
            const currentAccount = lockfile.name || null;
            if (currentAccount !== this.lastLockfileAccount) {
                this.lastLockfileAccount = currentAccount;
            }
            
            return lockfile as Lockfile;
        }
        return null;
    }

    async get_headers(refresh: boolean = false, init: boolean = false): Promise<Record<string, string>> {
        if (Object.keys(this.headers).length === 0 || refresh) {
            if (!this.lockfile) {
                // During init, don't log this - it's normal if Valorant isn't running
                if (!init) {
                    this.log('No lockfile available for headers');
                }
                return {};
            }

            // Store lockfile in local variable to avoid null checks
            let lockfile: Lockfile | null = this.lockfile;
            let try_again = true;
            let retryCount = 0;
            const maxRetries = init ? 2 : 10; // Very few retries during init to avoid blocking
            
            while (try_again && retryCount < maxRetries) {
                retryCount++;
                if (!lockfile) {
                    lockfile = this.get_lockfile();
                    if (!lockfile) {
                        // During init, return empty immediately to avoid blocking
                        if (init) {
                            return {};
                        }
                        return {};
                    }
                }
                
                const authString = Buffer.from(`riot:${lockfile.password}`).toString('base64');
                const local_headers = { 'Authorization': `Basic ${authString}` };
                
                try {
                    const response = axios.get(`https://127.0.0.1:${lockfile.port}/entitlements/v1/token`, {
                        headers: local_headers,
                        httpsAgent: httpsAgent,
                        timeout: init ? 1500 : 5000 // Very short timeout during init to avoid blocking
                    }).then(res => res.data).catch(async (err) => {
                        // During initialization, return empty immediately to avoid blocking
                        if (init) {
                            // Don't log during init - it's normal if Valorant isn't ready
                            // Just return empty and let the service loop handle it
                            return {};
                        }
                        
                        // Only log connection error when account changes or on first error (not during init)
                        const newLockfile = this.get_lockfile();
                        const newAccount = newLockfile?.name || null;
                        if (newAccount !== this.lastLockfileAccount || !this.connectionErrorLogged) {
                            this.log(`Connection error, retrying in 1 seconds, getting new lockfile${newAccount && newAccount !== this.lastLockfileAccount ? ` (account: ${newAccount})` : ''}`);
                            this.connectionErrorLogged = true;
                        }
                        await this.sleep(1000);
                        lockfile = newLockfile;
                        this.lockfile = lockfile;
                        throw err;
                    });

                    const entitlements = await response;
                    
                    if (entitlements?.message === "Entitlements token is not ready yet") {
                        try_again = true;
                        await this.sleep(1000);
                    } else if (entitlements?.message === "Invalid URI format") {
                        this.log(`Invalid uri format: ${JSON.stringify(entitlements)}`);
                        if (init) {
                            return {};
                        } else {
                            try_again = true;
                            await this.sleep(5000);
                        }
                    } else {
                        try_again = false;
                        this.puuid = entitlements.subject;
                        this.headers = {
                            'Authorization': `Bearer ${entitlements.accessToken}`,
                            'X-Riot-Entitlements-JWT': entitlements.token,
                            'X-Riot-ClientPlatform': "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9",
                            'X-Riot-ClientVersion': this.get_current_version(),
                            "User-Agent": "ShooterGame/13 Windows/10.0.19043.1.256.64bit"
                        };
                        this.connectionErrorLogged = false;
                    }
                } catch (error: unknown) {
                    // During initialization, return empty immediately to avoid blocking
                    if (init) {
                        // Don't log or retry during init - just return empty
                        return {};
                    }
                    
                    // Handle errors during header fetching (not during init)
                    const errorMessage = error instanceof globalThis.Error 
                        ? String((error as globalThis.Error).message || error)
                        : String(error);
                    this.log(`Header fetch error: ${errorMessage}`);
                    await this.sleep(1000);
                    lockfile = this.get_lockfile();
                    if (lockfile) {
                        this.lockfile = lockfile;
                    }
                    // Continue retrying
                    try_again = true;
                }
            }
            // Update instance lockfile at the end if we have a valid one
            if (lockfile) {
                this.lockfile = lockfile;
            }
        }
        return this.headers;
    }

    private async initializeHeaders(): Promise<void> {
        try {
        const headers = await this.get_headers(false, true);
        if (Object.keys(headers).length === 0) {
                // Don't log this as an error during initialization - it's normal if Valorant isn't running
                // this.log("Invalid URI format, invalid lockfile, going back to menu");
            this.get_lockfile(true);
            }
        } catch (error: unknown) {
            // Silently handle errors during initialization - service loop will handle it
            // Use global Error type, not the custom Error class from ./errors
            const errorMessage = error instanceof globalThis.Error 
                ? String((error as globalThis.Error).message || error)
                : String(error);
            this.log(`Header initialization error (non-blocking): ${errorMessage}`);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getLastLockfileAccount(): string | null {
        return this.lastLockfileAccount;
    }
}

