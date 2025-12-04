import * as fs from 'fs';
import * as path from 'path';

export class Logging {
    private logFileName: string | null = null;

    log(log_string: string): void {
        // Try to use app.getPath('userData') for packaged apps, fallback to process.cwd() for dev
        let basePath = process.cwd();
        try {
            // Try to get userData path if app is available (packaged app)
            const { app } = require('electron');
            if (app && app.isReady && app.getPath) {
                basePath = app.getPath('userData');
            }
        } catch (e) {
            // app not available, use process.cwd() (dev mode)
        }
        const logsDirectory = path.join(basePath, "logs");

        if (!fs.existsSync(logsDirectory)) {
            fs.mkdirSync(logsDirectory, { recursive: true });
        }

        // Get or create log file name
        if (!this.logFileName) {
            const logFiles = fs.readdirSync(logsDirectory).filter(file => file.startsWith('log-') && file.endsWith('.txt'));
            const logFileNumbers = logFiles
                .map(file => {
                    const match = file.match(/log-(\d+)\.txt/);
                    return match ? parseInt(match[1], 10) : 0;
                })
                .filter(num => num > 0);
            
            const maxNum = logFileNumbers.length > 0 ? Math.max(...logFileNumbers) : 0;
            this.logFileName = path.join(logsDirectory, `log-${maxNum + 1}.txt`);
        }

        const currentTime = new Date().toISOString().replace(/T/, '.').replace(/\..+/, '').replace(/:/g, '.');
        const logEntry = `[${currentTime}] ${log_string.replace(/[^\x00-\x7F]/g, '?')}\n`;

        fs.appendFileSync(this.logFileName, logEntry);
    }
}

