
interface JobData {
    id: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
    progress?: number;
}

interface Page1JobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
    progress?: number;
    brandName: string;
    person: string;
}

interface Page1Params {
    bgVideo: string;
    headshot: string;
    logo: string;
    qr: string;
    brandName: string;
    person: string;
    outPath: string;
    fps?: number;
}


interface Page2JobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
    progress?: number;
}

interface Page3JobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
    progress?: number;
    personName: string;
    brandName: string;
    items: { label: string; text: string; number: string }[];
}


interface Page4JobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
    progress?: number;
    personName: string;
    brandName: string;
    quote: string;
}

interface AssembleJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
    progress?: number;
}

interface AudioJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    progress: number;
    inputZip: string;
    extractDir: string;
    result?: string;
    error?: string;
}





import express from 'express';
import multer from 'multer';
// import fs from 'fs';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import sharp from "sharp";
import unzipper from "unzipper";
import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

sharp.cache(false)
sharp.concurrency(1)

// Runtime jobs directory (NOT inside dist)
const JOBS_DIR = path.join("/tmp", "jobs");
const MAX_PROCESSING_TIME = 600000; // 3 minutes max
const STALL_TIMEOUT = 60000; // 45 seconds without progress = stall


// Ensure directory exists
if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
}



// Configuration
const PORT: number = Number(process.env.PORT) || 9000;
const TMP_DIR: string = process.env.TMP_DIR || '/tmp/ffout';
const DATA_DIR: string = process.env.DATA_DIR || '/home/node/data';

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({ dest: TMP_DIR });
const app = express();
app.use(express.json({ limit: '50mb' }));

