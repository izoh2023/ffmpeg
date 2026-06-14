import { Router } from "express";
import { promises as fsPromises } from "fs";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from 'uuid';
import { JOBS_DIR, MAX_PROCESSING_TIME, upload } from "../../utils/configs";
import { generatePillImages } from "../../utils/generatePillImages";
import { runCmd } from "../../utils/runCmd";


const overlay = Router()

function buildOverlayArgs({
    inputVideo,
    outPath,
    hostSide,
    logoPath,
    hostPill,
    guestPill,
}: OverlayParams): string[] {
    const hostIsTop = hostSide === "left";

    const logoY = hostIsTop ? "20" : "H/2+20";
    const hostPillY = hostIsTop ? "H/2-h-23" : "H-h-23";
    const guestPillY = hostIsTop ? "H-h-23" : "H/2-h-23";
    const hostShadowY = hostIsTop ? "H/2-h-18" : "H-h-18";
    const guestShadowY = hostIsTop ? "H-h-18" : "H/2-h-18";

    const filterComplex = [
        `[1:v]scale=120:-1[logo]`,
        `[2:v]scale=300:-1[hshadow]`,
        `[3:v]scale=300:-1[hpill]`,
        `[4:v]scale=300:-1[gshadow]`,
        `[5:v]scale=300:-1[gpill]`,
        `[0:v][logo]overlay=W-w-20:${logoY}[v1]`,
        `[v1][hshadow]overlay=20:${hostShadowY}[v2]`,
        `[v2][hpill]overlay=20:${hostPillY}[v3]`,
        `[v3][gshadow]overlay=20:${guestShadowY}[v4]`,
        `[v4][gpill]overlay=20:${guestPillY}[vout]`,
    ].join(";");

    return [
        "-threads", "0",              // Optimization: Use all CPU cores
        "-i", inputVideo,
        "-i", logoPath,
        "-i", hostPill.shadowPath,
        "-i", hostPill.pillPath,
        "-i", guestPill.shadowPath,
        "-i", guestPill.pillPath,
        "-filter_complex", filterComplex,
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-crf", "23",                 // Optimization: Balance quality/speed
        "-preset", "ultrafast",       // Optimization: THE SPEED KING
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "copy",               // Optimization: No audio re-encoding
        "-y",
        outPath,
    ];
}


export async function processOverlayJob(jobId: string, jobDir: string, jobFile: string, job: OverlayJobData) {
    console.log(`[Overlay Job ${jobId}] Starting processing...`);
    let hostPill, guestPill;

    try {
        job.progress = 10;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        hostPill = await generatePillImages(job.hostName, job.pillConfig);
        guestPill = await generatePillImages(job.guestName, job.pillConfig);

        job.progress = 30;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        const finalOut = path.join(jobDir, "output.mp4");
        const ffmpegArgs = buildOverlayArgs({
            inputVideo: job.inputVideo,
            outPath: finalOut,
            hostSide: job.hostSide,
            logoPath: job.logoPath,
            hostPill,
            guestPill,
        });

        job.progress = 50;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        // Use the optimized runCmd with throttled logging
        await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

        const stats = await fsPromises.stat(finalOut);

        job.status = "done";
        job.result = finalOut;
        job.progress = 100;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
        console.log(`[Overlay Job ${jobId}] COMPLETED - ${stats.size} bytes`);

    } finally {
        // Cleanup temp images regardless of success/fail
        if (hostPill) {
            fs.unlink(hostPill.pillPath, () => { });
            fs.unlink(hostPill.shadowPath, () => { });
        }
        if (guestPill) {
            fs.unlink(guestPill.pillPath, () => { });
            fs.unlink(guestPill.shadowPath, () => { });
        }
    }
}

overlay.post("/", upload.fields([{ name: "logo", maxCount: 1 }]), async (req, res) => {
    try {
        console.log("===== /overlay-video called =====");

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const logoFile = files?.logo?.[0];

        if (!logoFile) {
            return res.status(400).json({ error: "Logo file required in 'logo' field" });
        }

        const { videoPath, hostName, guestName, hostSide, pillConfig } = req.body;

        if (!videoPath || !fs.existsSync(videoPath)) {
            return res.status(400).json({ error: "Valid videoPath is required" });
        }
        if (!hostName || !guestName) {
            return res.status(400).json({ error: "hostName and guestName are required" });
        }
        if (!hostSide || !["left", "right"].includes(hostSide.toLowerCase())) {
            return res.status(400).json({ error: "hostSide must be 'left' or 'right'" });
        }

        const jobId = `overlay_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);

        fs.mkdirSync(jobDir, { recursive: true });

        const logoExt = path.extname(logoFile.originalname) || ".png";
        const logoPath = path.join(jobDir, `logo${logoExt}`);

        try {
            fs.renameSync(logoFile.path, logoPath);
        } catch (moveError) {
            fs.copyFileSync(logoFile.path, logoPath);
            fs.unlinkSync(logoFile.path);
        }

        const job: OverlayJobData = {
            id: jobId,
            status: "pending",
            inputVideo: videoPath,
            outputVideo: path.join(jobDir, "output.mp4"),
            hostName,
            guestName,
            hostSide,
            logoPath,
            pillConfig: pillConfig ? JSON.parse(pillConfig) : {},
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/overlay-video/status/${jobId}`,
            download_url: `/overlay-video/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /overlay-video:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

overlay.get("/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: OverlayJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    return res.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress ?? 0,
        ...(job.status === "done" && { result_path: job.result }),
        ...(job.error && { error: job.error }),
    });
});

overlay.get("/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: OverlayJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

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


export default overlay