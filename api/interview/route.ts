import { Router } from "express";
import { JOBS_DIR, MAX_PROCESSING_TIME, upload } from "../../utils/configs";
import { v4 as uuidv4 } from 'uuid';
import { promises as fsPromises } from "fs";
import { spawn } from 'child_process';
import fs from "node:fs";
import path from "node:path";
import { generatePillImages } from "../../utils/generatePillImages";
import { runCmd } from "../../utils/runCmd";

const interview = Router();

async function probeVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const proc = spawn("ffprobe", [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            videoPath,
        ]);
        let out = "";
        proc.stdout.on("data", (d) => (out += d.toString()));
        proc.on("close", () => {
            try {
                const { width, height } = JSON.parse(out).streams[0];
                resolve({ width, height });
            } catch { reject(new Error("Could not probe video dimensions")); }
        });
        proc.on("error", reject);
    });
}

async function detectCrop(
    videoPath: string,
    fallback: { w: number; h: number }
): Promise<{ w: number; h: number; x: number; y: number }> {
    return new Promise((resolve) => {
        const proc = spawn("ffmpeg", ["-ss", "10", "-i", videoPath, "-vf", "cropdetect", "-t", "3", "-f", "null", "-"]);
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", () => {
            const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
            if (!matches.length) return resolve({ w: fallback.w, h: fallback.h, x: 0, y: 0 });
            const last = matches[matches.length - 1];
            resolve({ w: +last[1], h: +last[2], x: +last[3], y: +last[4] });
        });
        proc.on("error", () => resolve({ w: fallback.w, h: fallback.h, x: 0, y: 0 }));
    });
}

async function processFullInterviewJob(jobId: string, jobDir: string, jobFile: string, job: FullInterviewJobData) {
    console.log(`[FullInterview Job ${jobId}] Starting...`);

    job.progress = 10;
    await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

    // ── Step 1: pill generation + video probe in parallel ──
    const [hostPill, guestPill, dimensions] = await Promise.all([
        generatePillImages(job.hostname,  job.pillConfig),
        generatePillImages(job.guestname, job.pillConfig),
        probeVideoDimensions(job.inputVideo),
    ]);

    try {
        const { width: vw, height: vh } = dimensions;

        job.progress = 25;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        // ── Step 2: cropdetect ──
        const crop = await detectCrop(job.inputVideo, { w: vw, h: vh });

        job.progress = 40;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        const margin       = 16;
        const shadowOffset = 5;
        const logoDisplayW = 60;

        const contentTop    = crop.y;
        const contentBottom = crop.y + crop.h;
        const contentLeft   = crop.x;
        const contentRight  = crop.x + crop.w;

        const logoX = contentRight - logoDisplayW - margin;
        const logoY = contentTop + margin;

        const hostPillX  = job.hostside === "left" ? contentLeft + margin : contentRight - hostPill.width - margin;
        const guestPillX = job.hostside === "left" ? contentRight - guestPill.width - margin : contentLeft + margin;
        const pillY      = contentBottom - hostPill.height - margin;

        const overlaidOut = (job.introPath || job.outroPath)
            ? path.join(jobDir, "overlaid.mp4")
            : path.join(jobDir, "output.mp4");

        const ffmpegArgs = [
            "-i", job.inputVideo,
            "-i", job.logoPath,
            "-i", hostPill.shadowPath,
            "-i", hostPill.pillPath,
            "-i", guestPill.shadowPath,
            "-i", guestPill.pillPath,
            "-filter_complex", [
                `[1:v]scale=${logoDisplayW}:-1[logo]`,
                `[0:v][logo]overlay=${logoX}:${logoY}[v1]`,
                `[v1][2:v]overlay=${hostPillX  + shadowOffset}:${pillY + shadowOffset}[v2]`,
                `[v2][3:v]overlay=${hostPillX}:${pillY}[v3]`,
                `[v3][4:v]overlay=${guestPillX + shadowOffset}:${pillY + shadowOffset}[v4]`,
                `[v4][5:v]overlay=${guestPillX}:${pillY}[v5]`,
            ].join(";"),
            "-map", "[v5]",
            "-map", "0:a",
            "-c:v", "libx264",
            "-crf", "23",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-y",
            overlaidOut,
        ];

        job.progress = 50;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

        job.progress = 70;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        // ── Step 3: concat intro/outro with stream copy (no re-encode) ──
        const finalOut = path.join(jobDir, "output.mp4");

        if (job.introPath || job.outroPath) {
            const segments: string[] = [
                ...(job.introPath ? [job.introPath] : []),
                overlaidOut,
                ...(job.outroPath ? [job.outroPath] : []),
            ];

            const concatList = path.join(jobDir, "concat.txt");
            await fsPromises.writeFile(
                concatList,
                segments.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join("\n")
            );

            await runCmd("ffmpeg", [
                "-f", "concat",
                "-safe", "0",
                "-i", concatList,
                "-c", "copy",
                "-y",
                finalOut,
            ], {}, MAX_PROCESSING_TIME);

            fs.unlink(overlaidOut, () => {});
            fs.unlink(concatList,  () => {});
        }

        job.progress = 90;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));

        const stats = await fsPromises.stat(finalOut);
        if (stats.size < 1000) throw new Error("Output file is too small (likely corrupt)");

        job.status   = "done";
        job.result   = finalOut;
        job.progress = 100;
        await fsPromises.writeFile(jobFile, JSON.stringify(job, null, 2));
        console.log(`[FullInterview Job ${jobId}] COMPLETED - ${stats.size} bytes`);

    } finally {
        fs.unlink(hostPill.pillPath,   () => {});
        fs.unlink(hostPill.shadowPath, () => {});
        fs.unlink(guestPill.pillPath,   () => {});
        fs.unlink(guestPill.shadowPath, () => {});
    }
}

