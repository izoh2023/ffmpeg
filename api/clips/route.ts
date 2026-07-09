import express from 'express';
import { Router } from "express";
import { v4 as uuidv4 } from 'uuid';
import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "fs";
import archiver from "archiver";
import { JOBS_DIR, MAX_PROCESSING_TIME } from "../../utils/configs";
import { runCmd } from "../../utils/runCmd";
import { spawn } from "child_process";

const clips = Router();
const CLIP_CONCURRENCY = 3;

async function runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    limit: number
): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            results[i] = await tasks[i]();
        }
    }

    await Promise.all(Array.from({ length: limit }, worker));
    return results;
}

// ── Audio-aware boundary snapping ──────────────────────────────────────────────
// Hard cuts at arbitrary timestamps clip words mid-syllable and (with copied
// audio) produce clicks/pops. We scan a small window around each nominal cut for
// silence (pauses) and snap the cut into the nearest pause, so a clip starts
// cleanly on a word and ends in the gap after the last word instead of catching
// the first phoneme of the next one.
const SNAP_WINDOW = 0.6;   // seconds searched on each side of a boundary
const PREROLL = 0.08;      // lead-in kept before speech onset
const POSTROLL = 0.12;     // tail kept after the last word
const SILENCE_DB = -30;    // noise floor (dB) treated as silence
const MIN_SILENCE = 0.1;   // minimum pause length (s) to count as a pause

interface SilenceRegion {
    start: number;
    end: number;
}

// Scan an audio-only window for silence regions. Times are returned on the
// original media timeline (the window offset is added back).
function detectSilences(videoPath: string, winStart: number, winLen: number): Promise<SilenceRegion[]> {
    return new Promise((resolve) => {
        const args = [
            "-ss", winStart.toFixed(3),
            "-t", winLen.toFixed(3),
            "-i", videoPath,
            "-vn",
            "-af", `silencedetect=noise=${SILENCE_DB}dB:d=${MIN_SILENCE}`,
            "-f", "null", "-",
        ];
        const proc = spawn("ffmpeg", args);
        let stderr = "";
        const kill = setTimeout(() => proc.kill("SIGKILL"), 20000);
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", () => { clearTimeout(kill); resolve([]); });
        proc.on("close", () => {
            clearTimeout(kill);
            const regions: SilenceRegion[] = [];
            const re = /silence_(start|end):\s*(-?[0-9.]+)/g;
            let open: number | null = null;
            let m: RegExpExecArray | null;
            while ((m = re.exec(stderr)) !== null) {
                const t = parseFloat(m[2]);
                if (m[1] === "start") {
                    open = t;
                } else {
                    regions.push({ start: winStart + (open ?? 0), end: winStart + t });
                    open = null;
                }
            }
            // Window ended while still inside a silence.
            if (open !== null) regions.push({ start: winStart + open, end: winStart + winLen });
            resolve(regions);
        });
    });
}

// Snap the START into the pause just before speech begins. Returns null if no
// usable pause is found within SNAP_WINDOW of the nominal point.
function snapStart(nominal: number, silences: SilenceRegion[]): number | null {
    const candidates = silences.filter((r) => Math.abs(r.end - nominal) <= SNAP_WINDOW);
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) =>
        Math.abs(b.end - nominal) < Math.abs(a.end - nominal) ? b : a
    );
    // Begin a hair before the word onset, but not before the pause itself.
    return Math.max(0, Math.max(best.start, best.end - PREROLL));
}

// Snap the END into the pause right after the last word. Returns null if no
// usable pause is found within SNAP_WINDOW of the nominal point.
function snapEnd(nominal: number, silences: SilenceRegion[]): number | null {
    const candidates = silences.filter((r) => Math.abs(r.start - nominal) <= SNAP_WINDOW);
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) =>
        Math.abs(b.start - nominal) < Math.abs(a.start - nominal) ? b : a
    );
    // End just into the pause — never reach the next word (it starts at best.end).
    return Math.min(best.end, best.start + POSTROLL);
}

