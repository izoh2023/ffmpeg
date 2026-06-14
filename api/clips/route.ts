import express from 'express';
import { Router } from "express";
import { v4 as uuidv4 } from 'uuid';
import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "fs";
import archiver from "archiver";
import { JOBS_DIR, MAX_PROCESSING_TIME } from "../../utils/configs";
import { runCmd } from "../../utils/runCmd";

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

export async function processClipJob(jobId: string, jobDir: string, jobFile: string, job: ClipJobData) {
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

    const tasks = job.clips.map((clip, i) => async (): Promise<string | null> => {
        const startTime = hhmmssToSeconds(clip.start_ffmpeg);
        const endTime = hhmmssToSeconds(clip.end_ffmpeg);

        const safeStart = Math.max(0, startTime - 0.2);
        const safeEnd = endTime + 0.4;
        const duration = safeEnd - safeStart;

        const preSeek = Math.max(0, safeStart - KEYFRAME_SEEK_BUFFER);
        const postSeek = safeStart - preSeek;

        const safeTitle = clip.title.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
        const outPath = path.join(outputDir, `${safeTitle}.mp4`);

        const args = [
            "-ss", preSeek.toFixed(3),
            "-i", job.inputVideo,
            "-ss", postSeek.toFixed(3),
            "-t", duration.toFixed(3),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-c:a", "copy",
            "-pix_fmt", "yuv420p",
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

        const { videoPath, clips } = req.body;

        if (!videoPath || !fs.existsSync(videoPath)) {
            res.status(400).json({ error: "Valid videoPath is required" });
            return;
        }
        if (!clips || !Array.isArray(clips) || clips.length === 0) {
            res.status(400).json({ error: "clips array is required and must not be empty" });
            return;
        }

        const jobId = `clip_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);

        fs.mkdirSync(jobDir, { recursive: true });

        const job: ClipJobData = {
            id: jobId,
            status: "pending",
            inputVideo: videoPath,
            clips: clips.map((c: any) => ({
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

    const job: ClipJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

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

    const job: ClipJobData = JSON.parse(await fsPromises.readFile(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished", status: job.status, progress: job.progress ?? 0 });
    }

    if (!job.results || job.results.length === 0) {
        return res.status(404).json({ error: "No clips found" });
    }

    const files = job.results.map((filePath) => ({
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

    const job: ClipJobData = JSON.parse(await fsPromises.readFile(jobFile, "utf-8"));

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