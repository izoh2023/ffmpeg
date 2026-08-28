import { spawn } from "child_process";
import { MAX_PROCESSING_TIME, STALL_TIMEOUT } from "./configs";

export function runCmd(
    cmd: string,
    args: string[],
    opts: Record<string, any> = {},
    timeoutMs: number = MAX_PROCESSING_TIME
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });

        let lastProgressTime = Date.now();
        let lastLogTime = 0; // Track when we last printed to console
        const LOG_INTERVAL = 5000; // Only log progress every 5 seconds
        let killed = false;
        let stderrTail = "";

        const overallTimeout = setTimeout(() => {
            if (!killed) {
                killed = true;
                child.kill('SIGKILL');
                reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        const stallCheckInterval = setInterval(() => {
            if (Date.now() - lastProgressTime > STALL_TIMEOUT) {
                if (!killed) {
                    killed = true;
                    clearTimeout(overallTimeout);
                    clearInterval(stallCheckInterval);
                    child.kill('SIGKILL');
                    reject(new Error(`${cmd} stalled`));
                }
            }
        }, 5000);

        child.stderr.on('data', (data) => {
            const output = data.toString();
            stderrTail = (stderrTail + output).slice(-4000);
            const now = Date.now();

            if (output.includes('frame=') || output.includes('time=')) {
                lastProgressTime = now;

                // ONLY LOG EVERY 5 SECONDS
                if (now - lastLogTime > LOG_INTERVAL) {
                    // This will show: frame= 1234 fps= 45 q=23.0 size= 50MB time=00:10:00...
                    console.log(`[${cmd} PROGRESS] ${output.trim().split('\r').pop()}`);
                    lastLogTime = now;
                }
            } else if (output.trim().length > 0) {
                // Log important startup info/errors immediately
                console.error(`[${cmd} INFO] ${output.trim()}`);
            }
        });

        child.on('error', (err) => {
            clearTimeout(overallTimeout);
            clearInterval(stallCheckInterval);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(overallTimeout);
            clearInterval(stallCheckInterval);
            if (!killed) {
                code === 0 ? resolve() : reject(new Error(`Exit code ${code}: ${stderrTail.trim()}`));
            }
        });
    });
}
