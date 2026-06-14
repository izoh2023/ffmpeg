import { Router } from "express";
import { spawn } from 'child_process';
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from 'uuid';
import { JOBS_DIR, MAX_PROCESSING_TIME, upload } from "../../utils/configs";
import { runCmd } from "../../utils/runCmd";

const v_stack = Router()

async function detectCrop(inputVideo: string): Promise<{ w: number; h: number; x: number; y: number }> {
    return new Promise((resolve, reject) => {
        const args = ["-ss", "20", "-i", inputVideo, "-vf", "cropdetect", "-t", "3", "-f", "null", "-"];
        const proc = spawn("ffmpeg", args);
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", () => {
            const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
            if (!matches.length) return reject(new Error("cropdetect returned no results"));
            const last = matches[matches.length - 1];
            resolve({ w: +last[1], h: +last[2], x: +last[3], y: +last[4] });
        });
        proc.on("error", reject);
    });
}

async function detectFaceCenter(
    inputVideo: string,
    cropRegion?: { x: number; y: number; w: number; h: number }
): Promise<{ cx: number; cy: number; frame_w?: number; frame_h?: number }> {
    return new Promise((resolve) => {
        const args: string[] = [
            path.join(process.cwd(), "face_center.py"),
            inputVideo,
            "25",
        ];
        if (cropRegion) {
            args.push(
                String(cropRegion.x),
                String(cropRegion.y),
                String(cropRegion.w),
                String(cropRegion.h)
            );
        }

        const proc = spawn("python3", args);
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", () => {
            try {
                const result = JSON.parse(stdout.trim());
                if (result.cx === -1) console.warn("[FaceDetect] No face found, will use fallback framing");
                resolve(result);
            } catch {
                console.warn("[FaceDetect] Failed to parse output, using fallback:", stderr);
                resolve({ cx: -1, cy: -1 });
            }
        });
        proc.on("error", () => resolve({ cx: -1, cy: -1 }));
    });
}

function buildProcessVideoArgs({ inputVideo, outPath, crop, faceLeft, faceRight }: 
    ProcessVideoParams & {
        faceLeft: { cx: number; cy: number };
        faceRight: { cx: number; cy: number };
    }
): string[] {
    const { w, h, x, y } = crop;
    const half = Math.floor(w / 2);

    const PANEL_W = 1080;
    const PANEL_H = 960; // Two panels stacked → 1080x1920 (9:16)

    const panelFilter = (cropX: number, face: { cx: number; cy: number }) => {
        // Try scaling to fill height first
        const scaleByH = PANEL_H / h;
        const scaledWbyH = Math.floor(half * scaleByH);

        if (scaledWbyH >= PANEL_W) {
            // Scale to fill height, crop excess width centered on face x
            const faceScaledX = face.cx > 0
                ? Math.round(face.cx * scaleByH)
                : Math.floor(scaledWbyH / 2);
            const cropXOffset = Math.max(0, Math.min(
                faceScaledX - Math.floor(PANEL_W / 2),
                scaledWbyH - PANEL_W
            ));
            return (
                `crop=${half}:${h}:${cropX}:${y},` +
                `scale=${scaledWbyH}:${PANEL_H},` +
                `crop=${PANEL_W}:${PANEL_H}:${cropXOffset}:0`
            );
        }

        // Source is too wide/short to fill height — scale by width instead, crop height on face y
        const scaleByW = PANEL_W / half;
        const scaledHbyW = Math.floor(h * scaleByW);

        if (scaledHbyW >= PANEL_H) {
            // Enough height — crop vertically centered on face
            const faceScaledY = face.cy > 0
                ? Math.round(face.cy * scaleByW)
                : Math.floor(scaledHbyW / 2);
            const cropYOffset = Math.max(0, Math.min(
                faceScaledY - Math.round(PANEL_H * 0.35),
                scaledHbyW - PANEL_H
            ));
            return (
                `crop=${half}:${h}:${cropX}:${y},` +
                `scale=${PANEL_W}:${scaledHbyW},` +
                `crop=${PANEL_W}:${PANEL_H}:0:${cropYOffset}`
            );
        }

        // Source is very small — scale up to fill width and pad height with black
        return (
            `crop=${half}:${h}:${cropX}:${y},` +
            `scale=${PANEL_W}:${scaledHbyW},` +
            `pad=${PANEL_W}:${PANEL_H}:0:(oh-ih)/2:black`
        );
    };

    const filter = [
        `[0:v]${panelFilter(x, faceLeft)}[tops];`,
        `[0:v]${panelFilter(x + half, faceRight)}[bots];`,
        `[tops][bots]vstack=inputs=2,setsar=1`
    ].join("");

    return [
        "-threads", "0",
        "-i", inputVideo,
        "-filter_complex", filter,
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-y",
        outPath,
    ];
}

