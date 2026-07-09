import express from 'express';
import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "fs";
import renderTrailerRouter from "./api/renderTrailer/route";
import { JOBS_DIR } from './utils/configs';
import v_stack, { processProcessVideoJob } from './api/v_stack/route';
import overlay, { processOverlayJob } from './api/overlay/route';
import subtitle, { processSubtitleJob } from './api/subtitle/route';
import clips, { processClipJob } from './api/clips/route';
import interview from './api/interview/route';
import uploadRoute from './api/upload/route';
import cleanup from './api/cleanUp/route';
import logoSwap, { processLogoSwapJob } from './api/logo_swap/route';
import extractAudio from './api/extractAudio/route';

// Ensure directory exists
if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
}

// Configuration
const PORT: number = Number(process.env.PORT) || 9000;


const app = express();
app.use(express.json({ limit: '50mb' }));

// Reject path-traversal attempts before any route handling. Job IDs and file
// names flow straight into path.join() in the route handlers, so block any
// segment that could escape the jobs directory.
app.use((req, res, next) => {
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(req.path);
    } catch {
        res.status(400).json({ error: 'Malformed URL' });
        return;
    }
    if (decodedPath.includes('\0') || decodedPath.split('/').includes('..')) {
        res.status(400).json({ error: 'Invalid path' });
        return;
    }
    next();
});

app.use('/static', (req, res, next) => {
    res.setHeader('Accept-Ranges', 'bytes');
    next();
}, express.static(JOBS_DIR, {
    setHeaders: (res) => {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
    }
}));

const activeJobs = new Set<string>();

async function worker() {
    try {
        if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
        const jobIds = fs.readdirSync(JOBS_DIR);

        for (const jobId of jobIds) {
            // 1. Check if this specific instance is already processing this job
            if (activeJobs.has(jobId)) continue;

            const jobDir = path.join(JOBS_DIR, jobId);
            const jobFile = path.join(jobDir, "job.json");
            if (!fs.existsSync(jobFile)) continue;

            let job: any;
            try {
                const data = await fsPromises.readFile(jobFile, "utf-8");
                job = JSON.parse(data);
            } catch (e) { continue; }

            // 2. Only pick up "pending" jobs
            if (job.status !== "pending") continue;

            // 3. LOCK and set to processing
            activeJobs.add(jobId);
            console.log(`[Worker] Picking up job: ${jobId}`);

            job.status = "processing";
            job.progress = 0;
            await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

            // 4. Run the processor (wrapped in try/catch so one failure doesn't kill the loop)
            // We do NOT use 'await' here if you want to run multiple jobs in parallel, 
            // OR we 'await' if you want one job at a time. I'll use await for stability.
            try {
                if (jobId.startsWith('process_video')) {
                    // This now calls the optimized version with 'ultrafast' preset
                    await processProcessVideoJob(jobId, jobDir, jobFile, job as ProcessVideoJobData);
                }
                else if (jobId.startsWith('overlay_')) {
                    await processOverlayJob(jobId, jobDir, jobFile, job as OverlayJobData);
                }
                else if (jobId.startsWith('subtitle_')) {
                    await processSubtitleJob(jobId, jobDir, jobFile, job as SubtitleJobData);
                }
                else if (jobId.startsWith('clip_')) {
                    await processClipJob(jobId, jobDir, jobFile, job as ClipJobData);
                }
                else if (jobId.startsWith('logo_swap_')) {
                    await processLogoSwapJob(jobId, jobDir, jobFile, job as LogoSwapJobData);
                }

            } catch (err) {
                console.error(`[Job ${jobId}] Critical Error:`, err);
                job.status = "error";
                job.error = String(err);
                await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
            } finally {
                // 5. UNLOCK when done
                activeJobs.delete(jobId);
            }
        }
    } catch (err) {
        console.error("Worker loop crash:", err);
    } finally {
        // Wait 2 seconds and run again
        setTimeout(worker, 2000);
    }
}

app.use("/upload-video", uploadRoute)
app.use("/full_interview", interview)
app.use("/process-video", v_stack)
app.use("/overlay-video", overlay)
app.use("/subtitle-video", subtitle)
app.use("/clip-video", clips)
app.use("/render-trailer", renderTrailerRouter);
app.use('/remove', cleanup)
app.use("/swap-logo", logoSwap);
app.use("/extract-audio", extractAudio)

console.log("Starting unified worker loop...");
worker();




app.get('/health', (req, res): void => {
    res.json({
        ok: true,
        endpoints: [
            '/upload-video',
            '/full_interview',
            '/process-video',
            '/overlay-video',
            '/subtitle-video',
            '/clip-video',
            '/render-trailer',
            '/swap-logo',
            '/remove',
        ],
    });
});

app.listen(PORT, () => {
    console.log(`FFmpeg service listening on ${PORT}`);
});