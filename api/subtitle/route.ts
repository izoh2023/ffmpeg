import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from 'uuid';
import { promises as fsPromises } from "fs";
import { JOBS_DIR, MAX_PROCESSING_TIME, upload } from "../../utils/configs";
import { runCmd } from "../../utils/runCmd";

const subtitle = Router()


export async function processSubtitleJob(jobId: string, jobDir: string, jobFile: string, job: SubtitleJobData) {
    console.log(`[Subtitle Job ${jobId}] Starting processing...`);

    job.progress = 10;
    // Optimization: Non-blocking write
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "output.mp4");

    const args = [
        "-threads", "0",              // Optimization: Use all CPU cores
        "-i", job.inputVideo,
        "-vf", `ass='${job.subtitlesPath}'`, // Wrap in quotes to handle path spaces
        "-c:v", "libx264",
        "-preset", "ultrafast",       // Optimization: THE SPEED KING
        "-crf", "23",                 // Optimization: Standard quality (fastest)
        "-c:a", "copy",               // Optimization: Do not touch audio
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-y", finalOut,
    ];

    job.progress = 30; // Better progress marking
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

    // Execution with our throttled runCmd
    await runCmd("ffmpeg", args, {}, MAX_PROCESSING_TIME);

    const stats = await fsPromises.stat(finalOut);
    if (stats.size < 1000) {
        throw new Error("Output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
    console.log(`[Subtitle Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

subtitle.post("/", upload.single("subtitles"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "subtitles is required" });
        }

        const { videoPath } = req.body;
        if (!videoPath || !fs.existsSync(videoPath)) {
            return res.status(400).json({ error: "Valid videoPath is required" });
        }

        const jobId = `subtitle_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);

        fs.mkdirSync(jobDir, { recursive: true });

        const subtitlesPath = path.join(jobDir, "subtitles.ass");

        // Optimization: renameSync moves the file. 
        try {
            fs.renameSync(req.file.path, subtitlesPath);
        } catch (moveError) {
            fs.copyFileSync(req.file.path, subtitlesPath);
            fs.unlinkSync(req.file.path);
        }

        const job: SubtitleJobData = {
            id: jobId,
            status: "pending",
            inputVideo: videoPath,
            subtitlesPath,
            outputVideo: path.join(jobDir, "output.mp4"),
        };

        // Use standard sync write here since it's a tiny JSON during request handling
        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        res.json({
            jobId,
            status: "pending",
            status_url: `/subtitle-video/status/${jobId}`,
            download_url: `/subtitle-video/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /subtitle-video:", err);
        res.status(500).json({ error: "Internal Error" });
    }
});

subtitle.get("/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: SubtitleJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    return res.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress ?? 0,
        ...(job.status === "done" && { result_path: job.result }),
        ...(job.error && { error: job.error }),
    });
});

subtitle.get("/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: SubtitleJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on("error", (err) => {
        console.error("File stream error:", err);
        res.status(500).end();
    });
});

export default subtitle