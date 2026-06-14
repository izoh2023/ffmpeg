import path from "node:path";
import fs from "node:fs";
import { JOBS_DIR } from "./configs";

function cleanupOldJobs() {
    try {
        if (!fs.existsSync(JOBS_DIR)) return;

        const now = Date.now();
        const maxAge = 3600000; // 1 hour

        const jobIds = fs.readdirSync(JOBS_DIR);

        for (const jobId of jobIds) {
            const jobDir = path.join(JOBS_DIR, jobId);
            const jobFile = path.join(jobDir, "job.json");

            if (!fs.existsSync(jobFile)) continue;

            try {
                const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
                const jobTime = parseInt(jobId.split('_')[0]);

                // Delete jobs older than 1 hour that are done or errored
                if (now - jobTime > maxAge && (job.status === 'done' || job.status === 'error')) {
                    console.log(`[Cleanup] Removing old job ${jobId}`);
                    fs.rmSync(jobDir, { recursive: true, force: true });
                }
            } catch (err) {
                console.error(`[Cleanup] Error processing ${jobId}:`, err);
            }
        }
    } catch (err) {
        console.error("[Cleanup] Error:", err);
    }
}