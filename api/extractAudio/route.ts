import { Router } from "express";
import { JOBS_DIR, MAX_PROCESSING_TIME, upload } from "../../utils/configs";
import { v4 as uuidv4 } from 'uuid';
import { promises as fsPromises } from "fs";
import fs from "node:fs";
import path from "node:path";
import { runCmd } from "../../utils/runCmd";

const extractAudio = Router();

async function processExtractAudioJob(jobId: string, jobDir: string, jobFile: string, inputVideo: string) {
    console.log(`[ExtractAudio Job ${jobId}] Starting...`);

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    job.progress = 10;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

    const outputAudio = path.join(jobDir, "output.mp3");

    const ffmpegArgs = [
        "-i", inputVideo,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "64k",
        "-y",
        outputAudio,
    ];

    job.progress = 30;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    job.progress = 90;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

    const stats = await fsPromises.stat(outputAudio);
    if (stats.size < 100) throw new Error("Output audio file is too small (likely corrupt)");

    job.status   = "done";
    job.result   = outputAudio;
    job.progress = 100;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
    console.log(`[ExtractAudio Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

extractAudio.post("/", upload.fields([
    { name: "video" },
]), async (req, res) => {
    try {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };

        if (!files?.video?.[0]) return res.status(400).json({ error: "Video file required in 'video' field" });

        const jobId      = `extract_audio_${Date.now()}_${uuidv4()}`;
        const jobDir     = path.join(JOBS_DIR, jobId);
        const inputVideo = path.join(jobDir, "input.mp4");

        fs.mkdirSync(jobDir, { recursive: true });

        const moveFile = (src: string, dest: string) => {
            try { fs.renameSync(src, dest); }
            catch { fs.copyFileSync(src, dest); fs.unlinkSync(src); }
        };

        moveFile(files.video[0].path, inputVideo);

        const job = {
            id:       jobId,
            status:   "pending",
            progress: 0,
            inputVideo,
        };

        const jobFile = path.join(jobDir, "job.json");
        fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

        processExtractAudioJob(jobId, jobDir, jobFile, inputVideo).catch((err) => {
            console.error(`[ExtractAudio Job ${jobId}] FAILED:`, err);
            const j = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
            j.status = "error";
            j.error  = String(err);
            fs.writeFileSync(jobFile, JSON.stringify(j, null, 2));
        });

        return res.json({
            jobId,
            status:       "pending",
            status_url:   `/extract_audio/status/${jobId}`,
            download_url: `/extract_audio/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /extract_audio:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

extractAudio.get("/status/:jobId", (req, res) => {
    const jobFile = path.join(JOBS_DIR, req.params.jobId, "job.json");
    if (!fs.existsSync(jobFile)) return res.status(404).json({ error: "Job not found" });
    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    return res.json({
        jobId:    job.id,
        status:   job.status,
        progress: job.progress ?? 0,
        ...(job.status === "done" && { result_path: job.result }),
        ...(job.error && { error: job.error }),
    });
});

extractAudio.get("/download/:jobId", (req, res) => {
    const jobFile = path.join(JOBS_DIR, req.params.jobId, "job.json");
    if (!fs.existsSync(jobFile)) return res.status(404).json({ error: "Job not found" });
    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    if (job.status !== "done") return res.status(400).json({ error: "Job not finished" });
    if (!job.result || !fs.existsSync(job.result)) return res.status(404).json({ error: "Result file not found" });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(job.result)}"`);
    const stream = fs.createReadStream(job.result);
    stream.pipe(res);
    stream.on("error", (err) => { console.error("Stream error:", err); res.status(500).end(); });
});

export default extractAudio;