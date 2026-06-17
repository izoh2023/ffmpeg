import { Router } from "express";
import { spawn } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { JOBS_DIR, MAX_PROCESSING_TIME, upload } from "../../utils/configs";
import { runCmd } from "../../utils/runCmd";

const logoSwap = Router();

// ── types ────────────────────────────────────────────────────────────────────

interface LogoSwapJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    progress: number;
    inputVideo: string;
    newLogo: string;
    result?: string;
    error?: string;
}

interface DelogoRegion {
    x: number;
    y: number;
    w: number;
    h: number;
    frame_w: number;
    frame_h: number;
    content_top: number;
    content_bottom: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function detectLogo(videoPath: string): Promise<DelogoRegion> {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(process.cwd(), "detect_logo.py");
        const proc = spawn("python3", [scriptPath, "--video", videoPath]);

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));

        proc.on("close", () => {
            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) return reject(new Error(`Logo detection: ${result.error}`));
                resolve(result as DelogoRegion);
            } catch {
                reject(new Error(`Failed to parse detect_logo output: ${stderr || stdout}`));
            }
        });

        proc.on("error", (err) =>
            reject(new Error(`Failed to spawn detect_logo.py: ${err.message}`))
        );
    });
}

function resolveOverlayConfig(region: DelogoRegion): {
    mode: string;
    size: number;
    x: number;
    y: number;
} {
    const margin = 12;

    if (region.frame_w > region.frame_h) {
        // Landscape — offset y by content_top to skip black bars
        const size = 80;
        return {
            mode: "landscape",
            size,
            x: region.frame_w - size - margin,
            y: region.content_top + margin,
        };
    } else {
        const size = 140;
        return {
            mode: "portrait",
            size,
            x: region.frame_w - size - margin,
            y: region.y,
        };
    }
}

// ── job processor ─────────────────────────────────────────────────────────────

export async function processLogoSwapJob(
    jobId: string,
    jobDir: string,
    jobFile: string,
    job: LogoSwapJobData
) {
    console.log(`[LogoSwap ${jobId}] Starting...`);

    const update = async (progress: number) => {
        job.progress = progress;
        await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
    };

    // ── Step 1: detect old logo ──
    await update(10);
    console.log(`[LogoSwap ${jobId}] Detecting logo...`);
    const region = await detectLogo(job.inputVideo);
    console.log(`[LogoSwap ${jobId}] Detected: x=${region.x} y=${region.y} w=${region.w} h=${region.h} frame=${region.frame_w}x${region.frame_h} content_top=${region.content_top}`);

    // ── Step 2: resolve overlay config ──
    const overlay = resolveOverlayConfig(region);
    console.log(`[LogoSwap ${jobId}] Mode: ${overlay.mode} → size=${overlay.size}px at x=${overlay.x} y=${overlay.y}`);

    // ── Step 3: single-pass delogo + overlay ──
    await update(30);
    const finalOut = path.join(jobDir, "output.mp4");

    // Clamp delogo region strictly inside frame (ffmpeg delogo rejects edge-touching regions)
    const delogoX = Math.min(region.x, region.frame_w - 2);
    const delogoY = Math.min(region.y, region.frame_h - 2);
    const delogoW = Math.min(region.w, region.frame_w - delogoX - 1);
    const delogoH = Math.min(region.h, region.frame_h - delogoY - 1);

    const filterComplex = [
        `[0:v]delogo=x=${delogoX}:y=${delogoY}:w=${delogoW}:h=${delogoH}[clean]`,
        `[1:v]scale=${overlay.size}:-1[logo]`,
        `[clean][logo]overlay=${overlay.x}:${overlay.y}`,
    ].join(";");

    console.log(`[LogoSwap ${jobId}] Running single-pass delogo + overlay...`);
    await runCmd(
        "ffmpeg",
        [
            "-threads", "0",
            "-i", job.inputVideo,
            "-i", job.newLogo,
            "-filter_complex", filterComplex,
            "-c:v", "libx264",
            "-crf", "23",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-y", finalOut,
        ],
        {},
        MAX_PROCESSING_TIME
    );

    if (!fs.existsSync(finalOut)) throw new Error("Final output not created");
    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) throw new Error("Output file too small (likely corrupt)");

    job.status   = "done";
    job.result   = finalOut;
    job.progress = 100;
    await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
    console.log(`[LogoSwap ${jobId}] DONE — ${stats.size} bytes`);
}

// ── routes ────────────────────────────────────────────────────────────────────

logoSwap.post("/", upload.single("logo"), async (req, res) => {
    try {
        const { videoPath } = req.body;

        if (!videoPath)                return res.status(400).json({ error: "videoPath is required" });
        if (!fs.existsSync(videoPath)) return res.status(400).json({ error: `Video not found: ${videoPath}` });
        if (!req.file)                 return res.status(400).json({ error: "New logo file required in 'logo' field" });

        const jobId    = `logo_swap_${Date.now()}_${uuidv4()}`;
        const jobDir   = path.join(JOBS_DIR, jobId);
        const logoPath = path.join(jobDir, "new_logo" + path.extname(req.file.originalname || ".png"));

        fs.mkdirSync(jobDir, { recursive: true });

        try {
            fs.renameSync(req.file.path, logoPath);
        } catch {
            fs.copyFileSync(req.file.path, logoPath);
            fs.unlinkSync(req.file.path);
        }

        const job: LogoSwapJobData = {
            id: jobId,
            status: "pending",
            progress: 0,
            inputVideo: videoPath,
            newLogo: logoPath,
        };

        const jobFile = path.join(jobDir, "job.json");
        fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

        (async () => {
            try {
                job.status = "processing";
                await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
                await processLogoSwapJob(jobId, jobDir, jobFile, job);
            } catch (err) {
                console.error(`[LogoSwap ${jobId}] FAILED:`, err);
                job.status = "error";
                job.error  = String(err);
                await fs.promises.writeFile(jobFile, JSON.stringify(job, null, 2));
            }
        })();

        return res.json({
            jobId,
            status:       "pending",
            status_url:   `/swap-logo/status/${jobId}`,
            download_url: `/swap-logo/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /swap-logo:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

logoSwap.get("/status/:jobId", (req, res) => {
    const jobFile = path.join(JOBS_DIR, req.params.jobId, "job.json");
    if (!fs.existsSync(jobFile)) return res.status(404).json({ error: "Job not found" });

    try {
        const raw = fs.readFileSync(jobFile, "utf-8");
        if (!raw.trim()) return res.status(202).json({ status: "pending", progress: 0 });
        const job: LogoSwapJobData = JSON.parse(raw);
        return res.json({
            jobId:    job.id,
            status:   job.status,
            progress: job.progress ?? 0,
            ...(job.status === "done" && { result_path: job.result }),
            ...(job.error && { error: job.error }),
        });
    } catch {
        return res.status(202).json({ status: "pending", progress: 0 });
    }
});

logoSwap.get("/download/:jobId", (req, res) => {
    const jobFile = path.join(JOBS_DIR, req.params.jobId, "job.json");
    if (!fs.existsSync(jobFile)) return res.status(404).json({ error: "Job not found" });

    const job: LogoSwapJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    if (job.status !== "done")                     return res.status(400).json({ error: "Job not finished yet" });
    if (!job.result || !fs.existsSync(job.result)) return res.status(404).json({ error: "Result file not found" });

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="output.mp4"`);

    const stream = fs.createReadStream(job.result);
    stream.pipe(res);
    stream.on("error", (err) => {
        console.error("Stream error:", err);
        res.status(500).end();
    });
});

export default logoSwap;