interview.post("/", upload.fields([
    { name: "video" },
    { name: "logo" },
    { name: "intro" },
    { name: "outro" },
]), async (req, res) => {
    try {
        const { hostname, guestname, hostside, pillConfig } = req.body;
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };

        if (!files?.video?.[0]) return res.status(400).json({ error: "Video file required in 'video' field" });
        if (!files?.logo?.[0])  return res.status(400).json({ error: "Logo file required in 'logo' field" });
        if (!hostname || !guestname || !hostside) return res.status(400).json({ error: "hostname, guestname, and hostside are required" });

        let parsedPillConfig = { pillBg: "#000000", pillText: "#FFFFFF", shadowBg: "#FFD400", fontSize: 16 };
        if (pillConfig) {
            try { parsedPillConfig = { ...parsedPillConfig, ...JSON.parse(pillConfig) }; }
            catch { return res.status(400).json({ error: "Invalid pillConfig JSON" }); }
        }

        const jobId      = `full_interview_${Date.now()}_${uuidv4()}`;
        const jobDir     = path.join(JOBS_DIR, jobId);
        const inputVideo = path.join(jobDir, "input.mp4");
        const logoPath   = path.join(jobDir, "logo.png");

        fs.mkdirSync(jobDir, { recursive: true });

        const moveFile = (src: string, dest: string) => {
            try { fs.renameSync(src, dest); }
            catch { fs.copyFileSync(src, dest); fs.unlinkSync(src); }
        };

        moveFile(files.video[0].path, inputVideo);
        moveFile(files.logo[0].path, logoPath);

        let introPath: string | undefined;
        let outroPath: string | undefined;

        if (files?.intro?.[0]) {
            introPath = path.join(jobDir, "intro.mp4");
            moveFile(files.intro[0].path, introPath);
        }
        if (files?.outro?.[0]) {
            outroPath = path.join(jobDir, "outro.mp4");
            moveFile(files.outro[0].path, outroPath);
        }

        const job: FullInterviewJobData = {
            id: jobId,
            status: "pending",
            inputVideo,
            logoPath,
            hostname,
            guestname,
            hostside: hostside === "left" ? "left" : "right",
            pillConfig: parsedPillConfig,
            ...(introPath && { introPath }),
            ...(outroPath && { outroPath }),
        };

        const jobFile = path.join(jobDir, "job.json");
        fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

        processFullInterviewJob(jobId, jobDir, jobFile, job).catch((err) => {
            console.error(`[FullInterview Job ${jobId}] FAILED:`, err);
            const j = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
            j.status = "error";
            j.error  = String(err);
            fs.writeFileSync(jobFile, JSON.stringify(j, null, 2));
        });

        return res.json({
            jobId,
            status:       "pending",
            status_url:   `/full_interview/status/${jobId}`,
            download_url: `/full_interview/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /full_interview:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

interview.get("/status/:jobId", (req, res) => {
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

interview.get("/download/:jobId", (req, res) => {
    const jobFile = path.join(JOBS_DIR, req.params.jobId, "job.json");
    if (!fs.existsSync(jobFile)) return res.status(404).json({ error: "Job not found" });
    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    if (job.status !== "done") return res.status(400).json({ error: "Job not finished" });
    if (!job.result || !fs.existsSync(job.result)) return res.status(404).json({ error: "Result file not found" });

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(job.result)}"`);
    const stream = fs.createReadStream(job.result);
    stream.pipe(res);
    stream.on("error", (err) => { console.error("Stream error:", err); res.status(500).end(); });
});

export default interview;