/** Helpers **/
function runCmd(
    cmd: string,
    args: string[],
    opts: Record<string, any> = {},
    timeoutMs: number = MAX_PROCESSING_TIME
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });

        let lastProgressTime = Date.now();
        let killed = false;

        // Overall timeout
        const overallTimeout = setTimeout(() => {
            if (!killed) {
                killed = true;
                child.kill('SIGKILL');
                reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        // Stall detection timeout
        const stallCheckInterval = setInterval(() => {
            if (Date.now() - lastProgressTime > STALL_TIMEOUT) {
                if (!killed) {
                    killed = true;
                    clearTimeout(overallTimeout);
                    clearInterval(stallCheckInterval);
                    child.kill('SIGKILL');
                    reject(new Error(`${cmd} stalled (no progress for ${STALL_TIMEOUT}ms)`));
                }
            }
        }, 5000);

        child.stdout.on('data', (data) => {
            console.log(`[${cmd}] ${data.toString()}`);
            lastProgressTime = Date.now();
        });

        child.stderr.on('data', (data) => {
            const output = data.toString();
            console.error(`[${cmd} ERR] ${output}`);

            // Detect FFmpeg progress
            if (output.includes('frame=') || output.includes('time=')) {
                lastProgressTime = Date.now();
            }
        });

        child.on('error', (err) => {
            clearTimeout(overallTimeout);
            clearInterval(stallCheckInterval);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(overallTimeout);
            clearInterval(stallCheckInterval);

            if (killed) return; // Already handled

            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${cmd} exited with code ${code}`));
            }
        });
    });
}

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

async function extractZip(zipPath: string, extractDir: string) {
    await fs
        .createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .promise();
}

function ffText(s: string) {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'");
}

function forceGC() {
    if (global.gc) global.gc();
}


// Cleanup every 10 minutes
setInterval(cleanupOldJobs, 600000);


function buildPage1Args({ bgVideo, headshot, logo, qr, brandName, person, outPath, fps = 30 }: Page1Params): string[] {
    const fontPath = process.env.FONT_PATH || "/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf";

    return [
        "-i", bgVideo,
        "-i", headshot,
        "-i", logo,
        "-i", qr,
        "-filter_complex",
        `
      [0:v]scale=1920:1080:flags=lanczos,fps=${fps}[bg];
      [1:v]scale=260:260:flags=lanczos,format=rgba,
      geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':
      a='if(lte((X-130)^2+(Y-130)^2,130^2),255,0)'[head];
      [2:v]scale=90:90:flags=lanczos[logo];
      [3:v]scale=100:100:flags=lanczos[qr];
      [bg][logo]overlay=W-w-40:40[o1];
      [o1][head]overlay=80:H/2-200[o2];
      [o2]drawtext=fontfile=${fontPath}:
      text='${brandName}':
      fontsize=88:fontcolor=white:
      x=80:y=H/2+80:
      alpha='if(lt(t,5),t/5,1)'[t1];
      [t1]drawtext=fontfile=${fontPath}:
      text='${person}':
      fontsize=42:fontcolor=black:
      x=80:y=H/2+180:
      alpha='if(lt(t,5),t/5,1)'[t5];
      [t5]drawtext=fontfile=${fontPath}:
      text='JOIN US':
      fontsize=80:fontcolor=white:
      x=W-380:y=H-280[t6];
      [t6]drawtext=fontfile=${fontPath}:
      text='LIVE':
      fontsize=95:fontcolor=white:
      x=W-380:y=H-180[t7];
      [t7][qr]overlay=W-70-80:H-215[v]
    `,
        "-map", "[v]",
        "-map", "0:a?",
        "-t", "10",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "slow",           // Changed from "ultrafast"
        "-crf", "18",                // Changed from "22"
        "-profile:v", "high",        // Added
        "-level", "4.2",             // Added
        "-movflags", "+faststart",   // Added for web playback
        "-y",
        outPath
    ];
}

// ====================== ENDPOINT ======================
app.post("/page1", upload.single("zipfile"), async (req, res) => {
    try {
        console.log("===== /page1 called =====");
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
                error: "ZIP file required in 'zipfile' field",
            });
        }

        // Extract parameters from request body
        const { brandName, person } = req.body;

        if (!brandName || !person) {
            return res.status(400).json({
                error: "brandName and person are required in request body",
            });
        }

        const jobId = `page1_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const extractDir = path.join(jobDir, "extract");
        const inputZip = path.join(jobDir, "input.zip");

        fs.mkdirSync(jobDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        // Copy uploaded file to job directory
        fs.copyFileSync(req.file.path, inputZip);
        fs.unlinkSync(req.file.path);

        const job: Page1JobData = {
            id: jobId,
            status: "pending",
            inputZip,
            extractDir,
            brandName,
            person,
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/page1/status/${jobId}`,
            download_url: `/page1/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /page1:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// ====================== STATUS ENDPOINT ======================
app.get("/page1/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    res.json(job);
});

// ====================== DOWNLOAD ENDPOINT ======================
app.get("/page1/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: Page1JobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).end();
    });
});



async function generateRadialPlate({
    tools,
    size = 1100,
    holeRadius = 180,
    toolSize = 210,
    radius = 450,
    strokes = ["#ffffff", "#00e5ff", "#ff8a00", "#7cff00", "#ff3d81", "#8c7bff"]
}: {
    tools: string[];
    size?: number;
    holeRadius?: number;
    toolSize?: number;
    radius?: number;
    strokes?: string[];
}) {
    const cx = size / 2;
    const cy = size / 2;

    const toolImages = await Promise.all(
        tools.map(async p => (await fsPromises.readFile(p)).toString("base64"))
    );

    const step = (2 * Math.PI) / tools.length;

    const points = tools.map((_, i) => {
        const a = -Math.PI / 2 + i * step;
        return {
            x: cx + radius * Math.cos(a),
            y: cy + radius * Math.sin(a)
        };
    });

    const connectors = points.map((p, i) => {
        const vx = p.x - cx;
        const vy = p.y - cy;
        const len = Math.sqrt(vx * vx + vy * vy);

        const ex = cx + (vx / len) * (holeRadius + 10);
        const ey = cy + (vy / len) * (holeRadius + 10);

        const mx = (p.x + ex) / 2;
        const my = (p.y + ey) / 2 - radius * 0.18;

        const stroke = strokes[i % strokes.length];

        return `
      <path d="M ${p.x} ${p.y} Q ${mx} ${my} ${ex} ${ey}"
        fill="none"
        stroke="${stroke}"
        stroke-width="2.8"
        stroke-dasharray="6,6"
        opacity="0.9"
        stroke-linecap="round"
        marker-end="url(#arrow-${i})"/>
    `;
    });

    const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <mask id="hole">
    <rect width="100%" height="100%" fill="white"/>
    <circle cx="${cx}" cy="${cy}" r="${holeRadius}" fill="black"/>
  </mask>

  ${strokes.map((c, i) => `
    <marker id="arrow-${i}"
      markerWidth="10"
      markerHeight="10"
      refX="9"
      refY="5"
      orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="${c}" opacity="0.9"/>
    </marker>
  `).join("")}
</defs>

<!-- CONNECTORS OUTSIDE MASK (IMPORTANT) -->
${connectors.join("")}

<!-- TOOLS INSIDE MASK -->
<g mask="url(#hole)">
  ${toolImages.map((img, i) => `
    <image href="data:image/png;base64,${img}"
      x="${points[i].x - toolSize / 2}"
      y="${points[i].y - toolSize / 2}"
      width="${toolSize}"
      height="${toolSize}"/>
  `).join("")}
</g>
</svg>
`;

    const out = `/tmp/page2_plate_${Date.now()}.png`;
    await sharp(Buffer.from(svg))
        .png({
            compressionLevel: 6,  // 0-9, lower = better quality but larger file
            quality: 100          // PNG quality
        })
        .toFile(out);
    return out;

}

export async function buildPage2Args({
    bgVideo,
    headshot,
    tools,
    logo,
    qr,
    outPath,
    fps = 30
}: {
    bgVideo: string;
    headshot: string;
    tools: string[];
    logo: string;
    qr: string;
    outPath: string;
    fps?: number;
}) {

    const plate = await generateRadialPlate({ tools });
    const D = 0.8;

    return [
        "-i", bgVideo,
        "-i", plate,
        "-i", headshot,
        "-i", logo,
        "-i", qr,

        "-filter_complex",
        `
[0:v]scale=1920:1080:flags=lanczos,fps=${fps}[bg];
[1:v]scale=1100:1100:flags=lanczos[plate];

[2:v]scale=380:380:flags=lanczos,format=rgba,
geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':
a='if(lte((X-190)^2+(Y-190)^2,190^2),255,0)'
[headM];

[headM]scale=
w='380*if(lt(t,${D}),t/${D},1)':
h='380*if(lt(t,${D}),t/${D},1)':
eval=frame:flags=lanczos
[head];

[3:v]scale=
w='min(50,40+10*if(lt(t,${D}),t/${D},1))':
h='min(50,40+10*if(lt(t,${D}),t/${D},1))':
eval=frame:flags=lanczos
[logoA];

[4:v]scale=150:150:flags=lanczos[qr];


[bg][head]overlay=
x='80+((W/2-190)-80)*if(lt(t,${D}),t/${D},1)':
y='(H/2-200)+((H/2-190)-(H/2-200))*if(lt(t,${D}),t/${D},1)':
shortest=0
[o1];


[o1][plate]overlay=W/2-550:H/2-550[s1];

[s1][logoA]overlay=
x='(W-130)+((W-230)-(W-130))*if(lt(t,${D}),t/${D},1)':
y='40+((H-125)-40)*if(lt(t,${D}),t/${D},1)'
[s6];

[s6]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='JOIN US':fontsize=80:fontcolor=white:
x=W-350:y=H-280:box=1:boxcolor=black@0:boxborderw=14[s7];

[s7]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='LIVE':fontsize=65:fontcolor=white:
x=W-350:y=H-180:box=1:boxcolor=black@0:boxborderw=14[s8];

[s8][qr]overlay=W-170:H-220[v]
`,

        "-map", "[v]",
        "-map", "0:a?",
        "-t", "11",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "slow",              // Changed from "veryfast"
        "-crf", "18",                   // Changed from "22"
        "-profile:v", "high",           // Added
        "-level", "4.2",                // Added
        "-movflags", "+faststart",      // Added
        "-y",
        outPath
    ];
}

// ====================== ENDPOINT ======================
app.post("/page2", upload.single("zipfile"), async (req, res) => {
    try {
        console.log("===== /page2 called =====");
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
                error: "ZIP file required in 'zipfile' field",
            });
        }

        const jobId = `page2_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const extractDir = path.join(jobDir, "extract");
        const inputZip = path.join(jobDir, "input.zip");

        fs.mkdirSync(jobDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        // Copy uploaded file to job directory
        fs.copyFileSync(req.file.path, inputZip);
        fs.unlinkSync(req.file.path);

        const job: Page2JobData = {
            id: jobId,
            status: "pending",
            inputZip,
            extractDir,
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/page2/status/${jobId}`,
            download_url: `/page2/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /page2:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// ====================== STATUS ENDPOINT ======================
app.get("/page2/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    res.json(job);
});

// ====================== DOWNLOAD ENDPOINT ======================
app.get("/page2/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: Page2JobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).end();
    });
});



/* ================= XML ESCAPE (MANDATORY) ================= */

function escapeXML(str: string) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

async function generateInsightPlates({
    items,
    size = 1600,
    cardW = 520,
    cardH = 200,
    colors = ["#C9C2F5", "#F3C49A", "#A9DDD7", "#F2C2D6"]
}: {
    items: { label: string; text: string; number: string }[];
    size?: number;
    cardW?: number;
    cardH?: number;
    colors?: string[];
}) {
    if (items.length !== 8) {
        throw new Error("generateInsightPlates expects exactly 8 items");
    }

    const cx = size / 2;
    const cy = size / 2;

    const verticalPadding = 60;
    const spacing = (size - verticalPadding * 2 - cardH * 4) / 3.5;
    const startY = verticalPadding;

    const positions = [
        { x: 80, y: startY },
        { x: 20, y: startY + cardH + spacing },
        { x: 20, y: startY + (cardH + spacing) * 2 },
        { x: 80, y: startY + (cardH + spacing) * 3 },
        { x: size - cardW - 80, y: startY },
        { x: size - cardW - 20, y: startY + cardH + spacing },
        { x: size - cardW - 20, y: startY + (cardH + spacing) * 2 },
        { x: size - cardW - 80, y: startY + (cardH + spacing) * 3 }
    ];

    const circleRadius = 48;
    const circleX = circleRadius + 16;
    const circleY = cardH / 2;

    /* ================= TEXT WRAPPING ================= */

    function wrapByPixelWidth(
        text: string,
        maxWidthPx: number,
        fontSize: number
    ) {
        const words = text.split(" ");
        const lines: string[] = [];
        let line = "";

        // Inter ~0.55em average glyph width
        const avgCharWidth = fontSize * 0.55;
        const width = (s: string) => s.length * avgCharWidth;

        for (const word of words) {
            const test = line ? `${line} ${word}` : word;

            // wrap ONLY when we actually hit the edge
            if (width(test) > maxWidthPx) {
                if (line) lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }

        if (line) lines.push(line);
        return lines;
    }

    function fitTypographyToCard({
        label,
        text,
        maxWidthPx,
        maxHeight
    }: {
        label: string;
        text: string;
        maxWidthPx: number;
        maxHeight: number;
    }) {
        let labelSize = 22;
        let bodySize = 18;
        let gap = 26;
        let lineGap = 22;
        let lines: string[] = [];

        for (let i = 0; i < 20; i++) {
            lines = wrapByPixelWidth(text, maxWidthPx, bodySize);

            const labelBlock = labelSize + 6;
            const bodyBlock = lines.length * lineGap;
            const totalHeight = labelBlock + gap + bodyBlock;

            if (totalHeight <= maxHeight) {
                return { label: labelSize, body: bodySize, gap, lineGap, lines, totalHeight };
            }

            labelSize--;
            bodySize--;
            gap--;
            lineGap--;

            if (bodySize < 13) break;
        }

        const labelBlock = labelSize + 6;
        const bodyBlock = lines.length * lineGap;
        const totalHeight = labelBlock + gap + bodyBlock;

        return { label: labelSize, body: bodySize, gap, lineGap, lines, totalHeight };
    }

    /* ================= CONNECTORS ================= */

    const connectors = items
        .map((_, i) => {
            const pos = positions[i];
            const isLeft = i < 4;
            const stroke = colors[i % colors.length];

            const startX = isLeft ? pos.x + cardW : pos.x;
            const startY = pos.y + cardH / 2;

            const dx = cx - startX;
            const dy = cy - startY;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;

            const ux = dx / len;
            const uy = dy / len;

            const isTopRow = i === 0 || i === 4;
            const headshotRadius = isTopRow ? 350 : 210;

            const rawEndX = cx - ux * headshotRadius;
            const rawEndY = cy - uy * headshotRadius;

            const baseOffset = 140;
            const rowFactor = Math.abs((startY - cy) / (size / 2));

            const controlX =
                startX + (isLeft ? 1 : -1) * (baseOffset + rowFactor * 60);
            const controlY = startY;

            const retreat = 12;
            const tx = rawEndX - controlX;
            const ty = rawEndY - controlY;
            const tLen = Math.sqrt(tx * tx + ty * ty) || 1;

            const endX = rawEndX - (tx / tLen) * retreat;
            const endY = rawEndY - (ty / tLen) * retreat;

            return `
        <path
          d="M ${startX} ${startY}
             Q ${controlX} ${controlY}
               ${endX} ${endY}"
          fill="none"
          stroke="${stroke}"
          stroke-width="3"
          opacity="0.65"
          stroke-linecap="round"
        />
      `;
        })
        .join("");


    const svg = `
        <svg
        width="${size}"
        height="${size}"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        >


        ${connectors}

        ${items
            .map((it, i) => {
                const pos = positions[i];
                const c = colors[i % colors.length];

                const textStartX = circleX + circleRadius + 28;
                const maxWidthPx = cardW - textStartX - 40;

                const fit = fitTypographyToCard({
                    label: it.label,
                    text: it.text,
                    maxWidthPx,
                    maxHeight: cardH - 50
                });

                // ONE centered block (label + body together)
                const blockTopY = circleY - fit.totalHeight / 2;

                return `
        <g transform="translate(${pos.x}, ${pos.y})">
            <rect width="${cardW}" height="${cardH}" rx="56" fill="${c}" opacity="0.96"/>

            <circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="white" opacity="0.25"/>

            <text
            x="${circleX}"
            y="${circleY}"
            font-family="Inter, Arial, sans-serif"
            font-size="34"
            font-weight="700"
            fill="white"
            text-anchor="middle"
            dominant-baseline="middle">
            ${escapeXML(it.number)}
            </text>

            <g>
            <text
                x="${textStartX}"
                y="${blockTopY + fit.label}"
                font-family="Inter, Arial, sans-serif"
                font-size="${fit.label}"
                font-weight="600"
                fill="rgba(0,0,0,0.88)">
                ${escapeXML(it.label)}
            </text>

            ${fit.lines
                        .map(
                            (line, idx) => `
                <text
                x="${textStartX}"
                y="${blockTopY + fit.label + fit.gap + (idx + 1) * fit.lineGap}"
                font-family="Inter, Arial, sans-serif"
                font-size="${fit.body}"
                font-weight="500"
                fill="rgba(0,0,0,0.72)">
                ${escapeXML(line)}
                </text>
            `
                        )
                        .join("")}
            </g>
        </g>
        `;
            })
            .join("")}
        </svg>
    `;

    const out = `/tmp/page3_plate_${Date.now()}.png`;
    await sharp(Buffer.from(svg))
        .png({ compressionLevel: 6, quality: 100 })
        .toFile(out);

    return out;
}



async function buildPage3Args({
    bgVideo,
    headshot,
    items,
    logo,
    personName,
    brandName,
    outPath,
    fps = 30
}: {
    bgVideo: string;
    headshot: string;
    items: { label: string; text: string; number: string }[];
    logo: string;
    personName: string;
    brandName: string;
    outPath: string;
    fps?: number;
}) {
    const plate = await generateInsightPlates({ items });
    forceGC()
    const D = 0.8;

    return [
        "-i", bgVideo,
        "-i", plate,
        "-i", headshot,
        "-i", logo,

        "-filter_complex",
        `
[0:v]scale=1920:1080:flags=lanczos,fps=${fps}[bg];
[1:v]scale=1920:1080:flags=lanczos[plate];

[2:v]scale=320:320:flags=lanczos,format=rgba,
geq=
r='r(X,Y)':
g='g(X,Y)':
b='b(X,Y)':
a='if(lte((X-160)^2+(Y-160)^2,160^2),255,0)'
[head];

[head]scale=
w='320*if(lt(t,${D}),t/${D},1)':
h='320*if(lt(t,${D}),t/${D},1)':
flags=lanczos:
eval=frame[headA];

[bg][headA]overlay=W/2-160:H/2-220[o1];
[o1][plate]overlay=0:0[o2];

[3:v]scale=100:100:flags=lanczos[logo];

[o2][logo]overlay=W/2-20:H/2+240[o7];

[o7]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${ffText(personName)}':fontsize=32:fontcolor=black:x=(W-text_w)/2:y=H/2+120[o8];

[o8]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${ffText(brandName)}':fontsize=48:fontcolor=white:x=(W-text_w)/2:y=H/2+160[v]
`,
        "-map", "[v]",
        "-map", "0:a?",
        "-t", "21",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "slow",           // Changed from "ultrafast"
        "-crf", "18",                // Changed from "28" - MAJOR quality boost
        "-profile:v", "high",        // Added
        "-level", "4.2",             // Added
        "-movflags", "+faststart",   // Added for web playback
        "-y",
        outPath
    ];
}

// ====================== ENDPOINT ======================
app.post("/page3", upload.single("zipfile"), async (req, res) => {
    try {
        console.log("===== /page3 called =====");
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
                error: "ZIP file required in 'zipfile' field",
            });
        }

        // Parse items from request body (expecting JSON string)
        const { personName, brandName, items: itemsJson } = req.body;

        if (!personName || !brandName || !itemsJson) {
            return res.status(400).json({
                error: "personName, brandName, and items are required in request body",
            });
        }

        let items: { label: string; text: string; number: string }[];
        try {
            items = JSON.parse(itemsJson);

            if (!Array.isArray(items) || items.length !== 8) {
                return res.status(400).json({
                    error: "items must be an array of exactly 8 objects with label, text, and number fields",
                });
            }

            // Validate each item has required fields
            for (const item of items) {
                if (!item.label || !item.text || !item.number) {
                    return res.status(400).json({
                        error: "Each item must have label, text, and number fields",
                    });
                }
            }
        } catch (err) {
            return res.status(400).json({
                error: "items must be valid JSON",
                details: String(err),
            });
        }

        const jobId = `page3_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const extractDir = path.join(jobDir, "extract");
        const inputZip = path.join(jobDir, "input.zip");

        fs.mkdirSync(jobDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        // Copy uploaded file to job directory
        fs.copyFileSync(req.file.path, inputZip);
        fs.unlinkSync(req.file.path);

        const job: Page3JobData = {
            id: jobId,
            status: "pending",
            inputZip,
            extractDir,
            personName,
            brandName,
            items,
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/page3/status/${jobId}`,
            download_url: `/page3/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /page3:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// ====================== STATUS ENDPOINT ======================
app.get("/page3/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    res.json(job);
});

// ====================== DOWNLOAD ENDPOINT ======================
app.get("/page3/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: Page3JobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).end();
    });
});


async function generateQuotePlate({
    quote,
    width = 1200,
    height = 720
}: {
    quote: string;
    width?: number;
    height?: number;
}) {
    const padding = 90;
    const radius = 42;
    const fontFamily = "Montserrat, Arial, sans-serif";
    const maxFont = 92;
    const minFont = 28;
    const lineGap = 1.25;

    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    function wrap(text: string, maxChars: number) {
        const words = text.split(" ");
        const lines: string[] = [];
        let line = "";

        for (const w of words) {
            const t = line ? `${line} ${w}` : w;
            if (t.length > maxChars) {
                lines.push(line);
                line = w;
            } else {
                line = t;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    async function measure(lines: string[], fontSize: number) {
        const lineHeight = fontSize * lineGap;
        const totalH = lines.length * lineHeight;

        const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    text {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      font-weight: 500;
    }
  </style>
  ${lines
                .map(
                    (l, i) => `
    <text x="${width / 2}"
          y="${100 + i * lineHeight}"
          text-anchor="middle">${l}</text>`
                )
                .join("")}
</svg>
`;

        const img = await sharp(Buffer.from(svg))
            .png()
            .trim()
            .toBuffer({ resolveWithObject: true });

        return {
            width: img.info.width,
            height: Math.max(img.info.height, totalH)
        };
    }

    let fontSize = maxFont;
    let lines: string[] = [];

    // 🔁 real fitting loop
    while (fontSize >= minFont) {
        const approxChars = Math.max(12, Math.floor(innerW / (fontSize * 0.48)));
        lines = wrap(quote, approxChars);

        const m = await measure(lines, fontSize);

        if (m.width <= innerW && m.height <= innerH) break;
        fontSize -= 2;
    }

    const lineHeight = fontSize * lineGap;
    const totalH = lines.length * lineHeight;
    const startY = height / 2 - totalH / 2 + fontSize;

    const textSvg = lines
        .map(
            (l, i) => `
    <text
      x="${width / 2}"
      y="${startY + i * lineHeight}"
      text-anchor="middle"
      font-family="${fontFamily}"
      font-size="${fontSize}"
      font-weight="500"
      fill="#ffffff"
    >${l}</text>
  `
        )
        .join("");

    const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <!-- Frame -->
  <rect x="6" y="6"
    width="${width - 12}"
    height="${height - 12}"
    rx="${radius}"
    fill="none"
    stroke="#ffffff"
    stroke-width="4"/>

  <!-- Glass -->
  <rect x="${padding}" y="${padding}"
    width="${innerW}"
    height="${innerH}"
    rx="${radius - 10}"
    fill="rgba(255,255,255,0.06)"/>

  <!-- Quotes -->
  <text x="${padding - 30}" y="${padding + 60}"
    font-size="96"
    font-family="${fontFamily}"
    fill="#ffffff">"</text>

  <text x="${width - padding + 8}" y="${height - padding + 70}"
    font-size="96"
    font-family="${fontFamily}"
    fill="#ffffff">"</text>

  ${textSvg}
</svg>
`;

    const out = `/tmp/page4_quote_${Date.now()}.png`;
    await sharp(Buffer.from(svg)).png().toFile(out);
    return out;
}


// async function generatePersonPlate({
//     person,
//     headshot,
//     width = 900,
//     height = 260,
//     headSize = 100,
//     paddingRight = 20,
//     gap = 12,
//     fontSize = 32,
//     fontFamily = "Montserrat, Arial, sans-serif"
// }: {
//     person: string;
//     headshot: string;
//     width?: number;
//     height?: number;
//     headSize?: number;
//     paddingRight?: number;
//     gap?: number;
//     fontSize?: number;
//     fontFamily?: string;
// }) {
//     try {
//         /* =========================
//            HEADSHOT (CIRCULAR)
//         ========================= */
//         const head = await sharp(headshot)
//             .resize(headSize, headSize, { fit: "cover" })
//             .composite([
//                 {
//                     input: Buffer.from(`
//             <svg width="${headSize}" height="${headSize}">
//               <circle
//                 cx="${headSize / 2}"
//                 cy="${headSize / 2}"
//                 r="${headSize / 2}"
//                 fill="white"
//               />
//             </svg>
//           `),
//                     blend: "dest-in"
//                 }
//             ])
//             .png()
//             .toBuffer();

//         /* =========================
//            TEXT SPLIT
//         ========================= */
//         const words = person.trim().split(/\s+/);
//         const topLine = words.slice(0, 2).join(" ");
//         const bottomLine = words.slice(2).join(" "); // may be empty

//         const rightX = width - paddingRight;
//         const centerY = height / 2;
//         const lineOffset = fontSize * 0.65;

//         /* =========================
//            MEASURE TOP LINE (EXACT)
//         ========================= */
//         let topLineWidth = 0;

//         if (bottomLine) {
//             const measureSvg = Buffer.from(`
//         <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
//           <style>
//             .name {
//               font-family: ${fontFamily};
//               font-size: ${fontSize}px;
//               font-weight: 700;
//               fill: #000;
//             }
//           </style>

//           <text
//             class="name"
//             x="${rightX}"
//             y="${centerY}"
//             text-anchor="end"
//             dominant-baseline="middle"
//           >${topLine}</text>
//         </svg>
//       `);

//             const measured = await sharp(measureSvg)
//                 .png()
//                 .trim()
//                 .toBuffer({ resolveWithObject: true });

//             topLineWidth = measured.info.width;
//         }

//         /* =========================
//            FINAL SVG
//         ========================= */
//         const topCenterX = rightX - topLineWidth / 2;

//         const finalSvg = Buffer.from(`
//       <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
//         <style>
//           .name {
//             font-family: ${fontFamily};
//             font-size: ${fontSize}px;
//             font-weight: 700;
//             fill: #000;
//           }
//         </style>

//         <text class="name">
//           <!-- Top line -->
//           <tspan
//             x="${rightX}"
//             y="${bottomLine ? centerY - lineOffset : centerY}"
//             text-anchor="end"
//             dominant-baseline="middle"
//           >${bottomLine ? topLine : person}</tspan>

//           ${bottomLine
//                 ? `
//               <tspan
//                 x="${topCenterX}"
//                 y="${centerY + lineOffset}"
//                 text-anchor="middle"
//                 dominant-baseline="middle"
//               >${bottomLine}</tspan>
//             `
//                 : ""
//             }
//         </text>
//       </svg>
//     `);

//         /* =========================
//            POSITION HEADSHOT
//         ========================= */
//         const textLeftX = bottomLine
//             ? rightX - topLineWidth
//             : rightX - (await sharp(finalSvg).png().trim().metadata()).width!;

//         const headX = Math.max(0, textLeftX - gap - headSize);
//         const headY = Math.round((height - headSize) / 2);

//         /* =========================
//            OUTPUT
//         ========================= */
//         const out = `/tmp/person_plate_${Date.now()}.png`;

//         await sharp(finalSvg)
//             .png()
//             .composite([{ input: head, left: headX, top: headY }])
//             .toFile(out);

//         return out;
//     } catch (err) {
//         const error = err as Error;
//         throw new Error(
//             `Failed to generate person plate: ${error.message}`
//         );
//     }
// }

async function generatePersonPlate({
    person,
    headshot,
    width = 900,
    height = 260,
    headSize = 100,
    paddingRight = 20,
    gap = 12,
    fontSize = 32,
    fontFamily = "Montserrat, Arial, sans-serif"
}: {
    person: string;
    headshot: string;
    width?: number;
    height?: number;
    headSize?: number;
    paddingRight?: number;
    gap?: number;
    fontSize?: number;
    fontFamily?: string;
}) {
    try {
        // Load headshot, resize, and circular mask using sharp
        const head = await sharp(headshot)
            .resize(headSize, headSize, { fit: "cover" })
            .composite([
                {
                    input: Buffer.from(
                        `<svg width="${headSize}" height="${headSize}">
              <circle cx="${headSize / 2}" cy="${headSize / 2}" r="${headSize / 2}" fill="white"/>
            </svg>`
                    ),
                    blend: "dest-in"
                }
            ])
            .png()
            .toBuffer();

        // Measure text width using sharp
        const textSvg = (x: number) => {
            const words = person.trim().split(/\s+/);

            const lines: string[] = [];
            for (let i = 0; i < words.length; i += 2) {
                lines.push(words.slice(i, i + 2).join(" "));
            }

            const lineHeight = fontSize * 1.2;
            const startY =
                height / 2 - ((lines.length - 1) * lineHeight) / 2;

            // If wrapped, center everything
            const anchor = lines.length > 1 ? "middle" : "end";
            const anchorX = lines.length > 1 ? width / 2 : x;

            return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .name {
          font-family: ${fontFamily};
          font-size: ${fontSize}px;
          font-weight: 700;
          fill: #000;
        }
      </style>

      <text
        class="name"
        x="${anchorX}"
        y="${startY}"
        text-anchor="${anchor}"
      >
        ${lines
                    .map(
                        (line, i) =>
                            `<tspan x="${anchorX}" dy="${i === 0 ? 0 : lineHeight}">${line}</tspan>`
                    )
                    .join("")}
      </text>
    </svg>
  `;
        };



        // Create a temp svg to measure width
        const measureSvg = Buffer.from(textSvg(width - paddingRight));
        const measure = await sharp(measureSvg).png().toBuffer();

        // Use trim to efficiently get text bounds
        const trimmed = await sharp(measure)
            .ensureAlpha()
            .trim()
            .toBuffer({ resolveWithObject: true });

        const textWidth = trimmed.info.width;

        // Calculate maximum available width for text
        const maxTextWidth = width - paddingRight - headSize - gap;
        const effectiveTextWidth = Math.min(textWidth, maxTextWidth);

        // Compute head position beside the name (row-reverse)
        const textRightX = width - paddingRight;
        const textLeftX = textRightX - textWidth;

        const headX = Math.max(0, textLeftX - gap - headSize);
        const headY = Math.round((height - headSize) / 2);

        // Warn if text is too wide
        if (textWidth > maxTextWidth) {
            console.warn(
                `[generatePersonPlate] Text width (${textWidth}px) exceeds available space (${maxTextWidth}px). Consider reducing fontSize or increasing width.`
            );
        }

        // Final plate SVG (text pinned right)
        const finalSvg = Buffer.from(textSvg(textRightX));

        const out = `/tmp/page4_personplate_${Date.now()}.png`;

        await sharp(finalSvg)
            .png()
            .composite([{ input: head, left: headX, top: headY }])
            .toFile(out);

        return out;
    } catch (err) {
        const error = err as Error;
        throw new Error(
            `Failed to generate person plate: ${error.message}. Check that headshot path is valid and sharp is installed.`
        );
    }
}

async function buildPage4Args({
    bgVideo,
    headshot,
    person,
    brandName,
    quote,
    logo,
    qr,
    outPath,
    fps = 30
}: {
    bgVideo: string;
    headshot: string;
    person: string;
    brandName: string;
    quote: string;
    logo: string;
    qr: string;
    outPath: string;
    fps?: number;
}) {
    const fontPath = process.env.FONT_PATH || "/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf";

    const quotePlate = await generateQuotePlate({ quote });

    const personPlate = await generatePersonPlate({
        person,
        headshot,
        width: 1100,
        height: 260,
        headSize: 180,
        paddingRight: 20,
        gap: 20,
        fontSize: 56
    });

    return [
        "-i", bgVideo,
        "-i", quotePlate,
        "-i", personPlate,
        "-i", logo,
        "-i", qr,

        "-filter_complex",
        `
[0:v]scale=1920:1080:flags=lanczos,fps=${fps}[bg];
[1:v]scale=1000:720:flags=lanczos[quote];
[2:v]scale=1100:260:flags=lanczos[personPlate];

[3:v]scale=200:200:flags=lanczos[logo];
[4:v]scale=200:200:flags=lanczos[qr];

[bg][quote]overlay=80:H/2-360[o1];
[o1][personPlate]overlay=W-1100-20:80[o2];

[o2][logo]overlay=W-500:80+220[t3];

[t3]drawtext=fontfile=${fontPath}:
text='${ffText(brandName)}':
fontsize=88:fontcolor=white:
x=W-700:y=80+260+20+65+100[t4];

[t4]drawtext=fontfile=${fontPath}:
text='JOIN US':
fontsize=160:fontcolor=white:
x=W-700:y=H-380[t5];

[t5]drawtext=fontfile=${fontPath}:
text='LIVE':
fontsize=200:fontcolor=white:
x=W-700:y=H-180[t6];

[t6][qr]overlay=W-200-40:H-215[v]
    `,

        "-map", "[v]",
        "-map", "0:a?",
        "-t", "10",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "slow",           // Changed from "ultrafast"
        "-crf", "18",                // Changed from "28"
        "-profile:v", "high",        // Added
        "-level", "4.2",             // Added
        "-movflags", "+faststart",   // Added
        "-y",
        outPath
    ];
}

// ====================== ENDPOINT ======================
app.post("/page4", upload.single("zipfile"), async (req, res) => {
    try {
        console.log("===== /page4 called =====");
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
                error: "ZIP file required in 'zipfile' field",
            });
        }

        // Extract parameters from request body
        const { personName, brandName, quote } = req.body;

        if (!personName || !brandName || !quote) {
            return res.status(400).json({
                error: "personName, brandName, and quote are required in request body",
            });
        }

        const jobId = `page4_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const extractDir = path.join(jobDir, "extract");
        const inputZip = path.join(jobDir, "input.zip");

        fs.mkdirSync(jobDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        // Copy uploaded file to job directory
        fs.copyFileSync(req.file.path, inputZip);
        fs.unlinkSync(req.file.path);

        const job: Page4JobData = {
            id: jobId,
            status: "pending",
            inputZip,
            extractDir,
            personName,
            brandName,
            quote,
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/page4/status/${jobId}`,
            download_url: `/page4/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /page4:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// ====================== STATUS ENDPOINT ======================
app.get("/page4/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    res.json(job);
});

// ====================== DOWNLOAD ENDPOINT ======================
app.get("/page4/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: Page4JobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).end();
    });
});



function buildAssembleSegmentArgs({
    page1,
    page2,
    page3,
    page4,
    outPath,
    transitions
}: {
    page1: string;
    page2: string;
    page3: string;
    page4: string;
    outPath: string;
    transitions: { type: string; duration: number }[];
}) {
    // Proper offset calculations to ensure all pages show completely:
    // page1: 7.4s duration
    // page2: 8.47s duration
    // page3: 18.2s duration
    // page4: 7.4s duration

    // Offsets account for overlap during transitions
    const offset1 = 6.2;   // page1 -> page2 transition (before page1 ends)
    const offset2 = 13.57; // page2 -> page3 transition
    const offset3 = 30.57; // page3 -> page4 transition

    const t1 = transitions[0];
    const t2 = transitions[1];
    const t3 = transitions[2];

    return [
        "-i", page1,
        "-i", page2,
        "-i", page3,
        "-i", page4,

        "-filter_complex",
        `[0:v][1:v]xfade=transition=${t1.type}:duration=${t1.duration}:offset=${offset1}[v1];` +
        `[v1][2:v]xfade=transition=${t2.type}:duration=${t2.duration}:offset=${offset2}[v2];` +
        `[v2][3:v]xfade=transition=${t3.type}:duration=${t3.duration}:offset=${offset3}[vout]`,

        "-map", "[vout]",
        "-an", // No audio for segments
        "-c:v", "libx264",
        "-preset", "slow",           // Changed from "veryfast"
        "-crf", "18",                // Changed from "22"
        "-profile:v", "high",        // Added
        "-level", "4.2",             // Added
        "-movflags", "+faststart",   // Added
        "-pix_fmt", "yuv420p",
        "-y",
        outPath
    ];
}

// ====================== BUILD MULTIPLE SEGMENTS ======================
function buildMultipleSegments({
    page1,
    page2,
    page3,
    page4,
    segmentCount = 4,
    outPath
}: {
    page1: string;
    page2: string;
    page3: string;
    page4: string;
    segmentCount?: number;
    outPath: string;
}) {
    const segments = [];

    // Different transition combinations for variety while keeping it subtle
    const transitionSets = [
        [
            { type: "fade", duration: 1.2 },
            { type: "dissolve", duration: 1.5 },
            { type: "fade", duration: 1.2 }
        ],
        [
            { type: "dissolve", duration: 1.5 },
            { type: "fade", duration: 1.2 },
            { type: "dissolve", duration: 1.5 }
        ],
        [
            { type: "fade", duration: 1.2 },
            { type: "dissolve", duration: 1.5 },
            { type: "fade", duration: 1.2 }
        ],
        [
            { type: "dissolve", duration: 1.5 },
            { type: "fade", duration: 1.2 },
            { type: "dissolve", duration: 1.5 }
        ]
    ];

    for (let i = 0; i < segmentCount; i++) {
        segments.push({
            outPath: `${outPath}/segment${i + 1}.mp4`,
            args: buildAssembleSegmentArgs({
                page1,
                page2,
                page3,
                page4,
                outPath: `${outPath}/segment${i + 1}.mp4`,
                transitions: transitionSets[i % transitionSets.length]
            })
        });
    }

    return segments;
}

// ====================== CONCAT SEGMENTS ======================
function buildConcatArgs(segmentPaths: string[], outputPath: string, concatFilePath: string) {
    return [
        "-f", "concat",
        "-safe", "0",
        "-i", concatFilePath,
        "-c", "copy",
        "-y",
        outputPath
    ];
}


// ====================== ENDPOINT ======================
app.post("/assemble", upload.single("zipfile"), async (req, res) => {
    try {
        console.log("===== /assemble called =====");
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
                error: "ZIP file required in 'zipfile' field",
            });
        }

        const jobId = `assemble_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const extractDir = path.join(jobDir, "extract");
        const inputZip = path.join(jobDir, "input.zip");

        fs.mkdirSync(jobDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        // Copy uploaded file to job directory
        fs.copyFileSync(req.file.path, inputZip);
        fs.unlinkSync(req.file.path);

        const job: AssembleJobData = {
            id: jobId,
            status: "pending",
            inputZip,
            extractDir,
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/assemble/status/${jobId}`,
            download_url: `/assemble/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /assemble:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// ====================== STATUS ENDPOINT ======================
app.get("/assemble/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    res.json(job);
});

// ====================== DOWNLOAD ENDPOINT ======================
app.get("/assemble/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: AssembleJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).end();
    });
});

// ====================== GET DURATIONS ======================
async function getVideoDuration(videoPath: string): Promise<number> {
    const { stdout } = await execPromise(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    return parseFloat(stdout.trim());
}

async function getAudioDuration(audioPath: string): Promise<number> {
    const { stdout } = await execPromise(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    return parseFloat(stdout.trim());
}

// ====================== ADD AUDIO WITH LOOPING ======================
function buildAddAudioArgs({
    videoPath,
    audioPath,
    outputPath,
    videoDuration,
    audioDuration,
    fadeOutDuration = 3.0 // 3 second fade out
}: {
    videoPath: string;
    audioPath: string;
    outputPath: string;
    videoDuration: number;
    audioDuration: number;
    fadeOutDuration?: number;
}) {
    const fadeStartTime = videoDuration - fadeOutDuration;

    // If audio is shorter than video, we need to loop it
    if (audioDuration < videoDuration) {
        // Calculate how many times to loop
        const loopCount = Math.ceil(videoDuration / audioDuration);

        return [
            "-i", videoPath,
            "-stream_loop", String(loopCount - 1), // -1 because first play doesn't count as loop
            "-i", audioPath,

            "-filter_complex",
            `[1:a]atrim=0:${videoDuration},afade=t=out:st=${fadeStartTime}:d=${fadeOutDuration}[audio]`,

            "-map", "0:v",
            "-map", "[audio]",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest", // Cut when video ends
            "-y",
            outputPath
        ];
    } else {
        // Audio is longer than or equal to video - just trim and fade
        return [
            "-i", videoPath,
            "-i", audioPath,

            "-filter_complex",
            `[1:a]atrim=0:${videoDuration},afade=t=out:st=${fadeStartTime}:d=${fadeOutDuration}[audio]`,

            "-map", "0:v",
            "-map", "[audio]",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-y",
            outputPath
        ];
    }
}

// ====================== AUDIO ENDPOINT ======================
app.post("/audio", upload.single("zipfile"), async (req, res) => {
    try {
        console.log("===== /audio called =====");
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
                error: "ZIP file required in 'zipfile' field",
            });
        }

        const jobId = `audio_${Date.now()}_${uuidv4()}`;
        const jobDir = path.join(JOBS_DIR, jobId);
        const extractDir = path.join(jobDir, "extract");
        const inputZip = path.join(jobDir, "input.zip");

        fs.mkdirSync(jobDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        // Copy uploaded file to job directory
        fs.copyFileSync(req.file.path, inputZip);
        fs.unlinkSync(req.file.path);

        const job: AudioJobData = {
            id: jobId,
            status: "pending",
            progress: 0,
            inputZip,
            extractDir,
        };

        fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

        return res.json({
            jobId,
            status: "pending",
            status_url: `/audio/status/${jobId}`,
            download_url: `/audio/download/${jobId}`,
        });
    } catch (err) {
        console.error("ERR /audio:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// ====================== AUDIO STATUS ENDPOINT ======================
app.get("/audio/status/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
    res.json(job);
});

// ====================== AUDIO DOWNLOAD ENDPOINT ======================
app.get("/audio/download/:jobId", (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) {
        return res.status(404).json({ error: "Job not found" });
    }

    const job: AudioJobData = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

    if (job.status !== "done") {
        return res.status(400).json({ error: "Job not finished" });
    }

    const resultPath = job.result;

    if (!resultPath || !fs.existsSync(resultPath)) {
        return res.status(404).json({ error: "Result file not found" });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

    const fileStream = fs.createReadStream(resultPath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        res.status(500).end();
    });
});


// ====================== JOB PROCESSORS ======================
async function processPage1Job(jobId: string, jobDir: string, jobFile: string, job: Page1JobData) {
    console.log(`[Page1 Job ${jobId}] Starting processing...`);

    await extractZip(job.inputZip, job.extractDir);

    job.progress = 20;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const files = fs.readdirSync(job.extractDir);

    const bgVideo = files.find(f => f.toLowerCase().includes("page1_bg") && f.endsWith(".mp4"));
    const logo = files.find(f => f.toLowerCase().includes("mangomagic") && f.endsWith(".png"));
    const qr = files.find(f => f.toLowerCase() === "qr.png");
    const headshot = files.find(f =>
        (f.toLowerCase().includes("profile") || f.toLowerCase().includes("headshot")) &&
        (f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg"))
    );

    if (!bgVideo || !logo || !qr || !headshot) {
        throw new Error(`Missing required files. Found: bg=${bgVideo}, logo=${logo}, qr=${qr}, headshot=${headshot}`);
    }

    job.progress = 40;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "page1_result.mp4");

    const ffmpegArgs = buildPage1Args({
        bgVideo: path.join(job.extractDir, bgVideo),
        headshot: path.join(job.extractDir, headshot),
        logo: path.join(job.extractDir, logo),
        qr: path.join(job.extractDir, qr),
        brandName: job.brandName,
        person: job.person,
        outPath: finalOut,
    });

    job.progress = 50;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    if (!fs.existsSync(finalOut)) {
        throw new Error("Output file was not created");
    }

    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) {
        throw new Error("Output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Page1 Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

async function processPage2Job(jobId: string, jobDir: string, jobFile: string, job: Page2JobData) {
    console.log(`[Page2 Job ${jobId}] Starting processing...`);

    await extractZip(job.inputZip, job.extractDir);

    job.progress = 20;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const files = fs.readdirSync(job.extractDir);

    const bgVideo = files.find(f => f.toLowerCase().includes("page2_bg") && f.endsWith(".mp4"));
    const logo = files.find(f => f.toLowerCase().includes("mangomagic") && f.endsWith(".png"));
    const qr = files.find(f => f.toLowerCase() === "qr.png");
    const headshot = files.find(f =>
        (f.toLowerCase().includes("profile") || f.toLowerCase().includes("headshot")) &&
        (f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg"))
    );

    const toolImages = files
        .filter(f => f.toLowerCase().startsWith("removebg_") && f.endsWith(".png"))
        .sort()
        .map(f => path.join(job.extractDir, f));

    if (!bgVideo || !logo || !qr || !headshot) {
        throw new Error(`Missing required files. Found: bg=${bgVideo}, logo=${logo}, qr=${qr}, headshot=${headshot}`);
    }

    if (toolImages.length === 0) {
        throw new Error("No toolstack images found (expected removebg_*.png files)");
    }

    console.log(`[Page2 Job ${jobId}] Found ${toolImages.length} tool images`);

    job.progress = 40;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "page2_result.mp4");

    const ffmpegArgs = await buildPage2Args({
        bgVideo: path.join(job.extractDir, bgVideo),
        headshot: path.join(job.extractDir, headshot),
        tools: toolImages,
        logo: path.join(job.extractDir, logo),
        qr: path.join(job.extractDir, qr),
        outPath: finalOut,
    });

    job.progress = 50;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    if (!fs.existsSync(finalOut)) {
        throw new Error("Output file was not created");
    }

    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) {
        throw new Error("Output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Page2 Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

async function processPage3Job(jobId: string, jobDir: string, jobFile: string, job: Page3JobData) {
    console.log(`[Page3 Job ${jobId}] Starting processing...`);

    await extractZip(job.inputZip, job.extractDir);

    job.progress = 10;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const files = fs.readdirSync(job.extractDir);

    const bgVideo = files.find(f => f.toLowerCase().includes("page3_bg") && f.endsWith(".mp4"));
    const logo = files.find(f => f.toLowerCase().includes("mangomagic") && f.endsWith(".png"));
    const headshot = files.find(f =>
        (f.toLowerCase().includes("profile") || f.toLowerCase().includes("headshot")) &&
        (f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg"))
    );

    if (!bgVideo || !logo || !headshot) {
        throw new Error(`Missing required files. Found: bg=${bgVideo}, logo=${logo}, headshot=${headshot}`);
    }

    job.progress = 20;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "page3_result.mp4");

    const ffmpegArgs = await buildPage3Args({
        bgVideo: path.join(job.extractDir, bgVideo),
        headshot: path.join(job.extractDir, headshot),
        items: job.items,
        logo: path.join(job.extractDir, logo),
        personName: job.personName,
        brandName: job.brandName,
        outPath: finalOut,
    });

    job.progress = 50;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    if (!fs.existsSync(finalOut)) {
        throw new Error("Output file was not created");
    }

    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) {
        throw new Error("Output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Page3 Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

async function processPage4Job(jobId: string, jobDir: string, jobFile: string, job: Page4JobData) {
    console.log(`[Page4 Job ${jobId}] Starting processing...`);

    await extractZip(job.inputZip, job.extractDir);

    job.progress = 10;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const files = fs.readdirSync(job.extractDir);

    const bgVideo = files.find(f => f.toLowerCase().includes("page4_bg") && f.endsWith(".mp4"));
    const logo = files.find(f => f.toLowerCase().includes("mangomagic") && f.endsWith(".png"));
    const qr = files.find(f => f.toLowerCase() === "qr.png");
    const headshot = files.find(f =>
        (f.toLowerCase().includes("profile") || f.toLowerCase().includes("headshot")) &&
        (f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg"))
    );

    if (!bgVideo || !logo || !qr || !headshot) {
        throw new Error(`Missing required files. Found: bg=${bgVideo}, logo=${logo}, qr=${qr}, headshot=${headshot}`);
    }

    console.log(`[Page4 Job ${jobId}] Found all required files`);

    job.progress = 20;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "page4_result.mp4");

    const ffmpegArgs = await buildPage4Args({
        bgVideo: path.join(job.extractDir, bgVideo),
        headshot: path.join(job.extractDir, headshot),
        person: job.personName,
        brandName: job.brandName,
        quote: job.quote,
        logo: path.join(job.extractDir, logo),
        qr: path.join(job.extractDir, qr),
        outPath: finalOut,
    });

    job.progress = 50;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    console.log(`[Page4 Job ${jobId}] FFmpeg completed`);

    if (!fs.existsSync(finalOut)) {
        throw new Error("Output file was not created");
    }

    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) {
        throw new Error("Output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Page4 Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

async function processAudioJob(jobId: string, jobDir: string, jobFile: string, job: AudioJobData) {
    console.log(`[Audio Job ${jobId}] Starting processing...`);

    await extractZip(job.inputZip, job.extractDir);

    job.progress = 20;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const files = fs.readdirSync(job.extractDir);

    // Find video file
    const videoFile = files.find(f =>
        f.endsWith(".mp4") || f.endsWith(".mov") || f.endsWith(".avi") || f.endsWith(".mkv")
    );

    // Find audio file
    const audioFile = files.find(f =>
        f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".m4a") || f.endsWith(".aac")
    );

    if (!videoFile) {
        throw new Error(`No video file found in ZIP. Files: ${files.join(", ")}`);
    }

    if (!audioFile) {
        throw new Error(`No audio file found in ZIP. Files: ${files.join(", ")}`);
    }

    console.log(`[Audio Job ${jobId}] Found video: ${videoFile}, audio: ${audioFile}`);

    job.progress = 40;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const videoPath = path.join(job.extractDir, videoFile);
    const audioPath = path.join(job.extractDir, audioFile);

    // Get durations
    console.log(`[Audio Job ${jobId}] Getting video duration...`);
    const videoDuration = await getVideoDuration(videoPath);
    console.log(`[Audio Job ${jobId}] Video duration: ${videoDuration.toFixed(2)}s`);

    job.progress = 50;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Audio Job ${jobId}] Getting audio duration...`);
    const audioDuration = await getAudioDuration(audioPath);
    console.log(`[Audio Job ${jobId}] Audio duration: ${audioDuration.toFixed(2)}s`);

    if (audioDuration < videoDuration) {
        console.log(`[Audio Job ${jobId}] Audio is shorter than video. Will loop audio.`);
    } else {
        console.log(`[Audio Job ${jobId}] Audio is longer/equal to video. Will trim audio.`);
    }

    job.progress = 60;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const finalOut = path.join(jobDir, "audio_result.mp4");

    const audioArgs = buildAddAudioArgs({
        videoPath,
        audioPath,
        outputPath: finalOut,
        videoDuration,
        audioDuration,
        fadeOutDuration: 3.0
    });

    console.log(`[Audio Job ${jobId}] Adding audio to video...`);

    job.progress = 70;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    await runCmd("ffmpeg", audioArgs, {}, MAX_PROCESSING_TIME);

    if (!fs.existsSync(finalOut)) {
        throw new Error("Output file was not created");
    }

    const stats = fs.statSync(finalOut);
    if (stats.size < 1000) {
        throw new Error("Output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalOut;
    job.progress = 100;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Audio Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

// ====================== ASSEMBLE PROCESSOR ======================
async function processAssembleJob(jobId: string, jobDir: string, jobFile: string, job: AssembleJobData) {
    console.log(`[Assemble Job ${jobId}] Starting processing...`);

    await extractZip(job.inputZip, job.extractDir);

    job.progress = 10;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const files = fs.readdirSync(job.extractDir);

    const page1 = files.find(f => f.toLowerCase().includes("page1_result") && f.endsWith(".mp4"));
    const page2 = files.find(f => f.toLowerCase().includes("page2_result") && f.endsWith(".mp4"));
    const page3 = files.find(f => f.toLowerCase().includes("page3_result") && f.endsWith(".mp4"));
    const page4 = files.find(f => f.toLowerCase().includes("page4_result") && f.endsWith(".mp4"));

    if (!page1 || !page2 || !page3 || !page4) {
        throw new Error(`Missing required page videos. Found: page1=${page1}, page2=${page2}, page3=${page3}, page4=${page4}`);
    }

    console.log(`[Assemble Job ${jobId}] Found all 4 page videos`);

    job.progress = 20;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const segmentsDir = path.join(jobDir, "segments");
    fs.mkdirSync(segmentsDir, { recursive: true });

    // Define 4 different transition combinations

    const segments = buildMultipleSegments({
        page1: path.join(job.extractDir, page1),
        page2: path.join(job.extractDir, page2),
        page3: path.join(job.extractDir, page3),
        page4: path.join(job.extractDir, page4),
        segmentCount: 4,
        outPath: segmentsDir,
    });

    // Generate 4 segments with different transitions
    for (let i = 0; i < segments.length; i++) {
        console.log(`\nCreating segment ${i + 1}/${segments.length}...`);


        await runCmd("ffmpeg", segments[i].args, {}, MAX_PROCESSING_TIME);
    }

    console.log("\nAll segments created. Concatenating...");

    // Create concat file
    const concatFilePath = path.join(jobDir, "concat.txt");
    const concatContent = segments
        .map(s => `file '${s.outPath}'`)
        .join("\n");

    fs.writeFileSync(concatFilePath, concatContent, "utf8");

    const finalPath = `${segmentsDir}/final.mp4`;
    const concatArgs = buildConcatArgs(
        segments.map(s => s.outPath),
        finalPath,
        concatFilePath
    );

    console.log(`[Assemble Job ${jobId}] Concatenating segments...`);

    await runCmd("ffmpeg", concatArgs, {}, MAX_PROCESSING_TIME);

    console.log(`[Assemble Job ${jobId}] Concatenation completed`);

    if (!fs.existsSync(finalPath)) {
        throw new Error("Final output file was not created");
    }

    const stats = fs.statSync(finalPath);
    if (stats.size < 1000) {
        throw new Error("Final output file is too small (likely corrupt)");
    }

    job.status = "done";
    job.result = finalPath;
    job.progress = 100;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    console.log(`[Assemble Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}


//UNIFIED WORKER LOOP
async function unifiedWorkerLoop() {
    try {
        const jobIds = fs.existsSync(JOBS_DIR) ? fs.readdirSync(JOBS_DIR) : [];

        for (const jobId of jobIds) {
            const jobDir = path.join(JOBS_DIR, jobId);
            const jobFile = path.join(jobDir, "job.json");

            if (!fs.existsSync(jobFile)) continue;

            let job: JobData | Page1JobData | Page2JobData | Page3JobData | Page4JobData | AssembleJobData;
            try {
                job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
            } catch (err) {
                console.error("Failed to read job file:", jobFile, err);
                continue;
            }

            if (job.status !== "pending") continue;

            // Mark as processing
            job.status = "processing";
            job.progress = 0;
            fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

            try {
                // Determine job type and process accordingly
                if (jobId.startsWith('page1_')) {
                    await processPage1Job(jobId, jobDir, jobFile, job as Page1JobData);
                } else if (jobId.startsWith('page2_')) {
                    await processPage2Job(jobId, jobDir, jobFile, job as Page2JobData);
                } else if (jobId.startsWith('page3_')) {
                    await processPage3Job(jobId, jobDir, jobFile, job as Page3JobData);
                } else if (jobId.startsWith('page4_')) {
                    await processPage4Job(jobId, jobDir, jobFile, job as Page4JobData);
                } else if (jobId.startsWith('assemble_')) {
                    await processAssembleJob(jobId, jobDir, jobFile, job as AssembleJobData);
                } else if (jobId.startsWith('audio_')) {
                    await processAudioJob(jobId, jobDir, jobFile, job as AudioJobData);
                }
                else {
                    // Default merge job
                }
            } catch (err) {
                console.error(`[Job ${jobId}] ERROR:`, err);
                job.status = "error";
                job.error = String(err);
                job.progress = 0;
                fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
            }
        }
    } catch (err) {
        console.error("Worker loop unexpected error:", err);
    } finally {
        // Always continue loop after delay
        setTimeout(unifiedWorkerLoop, 2000);
    }
}

// ====================== START SINGLE WORKER ======================
console.log("Starting unified worker loop...");
unifiedWorkerLoop();




app.get('/health', (req, res): void => {
    res.json({ ok: true, endpoints: ['/host', '/guest', '/merge', '/clip'] });
});

app.listen(PORT, () => {
    console.log(`FFmpeg service listening on ${PORT}`);
});