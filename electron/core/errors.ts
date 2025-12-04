import * as net from 'net';
import * as fs from 'fs';

export class Error {
    log: (msg: string) => void;

    constructor(log: (msg: string) => void) {
        this.log = log;
    }

    PortError(port: number): void {
        const sock = new net.Socket();
        sock.on('error', () => {
            this.log(`Port ${port} is being blocked by the firewall or in use by another application`);
            this.log("Check your firewall settings and whitelist the program, or try changing the port in config.json");
        });
        sock.connect(port, '127.0.0.1', () => {
            sock.destroy();
        });
    }

    LockfileError(filePath: string, ignoreLockfile: boolean = false): boolean {
        if (fs.existsSync(filePath) && !ignoreLockfile) {
            return true;
        } else {
            // Don't block - just return false if lockfile doesn't exist
            // The service loop will check periodically
            return false;
        }
    }
}