export async function processProcessVideoJob(jobId: string, jobDir: string, jobFile: string, job: ProcessVideoJobData) {
    console.log(`[ProcessVideo Job ${jobId}] Starting processing...`);

    job.progress = 10;
    await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));

    // Stage 1: Detect black bar crop bounds
    const crop = await detectCrop(job.inputVideo);
    console.log(`[ProcessVideo Job ${jobId}] Detected crop: w=${crop.w} h=${crop.h} x=${crop.x} y=${crop.y}`);

    job.progress = 20;
    await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));

    const half = Math.floor(crop.w / 2);

    // Stage 2: Detect face center for each half independently
    const faceLeftRaw = await detectFaceCenter(job.inputVideo, {
        x: crop.x, y: crop.y, w: half, h: crop.h,
    });
    const faceLeft = { cx: faceLeftRaw.cx ?? -1, cy: faceLeftRaw.cy ?? -1 };
    console.log(`[ProcessVideo Job ${jobId}] Left face: cx=${faceLeft.cx} cy=${faceLeft.cy}`);

    const faceRightRaw = await detectFaceCenter(job.inputVideo, {
        x: crop.x + half, y: crop.y, w: half, h: crop.h,
    });
    const faceRight = { cx: faceRightRaw.cx ?? -1, cy: faceRightRaw.cy ?? -1 };
    console.log(`[ProcessVideo Job ${jobId}] Right face: cx=${faceRight.cx} cy=${faceRight.cy}`);

    job.progress = 40;
    await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "output.mp4");
    const ffmpegArgs = buildProcessVideoArgs({
        inputVideo: job.inputVideo,
        outPath: finalOut,
        crop,
        faceLeft,
        faceRight,
    });

    job.progress = 50;
    await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    if (!fs.existsSync(finalOut)) throw new Error("Output file was not created");
    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) throw new Error("Output file is too small (likely corrupt)");

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
    console.log(`[ProcessVideo Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

v_stack.post("/", upload.single("video"), async (req, res) => {
    try {
        console.log("===== /process-video called =====");
        console.log("req.headers:", req.headers);
        console.log("req.body:", req.body);

        if (req.file) {
            console.log("req.file:", {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                path: req.file.path,
                size: req.file.size,
            });
        } else {
            console.log("No file uploaded - req.file is undefined");
        }

        if (!req.file) {
            return res.status(400).json({
                error: "Video file required in 'video' field",
            });
        }

        const jobId = `process_video_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const inputVideo = path.join(jobDir, "input.mp4");

        fs.mkdirSync(jobDir, { recursive: true });

        try {
            fs.renameSync(req.file.path, inputVideo);
        } catch (moveError) {
            fs.copyFileSync(req.file.path, inputVideo);
            fs.unlinkSync(req.file.path);
        }

        const job: ProcessVideoJobData = {
            id: jobId,
            status: "pending",
            inputVideo,
            outputVideo: path.join(jobDir, "output.mp4"),
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        // Fire and forget — job runs in background
        (async () => {
            const jobFile = path.join(jobDir, "job.json");
            try {
                job.status = "processing";
                await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
                await processProcessVideoJob(jobId, jobDir, jobFile, job);
            } catch (err) {
                console.error(`[ProcessVideo Job ${jobId}] FAILED:`, err);
                job.status = "error";
                job.error = String(err);
                await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
            }
        })();

        return res.json({
            jobId,
            status: "pending",
            status_url: `/process-video/status/${jobId}`,
            download_url: `/process-video/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /process-video:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

v_stack.get("/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: ProcessVideoJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    return res.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress ?? 0,
        ...(job.status === "done" && { result_path: job.result }),
        ...(job.error && { error: job.error }),
    });
});

v_stack.get("/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: ProcessVideoJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

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

export default v_stack