export async function processClipJob(jobId: string, jobDir: string, jobFile: string, job: any) {
    console.log(`[Clip Job ${jobId}] Starting Frame-Accurate Cut (concurrency=${CLIP_CONCURRENCY})...`);

    const outputDir = path.join(jobDir, "clips");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const hhmmssToSeconds = (ts: string): number => {
        const parts = ts.split(":");
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = parseFloat(parts[2]);
        return h * 3600 + m * 60 + s;
    };

    const KEYFRAME_SEEK_BUFFER = 30;
    let completed = 0;

    const tasks = job.clips.map((clip: any, i: number) => async (): Promise<string | null> => {
        const startTime = hhmmssToSeconds(clip.start_ffmpeg);
        const endTime = hhmmssToSeconds(clip.end_ffmpeg);

        // Scan one window covering the clip plus a margin on each side, then snap
        // both cut points into the nearest pause. Fall back to a small fixed pad
        // when no usable silence is found near a boundary.
        const scanStart = Math.max(0, startTime - SNAP_WINDOW);
        const scanEnd = endTime + SNAP_WINDOW;
        let silences: SilenceRegion[] = [];
        try {
            silences = await detectSilences(job.inputVideo, scanStart, scanEnd - scanStart);
        } catch {
            silences = [];
        }

        let clipStart = snapStart(startTime, silences) ?? Math.max(0, startTime - 0.15);
        let clipEnd = snapEnd(endTime, silences) ?? endTime + 0.15;

        // Safety net: never let snapping invert or over-shorten a clip.
        if (clipEnd - clipStart < 1.0) {
            clipStart = Math.max(0, startTime - 0.15);
            clipEnd = endTime + 0.15;
        }

        const duration = clipEnd - clipStart;

        const preSeek = Math.max(0, clipStart - KEYFRAME_SEEK_BUFFER);
        const postSeek = clipStart - preSeek;

        const safeTitle = clip.title.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
        const outPath = path.join(outputDir, `${safeTitle}.mp4`);

        // Re-encode audio for a sample-accurate cut (copying AAC snaps to packet
        // boundaries and leaves a priming pop). loudnorm keeps levels consistent
        // across clips; the short afades remove edge clicks. Audio-only — no
        // visual fade, so downstream transitions are unaffected.
        
        // --- FIX IS HERE: offset fades by postSeek ---
        const fadeInStart = postSeek;
        const actualFadeOutStart = postSeek + Math.max(0, duration - 0.06);

        const audioFilter =
            `loudnorm=I=-16:TP=-1.5:LRA=11,` +
            `afade=t=in:st=${fadeInStart.toFixed(3)}:d=0.04,` +
            `afade=t=out:st=${actualFadeOutStart.toFixed(3)}:d=0.06`;
        // ---------------------------------------------

        const args = [
            "-ss", preSeek.toFixed(3),
            "-i", job.inputVideo,
            "-ss", postSeek.toFixed(3),
            "-t", duration.toFixed(3),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-af", audioFilter,
            "-map_metadata", "-1",
            "-movflags", "+faststart",
            "-y",
            outPath,
        ];

        await runCmd("ffmpeg", args, {}, MAX_PROCESSING_TIME);

        completed++;
        job.progress = Math.round((completed / job.clips.length) * 100);
        job.status = "processing";
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
        console.log(`[Clip Job ${jobId}] Clip ${i + 1}/${job.clips.length} done — ${safeTitle}`);

        return fs.existsSync(outPath) ? outPath : null;
    });

    const outputs = await runWithConcurrency(tasks, CLIP_CONCURRENCY);
    const results = outputs.filter((p): p is string => p !== null);

    job.status = "done";
    job.results = results;
    job.progress = 100;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
    console.log(`[Clip Job ${jobId}] COMPLETED — ${results.length}/${job.clips.length} clips`);
}

clips.post("/", express.json(), async (req, res) => {
    try {
        console.log("===== /clip-video called =====");

        const { videoPath, clips: reqClips } = req.body;

        if (!videoPath || !fs.existsSync(videoPath)) {
            res.status(400).json({ error: "Valid videoPath is required" });
            return;
        }
        if (!reqClips || !Array.isArray(reqClips) || reqClips.length === 0) {
            res.status(400).json({ error: "clips array is required and must not be empty" });
            return;
        }

        const jobId = `clip_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);

        fs.mkdirSync(jobDir, { recursive: true });

        const job: any = {
            id: jobId,
            status: "pending",
            inputVideo: videoPath,
            clips: reqClips.map((c: any) => ({
                title: c.title,
                start_ffmpeg: c.start_ffmpeg,
                end_ffmpeg: c.end_ffmpeg,
            })),
            outputDir: path.join(jobDir, "clips"),
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        // Fire and forget
        (async () => {
            const jobFile = path.join(jobDir, "job.json");
            try {
                job.status = "processing";
                await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
                await processClipJob(jobId, jobDir, jobFile, job);
            } catch (err) {
                console.error(`[Clip Job ${jobId}] FAILED:`, err);
                job.status = "error";
                job.error = String(err);
                await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
            }
        })();

        res.json({
            jobId,
            status: "pending",
            status_url: `/clip-video/status/${jobId}`,
            download_url: `/clip-video/download/${jobId}`,
            files_url: `/clip-video/files/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /clip-video:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

clips.get("/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: any = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    return res.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress ?? 0,
        ...(job.status === "done" && { result_paths: job.results }),
        ...(job.error && { error: job.error }),
    });
});

clips.get("/files/:jobId", async (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: any = JSON.parse(await fsPromises.readFile(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished", status: job.status, progress: job.progress ?? 0 });
    }

    if (!job.results || job.results.length === 0) {
        return res.status(404).json({ error: "No clips found" });
    }

    const files = job.results.map((filePath: string) => ({
        fileName: path.basename(filePath),
        downloadUrl: `/clip-video/file/${req.params.jobId}/${path.basename(filePath)}`,
    }));

    return res.json({ jobId: job.id, total: files.length, files });
});

clips.get("/file/:jobId/:fileName", (req, res) => {
    const safeFileName = path.basename(req.params.fileName);
    const filePath = path.join(JOBS_DIR, req.params.jobId, "clips", safeFileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    return res.download(filePath, safeFileName);
});

clips.get("/download/:jobId", async (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: any = JSON.parse(await fsPromises.readFile(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    if (!job.results || job.results.length === 0) {
        return res.status(404).json({ error: "No clips found" });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="clips.zip"`);

    const archive = archiver("zip", { zlib: { level: 0 } });
    archive.pipe(res);

    for (const clipPath of job.results) {
        if (fs.existsSync(clipPath)) {
            archive.file(clipPath, { name: path.basename(clipPath) });
        }
    }

    archive.finalize();

    archive.on("error", (err) => {
        console.error("Archive error:", err);
        res.status(500).end();
    });
});

export default clips;