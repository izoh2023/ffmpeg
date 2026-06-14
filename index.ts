
interface JobData {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  inputZip: string;
  extractDir: string;
  result?: string;
  error?: string;
  progress?: number;
}

interface LayoutResult {
  filter: string;
  outputs: string[];
}



import express, { Request, Response, RequestHandler } from 'express';
import multer, { Multer } from 'multer';
// import fs from 'fs';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import sharp from "sharp";
import ffmpeg from 'fluent-ffmpeg';
import unzipper from "unzipper";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from 'p-limit';
import { promises as fsPromises } from "fs";

sharp.cache(false)
sharp.concurrency(1)


// ESM safe __filename / __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Runtime jobs directory (NOT inside dist)
const JOBS_DIR = path.join("/tmp", "jobs");
const MAX_PROCESSING_TIME = 600000; // 3 minutes max
const STALL_TIMEOUT = 60000; // 45 seconds without progress = stall


// Ensure directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

// Types
interface TranscriptToken {
  text: string;
  start: number;
  end: number;
  type?: string;
}

interface ClipRange {
  start: number;
  end: number;
  label: string;
}

interface ClipFile {
  path: string;
  label: string;
}

interface LayoutResult {
  filter: string;
  outputs: string[];
}

interface MergeRequestBody {
  transcript?: string | TranscriptToken[];
  filenames?: string[];
}

interface ClipRequestBody {
  clips?: string | ClipRange[];
  maxDuration?: string | number;
}

// Configuration
const PORT: number = Number(process.env.PORT) || 9000;
const TMP_DIR: string = process.env.TMP_DIR || '/tmp/ffout';
const DATA_DIR: string = process.env.DATA_DIR || '/home/node/data';
const MANGO_LOGO_PATH: string = path.join(DATA_DIR, 'logo.png');
const FONT_PATH: string = process.env.FONT_PATH || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const upload: Multer = multer({ dest: TMP_DIR });
const app = express();
app.use(express.json({ limit: '50mb' }));

/** Helpers **/
function safeFilename(prefix: string = 'out'): string {
  return path.join(TMP_DIR, `${prefix}_${Date.now()}_${uuidv4()}.mp4`);
}

function pad(n: number, l: number = 2): string {
  return n.toString().padStart(l, '0');
}

function secondsToAssTime(s: number): string {
  // ASS time format: H:MM:SS.cs (centiseconds)
  const cs = Math.round((s % 1) * 100);
  const sec = Math.floor(s % 60);
  const m = Math.floor((s / 60) % 60);
  const h = Math.floor(s / 3600);
  return `${h}:${pad(m, 2)}:${pad(sec, 2)}.${pad(cs, 2)}`;
}

function escapeAssText(t: string): string {
  return t.replace(/[\{\}\\]/g, ''); // remove braces that interfere with ASS
}

function writeASSFromTranscript(
  transcript: TranscriptToken[],
  assPath: string,
  options: Record<string, any> = {}
): void {
  // transcript: array of tokens with "text","start","end","type"
  // We'll group tokens into lines based on word timings. For simplicity create a single line per word
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${path.basename(FONT_PATH)},28,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Build events: we will combine tokens into words; spacing tokens are ignored
  const events: string[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const t = transcript[i];
    if (!t || t.type === 'spacing' || (t.text && t.text.trim() === '')) continue;
    const start = secondsToAssTime(t.start);
    const end = secondsToAssTime(t.end);
    const text = escapeAssText(t.text);
    events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }

  fs.writeFileSync(assPath, head + events.join('\n'), 'utf8');
}

async function generatePillImages(
  text: string,
  options?: {
    pillBg?: string;
    pillText?: string;
    shadowBg?: string;
  }
) {
  const fontSize = 42;
  const paddingX = 50;
  const paddingY = 25;
  const borderRadius = 45;

  const pillBg = options?.pillBg ?? "#000000";
  const pillText = options?.pillText ?? "#FFFFFF";
  const shadowBg = options?.shadowBg ?? "#FFD400";

  // Measure text width
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="${fontSize}" font-size="${fontSize}">${text}</text>
    </svg>
  `;
  const metrics = await sharp(Buffer.from(svg)).metadata();

  if (!metrics.width) {
    throw new Error("Could not measure text width");
  }

  const width = metrics.width + paddingX * 2;
  const height = fontSize + paddingY * 2;

  const pillPath = `/tmp/pill_${Date.now()}.png`;
  const shadowPath = `/tmp/shadow_${Date.now()}.png`;

  // Pill
  const pillSVG = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="${borderRadius}" ry="${borderRadius}" fill="${pillBg}"/>
      <text
        x="50%"
        y="50%"
        font-size="${fontSize}"
        fill="${pillText}"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="Arial, sans-serif"
      >${text}</text>
    </svg>
  `;

  await sharp(Buffer.from(pillSVG)).png().toFile(pillPath);

  // Shadow
  const shadowExtension = 10;
  const shadowHeight = height + shadowExtension;
  const shadowBorderRadius = borderRadius + shadowExtension / 2;

  const shadowSVG = `
    <svg width="${width}" height="${shadowHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect
        width="100%"
        height="100%"
        rx="${shadowBorderRadius}"
        ry="${shadowBorderRadius}"
        fill="${shadowBg}"
      />
    </svg>
  `;

  await sharp(Buffer.from(shadowSVG)).png().toFile(shadowPath);

  return { pillPath, shadowPath, width, height };
}

async function getVideoFPS(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ff = spawn("ffprobe", [
      "-v", "0",
      "-select_streams", "v:0",
      "-print_format", "json",
      "-show_streams",
      inputPath
    ]);

    let data = "";

    ff.stdout.on("data", (chunk) => (data += chunk));

    ff.on("close", () => {
      try {
        const json = JSON.parse(data);
        const stream = json.streams?.[0];
        if (!stream) return resolve(null);

        const fps = stream.avg_frame_rate;
        if (!fps || fps === "0/0") return resolve(null);

        const [num, den] = fps.split("/").map(Number);
        if (!num || !den) return resolve(null);

        resolve(num / den);
      } catch {
        resolve(null);
      }
    });
  });
}

function parseFps(raw: string): number {
  try {
    const [num, den] = raw.trim().split('/').map(Number);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  } catch { }
  return 30; // fallback
}

async function runCmdRaw(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);

    let data = "";
    let err = "";

    child.stdout.on("data", (chunk) => (data += chunk.toString()));
    child.stderr.on("data", (chunk) => (err += chunk.toString()));

    child.on("close", (code) => {
      if (code === 0) resolve(data.trim());
      else reject(new Error(err || `Command failed with ${code}`));
    });
  });
}

// ====================== OPTIMIZED LAYOUT FILTER ======================
function buildLayoutFilter(inputCount: number): LayoutResult {
  if (inputCount === 1) {
    return {
      filter: `[0:v]scale=1280:720,setsar=1[outv0]`,
      outputs: ['outv0'],
    };
  }
  if (inputCount === 2) {
    // Optimized: reduce resolution for faster processing
    return {
      filter:
        `[0:v]scale=960:720:flags=fast_bilinear,setsar=1[left];` +
        `[1:v]scale=960:720:flags=fast_bilinear,setsar=1[right];` +
        `[left][right]hstack=inputs=2[outv0]`,
      outputs: ['outv0'],
    };
  }
  if (inputCount === 3) {
    return {
      filter:
        `[0:v]scale=1280:360:flags=fast_bilinear,setsar=1[top];` +
        `[1:v]scale=640:360:flags=fast_bilinear,setsar=1[g1];` +
        `[2:v]scale=640:360:flags=fast_bilinear,setsar=1[g2];` +
        `nullsrc=size=1280x720[base];` +
        `[base][top]overlay=0:0[tmp1];` +
        `[tmp1][g1]overlay=0:360[tmp2];` +
        `[tmp2][g2]overlay=640:360[outv0]`,
      outputs: ['outv0'],
    };
  }
  // 2x2 grid
  const parts: string[] = [];
  for (let i = 0; i < Math.min(4, inputCount); i++) {
    parts.push(`[${i}:v]scale=640:360:flags=fast_bilinear,setsar=1[v${i}]`);
  }
  return {
    filter:
      parts.join(';') +
      `;[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|640_0|0_360|640_360[outv0]`,
    outputs: ['outv0'],
  };
}

// ====================== SIMPLIFIED AUDIO MIXING ======================
function buildAudioFilter(inputCount: number): string {
  if (inputCount === 1) {
    return '[0:a]anull[aout]';
  }

  if (inputCount === 2) {
    // SIMPLIFIED: Use amix instead of sidechain compression (much faster)
    // Guest at 100%, Host ducked to 40% during overlap
    return `[0:a]volume=0.4[host];[1:a]volume=1.0[guest];[host][guest]amix=inputs=2:duration=longest:dropout_transition=2[aout]`;
  }

  // For 3+ inputs, simple mix
  const inputs = Array.from({ length: inputCount }, (_, i) => `[${i}:a]`).join('');
  return `${inputs}amix=inputs=${inputCount}:duration=longest[aout]`;
}


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

function writeConcatList(paths: string[], filePath: string) {
  const content = paths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(filePath, content);
}



/** END Helpers **/

/** Endpoint: /host
 * Accepts multipart form-data with "file" (single upload).
 * Adds logo (MANGO_LOGO_PATH) and overlays name bottom-left.
 */
app.post('/host', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'file is required (form field "file")' });
      return;
    }

    const infile = req.file.path;

    const hostName = req.body.person;
    const company = req.body.company;

    // Sheet-driven branding
    const pillBg = req.body.pill_bg;
    const pillText = req.body.pill_text;
    const shadowBg = req.body.shadow_bg;

    const outPath = safeFilename('host');

    const { pillPath, shadowPath } = await generatePillImages(hostName, {
      pillBg,
      pillText,
      shadowBg
    });

    const fps = await getVideoFPS(infile);
    const fpsValue = fps || 30;

    const args = [
      "-i", infile,
      "-i", shadowPath,
      "-i", pillPath,

      "-filter_complex",
      `[0:v]fps=${fpsValue}[base];` +
      `[base][1:v]overlay=x=20:y=H-170[tmp1];` +
      `[tmp1][2:v]overlay=x=20:y=H-170[v]`,

      "-map", "[v]",
      "-map", "0:a?",

      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",

      "-c:a", "aac",
      "-b:a", "128k",

      "-r", `${fpsValue}`,
      "-y", outPath
    ];

    await runCmd("ffmpeg", args);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(outPath)}"`
    );

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);

    const cleanup = () => {
      [infile, outPath, pillPath, shadowPath].forEach(p => {
        try { fs.unlinkSync(p); } catch { }
      });
    };

    stream.on("end", cleanup);
    stream.on("error", cleanup);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});


/** Endpoint: /guest
 * Accepts multipart form-data with "file" (single upload).
 * Adds name tag extracted from filename and returns processed video.
 */
app.post('/guest', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'file is required (form field "file")' });
      return;
    }

    const infile = req.file.path;

    const guestName = req.body.person;
    const company = req.body.company;

    // Sheet-driven branding
    const pillBg = req.body.pill_bg;
    const pillText = req.body.pill_text;
    const shadowBg = req.body.shadow_bg;

    const outPath = safeFilename('guest');

    // Generate pill + shadow
    const { pillPath, shadowPath, width } = await generatePillImages(
      guestName,
      {
        pillBg,
        pillText,
        shadowBg
      }
    );

    // Detect FPS dynamically
    const fps = await getVideoFPS(infile);
    const fpsValue = fps || 30;

    console.log("Detected FPS:", fpsValue);

    // FFmpeg args
    const args = [
      "-i", infile,        // 0
      "-i", shadowPath,    // 1
      "-i", pillPath,      // 2

      "-filter_complex",
      `[0:v]fps=${fpsValue}[base];` +
      `[base][1:v]overlay=x=20:y=H-170[tmp1];` +
      `[tmp1][2:v]overlay=x=20:y=H-170[v]`,

      "-map", "[v]",
      "-map", "0:a?",

      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",

      "-c:a", "aac",
      "-b:a", "128k",

      "-r", `${fpsValue}`, // ensure output fps matches input
      "-y", outPath
    ];

    await runCmd("ffmpeg", args);

    // Stream output
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(outPath)}"`
    );

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);

    const cleanup = () => {
      [infile, outPath, pillPath, shadowPath].forEach(p => {
        try { fs.unlinkSync(p); } catch { }
      });
    };

    stream.on("end", cleanup);
    stream.on("error", cleanup);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });

    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch { }
  }
});



/** Endpoint: /merge
 * multipart/form-data with multiple files (field "files") and JSON body.transcript (array)
 * Body options:
 *  - transcript: JSON array (word-level tokens)
 *  - filenames may be supplied as body.filenames[] to help name extraction (optional)
 *
 * Returns merged MP4 (streamed) as response attachment.
 */
app.post("/merge", upload.single("zipfile"), async (req, res) => {
  try {
    console.log("===== /merge called =====");

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

    const jobId = `${Date.now()}_${uuidv4()}`;
    const jobDir = path.join(JOBS_DIR, jobId);
    const extractDir = path.join(jobDir, "extract");
    const inputZip = path.join(jobDir, "input.zip");

    fs.mkdirSync(jobDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    // Replace rename with copy + unlink to avoid cross-device error
    fs.copyFileSync(req.file.path, inputZip);
    fs.unlinkSync(req.file.path);

    const job: JobData = {
      id: jobId,
      status: "pending",
      inputZip,
      extractDir,
    };

    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2));

    return res.json({
      jobId,
      status: "pending",
      status_url: `/merge/status/${jobId}`,
      download_url: `/merge/download/${jobId}`,
    });
  } catch (err) {
    console.error("ERR /merge:", err);
    res.status(500).json({ error: "Internal Error", details: String(err) });
  }
});

app.get("/merge/status/:jobId", (req, res) => {
  const jobDir = path.join(JOBS_DIR, req.params.jobId);
  const jobFile = path.join(jobDir, "job.json");

  if (!fs.existsSync(jobFile)) {
    return res.status(404).json({ error: "Job not found" });
  }

  const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
  res.json(job);
});


app.get("/merge/download/:jobId", (req, res) => {
  const jobDir = path.join(JOBS_DIR, req.params.jobId);
  const jobFile = path.join(jobDir, "job.json");

  if (!fs.existsSync(jobFile)) {
    return res.status(404).json({ error: "Job not found" });
  }

  const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

  if (job.status !== "done") {
    return res.status(400).json({ error: "Job not finished" });
  }

  const resultPath = job.result; // assuming this is the path to the output file

  if (!fs.existsSync(resultPath)) {
    return res.status(404).json({ error: "Result file not found" });
  }

  // Set headers for video (adjust Content-Type as needed)
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resultPath)}"`);

  const fileStream = fs.createReadStream(resultPath);
  fileStream.pipe(res);

  fileStream.on('error', (err) => {
    console.error('File stream error:', err);
    res.status(500).end();
  });
});


// ====================== CLEANUP OLD JOBS ======================
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


// Cleanup every 10 minutes
setInterval(cleanupOldJobs, 600000);


app.post('/logo', upload.single('zipfile'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'ZIP file required in "zipfile" field' });
  }

  const zipPath = req.file.path;
  const tmpDir = path.join(
    '/tmp',
    `logojob_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // Extract ZIP
    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tmpDir }))
      .promise();

    const extractedFiles = fs
      .readdirSync(tmpDir)
      .map(f => path.join(tmpDir, f));

    if (extractedFiles.length < 2) {
      const videoFile = extractedFiles[0];

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="video.mp4"'
      );

      const stream = fs.createReadStream(videoFile);
      stream.pipe(res);

      const cleanup = () => {
        try { fs.unlinkSync(zipPath); } catch { }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
      };

      stream.on('end', cleanup);
      stream.on('error', cleanup);

      return;
    }

    // Sort by file size - smallest is intro, largest is main
    const sortedVideos = extractedFiles.sort((a, b) => {
      return fs.statSync(a).size - fs.statSync(b).size;
    });

    const logoFile = sortedVideos[0]
    const videoFile = sortedVideos[sortedVideos.length - 1];

    if (!videoFile || !logoFile) {
      throw new Error('ZIP must contain one video and one logo image (filename must include "logo")');
    }

    const outputPath = path.join(tmpDir, 'output_with_logo.mp4');

    // 🔥 Extract FPS like /host
    const fps = await getVideoFPS(videoFile);
    const fpsValue = fps || 30;

    // 🔥 Optimized FFmpeg pipeline
    const ffmpegArgs = [
      '-i', videoFile,
      '-i', logoFile,

      '-filter_complex',
      `[0:v]fps=${fpsValue}[base];` +
      `[1:v]scale='min(iw,300)':'min(ih,300)':force_original_aspect_ratio=decrease[logo];` +
      `[base][logo]overlay=W-w-20:20[v]`,

      '-map', '[v]',
      '-map', '0:a?',

      // Video (FAST)
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',

      // Audio (SAFE)
      '-c:a', 'aac',
      '-b:a', '128k',

      '-movflags', '+faststart',
      '-shortest',

      '-y',
      outputPath,
    ];

    await runCmd('ffmpeg', ffmpegArgs);

    // Stream result
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="video_with_logo.mp4"'
    );

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    const cleanup = () => {
      try { fs.unlinkSync(zipPath); } catch { }
      try { fs.unlinkSync(outputPath); } catch { }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    };

    stream.on('end', cleanup);
    stream.on('error', cleanup);

  } catch (err) {
    console.error('Error processing /logo:', err);

    try { fs.unlinkSync(zipPath); } catch { }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }

    res.status(500).json({ error: String(err) });
  }
});

app.post('/intro', upload.single('zipfile'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'ZIP file required in "zipfile"' });
  }

  const zipPath = req.file.path;
  const tmpDir = path.join('/tmp', `intro_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tmpDir }))
      .promise();

    const files = fs.readdirSync(tmpDir).map(f => path.join(tmpDir, f));

    // Get all video files
    const videoFiles = files.filter(f =>
      /\.(mp4|mov|mkv|avi|webm)$/i.test(f)
    );

    if (videoFiles.length < 2) {
      const videoFile = videoFiles[0];

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

      const stream = fs.createReadStream(videoFile);
      stream.pipe(res);

      const cleanup = () => {
        try { fs.unlinkSync(zipPath); } catch { }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
      };

      stream.on('end', cleanup);
      stream.on('error', cleanup);

      return;
    }

    // Sort by file size - smallest is intro, largest is main
    const sortedVideos = videoFiles.sort((a, b) => {
      return fs.statSync(a).size - fs.statSync(b).size;
    });

    const introVideo = sortedVideos[0]; // Smallest
    const mainVideo = sortedVideos[sortedVideos.length - 1]; // Largest

    const outputPath = path.join(tmpDir, 'video_with_intro.mp4');

    // Normalize FPS based on main video
    const fps = await getVideoFPS(mainVideo);
    const fpsValue = fps || 30;

    const args = [
      '-i', introVideo,
      '-i', mainVideo,

      '-filter_complex',
      `[0:v]fps=${fpsValue},scale=1280:720,setsar=1[intro];` +
      `[1:v]fps=${fpsValue},scale=1280:720,setsar=1[main];` +
      `[intro][0:a][main][1:a]concat=n=2:v=1:a=1[v][a]`,

      '-map', '[v]',
      '-map', '[a]',

      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',

      '-c:a', 'aac',
      '-b:a', '128k',

      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-shortest',

      '-y',
      outputPath,
    ];

    await runCmd('ffmpeg', args);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="video_with_intro.mp4"');

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    const cleanup = () => {
      try { fs.unlinkSync(zipPath); } catch { }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    };

    stream.on('end', cleanup);
    stream.on('error', cleanup);

  } catch (err) {
    console.error('/intro error:', err);
    try { fs.unlinkSync(zipPath); } catch { }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    res.status(500).json({ error: String(err) });
  }
});

app.post('/outro', upload.single('zipfile'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'ZIP file required in "zipfile"' });
  }

  const zipPath = req.file.path;
  const tmpDir = path.join('/tmp', `outro_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tmpDir }))
      .promise();

    const files = fs.readdirSync(tmpDir).map(f => path.join(tmpDir, f));


    // Get all video files
    const videoFiles = files.filter(f =>
      /\.(mp4|mov|mkv|avi|webm)$/i.test(f)
    );

    if (videoFiles.length < 2) {
      const videoFile = videoFiles[0];

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

      const stream = fs.createReadStream(videoFile);
      stream.pipe(res);

      const cleanup = () => {
        try { fs.unlinkSync(zipPath); } catch { }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
      };

      stream.on('end', cleanup);
      stream.on('error', cleanup);

      return;
    }
    // Sort by file size - smallest is outro, largest is main
    const sortedVideos = videoFiles.sort((a, b) => {
      return fs.statSync(a).size - fs.statSync(b).size;
    });

    const outroVideo = sortedVideos[0]; // Smallest
    const mainVideo = sortedVideos[sortedVideos.length - 1]; // Largest

    const outputPath = path.join(tmpDir, 'video_with_outro.mp4');

    const fps = await getVideoFPS(mainVideo);
    const fpsValue = fps || 30;

    const args = [
      '-i', mainVideo,
      '-i', outroVideo,

      '-filter_complex',
      `[0:v]fps=${fpsValue},scale=1280:720,setsar=1[main];` +
      `[1:v]fps=${fpsValue},scale=1280:720,setsar=1[outro];` +
      `[main][0:a][outro][1:a]concat=n=2:v=1:a=1[v][a]`,

      '-map', '[v]',
      '-map', '[a]',

      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',

      '-c:a', 'aac',
      '-b:a', '128k',

      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-shortest',

      '-y',
      outputPath,
    ];

    await runCmd('ffmpeg', args);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="video_with_outro.mp4"');

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    const cleanup = () => {
      try { fs.unlinkSync(zipPath); } catch { }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    };

    stream.on('end', cleanup);
    stream.on('error', cleanup);

  } catch (err) {
    console.error('/outro error:', err);
    try { fs.unlinkSync(zipPath); } catch { }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    res.status(500).json({ error: String(err) });
  }
});

app.post('/clip', upload.single('file') as RequestHandler, async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'file required (field "file")' });
    return;
  }

  const infile = req.file.path;
  const body = req.body as ClipRequestBody;

  // Helper to cleanup files
  const cleanupFiles = (files: string[]) => {
    files.forEach(f => {
      try { fs.unlinkSync(f); } catch { }
    });
  };

  try {
    const clips = body.clips ? (typeof body.clips === 'string' ? JSON.parse(body.clips) : body.clips) : null;
    const maxDuration = Number(body.maxDuration || 30);

    let clipRanges: ClipRange[] = [];

    if (clips && Array.isArray(clips) && clips.length) {
      clipRanges = clips.map(c => ({
        start: Number(c.start),
        end: Number(c.end),
        label: c.label || ''
      }));
    } else {
      // Get total duration
      const duration: number = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(infile, (err, meta) => {
          if (err) return reject(err);
          resolve(meta.format.duration || 0);
        });
      });

      const total = Math.floor(duration);
      for (let s = 0; s < total; s += maxDuration) {
        clipRanges.push({
          start: s,
          end: Math.min(s + maxDuration, total),
          label: `clip_${s}_${Math.min(s + maxDuration, total)}`
        });
      }
    }

    // Limit concurrency to avoid overloading CPU / I/O
    const limit = pLimit(3);

    // const clipPromises = clipRanges.map((c, idx) =>
    //   limit(async () => {
    //     const outPath = path.join(TMP_DIR, `clip_${idx}_${Date.now()}_${uuidv4()}.mp4`);

    //     // FFmpeg args: -ss BEFORE -i, -to as duration (end-start)
    //     const ffmpegArgs = [
    //       '-ss', c.start.toString(),
    //       '-to', (c.end - c.start).toString(),
    //       '-i', infile,
    //       '-c:v', 'libx264',
    //       '-preset', 'fast',
    //       '-crf', '23',
    //       '-c:a', 'aac',
    //       '-b:a', '128k',
    //       '-avoid_negative_ts', 'make_zero',
    //       '-movflags', '+faststart',
    //       '-y',
    //       outPath
    //     ];

    //     await runCmd('ffmpeg', ffmpegArgs);
    //     return { path: outPath, label: c.label || path.basename(outPath) };
    //   })
    // );

    const clipPromises = clipRanges.map((c, idx) =>
      limit(async () => {
        // Validate clip range
        if (c.start >= c.end) {
          throw new Error(`Invalid clip range: start=${c.start} >= end=${c.end}`);
        }

        const duration = c.end - c.start;
        if (duration <= 0) {
          throw new Error(`Invalid clip duration: ${duration}`);
        }

        const outPath = path.join(TMP_DIR, `clip_${idx}_${Date.now()}_${uuidv4()}.mp4`);

        const ffmpegArgs = [
          '-ss', c.start.toString(),
          '-t', duration.toString(),  // Use duration
          '-i', infile,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          '-y',
          outPath
        ];

        await runCmd('ffmpeg', ffmpegArgs);
        return { path: outPath, label: c.label || path.basename(outPath) };
      })
    );

    const clipFiles: ClipFile[] = await Promise.all(clipPromises);

    // Stream ZIP archive back to client
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=clips_${Date.now()}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', err => {
      console.error('Archive error:', err);
      cleanupFiles([infile, ...clipFiles.map(cf => cf.path)]);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Archive error' });
      }
    });

    archive.pipe(res);

    clipFiles.forEach(cf => {
      archive.file(cf.path, { name: cf.label + path.extname(cf.path) });
    });

    await archive.finalize();

    res.on('finish', () => {
      cleanupFiles([infile, ...clipFiles.map(cf => cf.path)]);
    });

  } catch (err) {
    console.error('Clip error:', err);
    cleanupFiles([infile]);
    res.status(500).json({ error: String(err) });
  }
});

async function extractZip(zipPath: string, extractDir: string) {
  await fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: extractDir }))
    .promise();
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

function buildPage1Args({
  bgVideo,
  headshot,
  logo,
  qr,
  brandName,
  person,
  outPath,
  fps = 30
}: Page1Params): string[] {
  const fontPath = process.env.FONT_PATH || "/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf";

  return [
    "-i", bgVideo,
    "-i", headshot,
    "-i", logo,
    "-i", qr,

    "-filter_complex",
    `
[0:v]scale=1920:1080,fps=${fps}[bg];

[1:v]scale=260:260,format=rgba,
geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':
a='if(lte((X-130)^2+(Y-130)^2,130^2),255,0)'[head];

[2:v]scale=90:90[logo];
[3:v]scale=100:100[qr];

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
    "-preset", "ultrafast",
    "-crf", "22",
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



interface Page2JobData {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  inputZip: string;
  extractDir: string;
  result?: string;
  error?: string;
  progress?: number;
}


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
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}

async function buildPage2Args({
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
  const fontPath = process.env.FONT_PATH || "/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf";
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
[0:v]scale=1920:1080,fps=${fps}[bg];
[1:v]scale=1100:1100[plate];

[2:v]scale=380:380,format=rgba,
geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':
a='if(lte((X-190)^2+(Y-190)^2,190^2),255,0)'
[headM];

[headM]scale=
w='380*if(lt(t,${D}),t/${D},1)':
h='380*if(lt(t,${D}),t/${D},1)':
eval=frame
[head];

[3:v]scale=
w='min(50,40+10*if(lt(t,${D}),t/${D},1))':
h='min(50,40+10*if(lt(t,${D}),t/${D},1))':
eval=frame
[logoA];

[4:v]scale=150:150[qr];


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

[s6]drawtext=fontfile=${fontPath}:
text='JOIN US':fontsize=80:fontcolor=white:
x=W-350:y=H-280:box=1:boxcolor=black@0:boxborderw=14[s7];

[s7]drawtext=fontfile=${fontPath}:
text='LIVE':fontsize=65:fontcolor=white:
x=W-350:y=H-180:box=1:boxcolor=black@0:boxborderw=14[s8];

[s8][qr]overlay=W-170:H-220[v]
`,

    "-map", "[v]",
    "-map", "0:a?",
    "-t", "11",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "ultrafast",
    "-crf", "22",
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

function ffText(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function forceGC() {
  if (global.gc) global.gc();
}

/* =========================
   SVG → PNG INSIGHT PLATES
========================= */
async function generateInsightPlates({
  items,
  size = 1600,
  holeRadius = 190,
  cardW = 520,
  cardH = 200,
  colors = ["#A78BFA", "#FB923C", "#2DD4BF", "#F472B6"]
}: {
  items: { label: string; text: string; number: string }[];
  size?: number;
  holeRadius?: number;
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
  const spacing =
    (size - verticalPadding * 2 - cardH * 4) / 3.5;
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

  function wrapText(text: string, maxChars: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length <= maxChars) line = test;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function computeTypography(label: string, lines: string[]) {
    const totalChars =
      label.length + lines.join("").length;
    const lineCount = lines.length;

    // SHORT → scale up
    if (lineCount === 1 && totalChars < 60) {
      return { label: 34, body: 32, gap: 30 };
    }

    // DENSE → scale down
    if (lineCount >= 2 && totalChars > 110) {
      return { label: 20, body: 16, gap: 22 };
    }

    // DEFAULT
    return { label: 22, body: 18, gap: 26 };
  }

  const connectors = items.map((_, i) => {
    const pos = positions[i];
    const isLeft = i < 4;
    const stroke = colors[i % colors.length];

    // ----------------------------
    // 1. Start point
    // ----------------------------
    const startX = isLeft ? pos.x + cardW : pos.x;
    const startY = pos.y + cardH / 2;

    // ----------------------------
    // 2. Vector to headshot center
    // ----------------------------
    const dx = cx - startX;
    const dy = cy - startY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const ux = dx / len;
    const uy = dy / len;

    // ----------------------------
    // 3. Hard stop radius
    // ----------------------------
    const headshotRadius = 230;
    const markerLen = 26;
    const safety = 10;

    const stopRadius = headshotRadius + markerLen + safety;

    const rawEndX = cx - ux * stopRadius;
    const rawEndY = cy - uy * stopRadius;

    // ----------------------------
    // 4. Initial curve control
    // ----------------------------
    const midX = (startX + rawEndX) / 2;
    const midY = (startY + rawEndY) / 2;

    const px = -uy;
    const py = ux;

    const curvePush = 80;

    let controlX = midX + px * curvePush;
    let controlY = midY + py * curvePush;

    // ----------------------------
    // 5. 🔒 Clamp control point OUTSIDE headshot
    // ----------------------------
    const cdx = controlX - cx;
    const cdy = controlY - cy;
    const cLen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;

    const minControlRadius = headshotRadius + 60;

    if (cLen < minControlRadius) {
      const scale = minControlRadius / cLen;
      controlX = cx + cdx * scale;
      controlY = cy + cdy * scale;
    }

    // ----------------------------
    // 6. Tangent-safe endpoint retreat
    // ----------------------------
    const tx = rawEndX - controlX;
    const ty = rawEndY - controlY;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;

    const retreat = 16;

    const endX = rawEndX - (tx / tLen) * retreat;
    const endY = rawEndY - (ty / tLen) * retreat;

    // ----------------------------
    // 7. SVG
    // ----------------------------
    return `
    <path d="M ${startX} ${startY}
             Q ${controlX} ${controlY}
               ${endX} ${endY}"
      fill="none"
      stroke="${stroke}"
      stroke-width="6"
      opacity="0.18"
      stroke-linecap="round"/>

    <path d="M ${startX} ${startY}
             Q ${controlX} ${controlY}
               ${endX} ${endY}"
      fill="none"
      stroke="${stroke}"
      stroke-width="3.6"
      stroke-dasharray="6,6"
      opacity="0.95"
      stroke-linecap="round"
      marker-end="url(#arrow-${i})"/>
  `;
  }).join("");



  const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');
    </style>

    ${colors.map((c, i) => `
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
  ${connectors}

  <!-- CARDS -->
  ${items.map((it, i) => {
    const pos = positions[i];
    const c = colors[i % colors.length];

    const wrapped = wrapText(it.text, 42).slice(0, 2);
    const typo = computeTypography(it.label, wrapped);

    return `
      <g transform="translate(${pos.x}, ${pos.y})">
        <rect width="${cardW}" height="${cardH}" rx="56"
              fill="${c}" opacity="0.96"/>

        <circle cx="${circleX}" cy="${circleY}" r="${circleRadius}"
                fill="white" opacity="0.25"/>

        <text x="${circleX}" y="${circleY + 1}"
              font-family="Inter, Arial, sans-serif"
              font-size="34"
              font-weight="700"
              fill="white"
              text-anchor="middle"
              dominant-baseline="middle">
          ${it.number}
        </text>

        <text x="${circleX + circleRadius + 28}"
              y="${circleY - typo.gap}"
              font-family="Inter, Arial, sans-serif"
              font-size="${typo.label}"
              font-weight="600"
              fill="rgba(0,0,0,0.85)">
          ${it.label}
        </text>

        ${wrapped.map((line, idx) => `
          <text x="${circleX + circleRadius + 28}"
                y="${circleY + 8 + idx * typo.gap}"
                font-family="Inter, Arial, sans-serif"
                font-size="${typo.body}"
                font-weight="500"
                fill="rgba(0,0,0,0.85)">
            ${line}
          </text>
        `).join("")}
      </g>
    `;
  }).join("")}
</svg>
`;

  const out = `/tmp/page3_plate_${Date.now()}.png`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}


/* =========================
   FFMPEG PAGE 3 BUILDER
========================= */
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
[0:v]scale=1920:1080,fps=${fps}[bg];
[1:v]scale=1920:1080[plate];

[2:v]scale=320:320,format=rgba,
geq=
r='r(X,Y)':
g='g(X,Y)':
b='b(X,Y)':
a='if(lte((X-160)^2+(Y-160)^2,160^2),255,0)'
[head];

[head]scale=
w='320*if(lt(t,${D}),t/${D},1)':
h='320*if(lt(t,${D}),t/${D},1)':
eval=frame[headA];

[bg][headA]overlay=W/2-160:H/2-220[o1];
[o1][plate]overlay=0:0[o2];

[3:v]scale=100:100[logo];


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
    "-preset", "ultrafast",
    "-crf", "28",
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

/* =========================
   HELPERS
========================= */

/* =========================
   SVG → PNG QUOTE PLATE
========================= */
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

/* =========================
   PERSON PLATE (IMPROVED)
========================= */
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
    /* =========================
       HEADSHOT (CIRCULAR)
    ========================= */
    const head = await sharp(headshot)
      .resize(headSize, headSize, { fit: "cover" })
      .composite([
        {
          input: Buffer.from(`
            <svg width="${headSize}" height="${headSize}">
              <circle
                cx="${headSize / 2}"
                cy="${headSize / 2}"
                r="${headSize / 2}"
                fill="white"
              />
            </svg>
          `),
          blend: "dest-in"
        }
      ])
      .png()
      .toBuffer();

    /* =========================
       TEXT SPLIT
    ========================= */
    const words = person.trim().split(/\s+/);
    const topLine = words.slice(0, 2).join(" ");
    const bottomLine = words.slice(2).join(" "); // may be empty

    const rightX = width - paddingRight;
    const centerY = height / 2;
    const lineOffset = fontSize * 0.65;

    /* =========================
       MEASURE TOP LINE (EXACT)
    ========================= */
    let topLineWidth = 0;

    if (bottomLine) {
      const measureSvg = Buffer.from(`
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
            x="${rightX}"
            y="${centerY}"
            text-anchor="end"
            dominant-baseline="middle"
          >${topLine}</text>
        </svg>
      `);

      const measured = await sharp(measureSvg)
        .png()
        .trim()
        .toBuffer({ resolveWithObject: true });

      topLineWidth = measured.info.width;
    }

    /* =========================
       FINAL SVG
    ========================= */
    const topCenterX = rightX - topLineWidth / 2;

    const finalSvg = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .name {
            font-family: ${fontFamily};
            font-size: ${fontSize}px;
            font-weight: 700;
            fill: #000;
          }
        </style>

        <text class="name">
          <!-- Top line -->
          <tspan
            x="${rightX}"
            y="${bottomLine ? centerY - lineOffset : centerY}"
            text-anchor="end"
            dominant-baseline="middle"
          >${bottomLine ? topLine : person}</tspan>

          ${bottomLine
        ? `
              <tspan
                x="${topCenterX}"
                y="${centerY + lineOffset}"
                text-anchor="middle"
                dominant-baseline="middle"
              >${bottomLine}</tspan>
            `
        : ""
      }
        </text>
      </svg>
    `);

    /* =========================
       POSITION HEADSHOT
    ========================= */
    const textLeftX = bottomLine
      ? rightX - topLineWidth
      : rightX - (await sharp(finalSvg).png().trim().metadata()).width!;

    const headX = Math.max(0, textLeftX - gap - headSize);
    const headY = Math.round((height - headSize) / 2);

    /* =========================
       OUTPUT
    ========================= */
    const out = `/tmp/person_plate_${Date.now()}.png`;

    await sharp(finalSvg)
      .png()
      .composite([{ input: head, left: headX, top: headY }])
      .toFile(out);

    return out;
  } catch (err) {
    const error = err as Error;
    throw new Error(
      `Failed to generate person plate: ${error.message}`
    );
  }
}

/* =========================
   PAGE 4 BUILDER (FINAL)
========================= */
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
[0:v]scale=1920:1080,fps=${fps}[bg];
[1:v]scale=1000:720[quote];
[2:v]scale=1100:260[personPlate];

[3:v]scale=200:200[logo];
[4:v]scale=200:200[qr];

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
    "-preset", "ultrafast",
    "-crf", "28",
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


interface AssembleJobData {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  inputZip: string;
  extractDir: string;
  result?: string;
  error?: string;
  progress?: number;
}

// ====================== ASSEMBLE BUILDER ======================
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
  // Calculate offsets based on page durations
  // page1: 0 to 7.4s (actually using 10s from buildPage1Args -t 10)
  // page2: starts at 6.2s with transition (actually 11s from buildPage2Args -t 11)
  // page3: starts at 13.57s with transition (actually 21s from buildPage3Args -t 21)
  // page4: starts at 30.57s with transition (actually 10s from buildPage4Args -t 10)

  const offset1 = 6.2;   // page1 -> page2 transition start
  const offset2 = 13.57; // page2 -> page3 transition start
  const offset3 = 30.57; // page3 -> page4 transition start

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
    "-preset", "ultrafast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-y",
    outPath
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

  const segmentPaths: string[] = [];

  // Generate 4 segments with different transitions
  for (let i = 0; i < 4; i++) {
    const segmentPath = path.join(segmentsDir, `segment${i + 1}.mp4`);
    segmentPaths.push(segmentPath);

    console.log(`[Assemble Job ${jobId}] Generating segment ${i + 1}/4...`);

    const ffmpegArgs = buildAssembleSegmentArgs({
      page1: path.join(job.extractDir, page1),
      page2: path.join(job.extractDir, page2),
      page3: path.join(job.extractDir, page3),
      page4: path.join(job.extractDir, page4),
      outPath: segmentPath,
      transitions: transitionSets[i]
    });

    await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

    if (!fs.existsSync(segmentPath)) {
      throw new Error(`Segment ${i + 1} was not created`);
    }

    job.progress = 20 + ((i + 1) * 15); // 20, 35, 50, 65
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  }

  console.log(`[Assemble Job ${jobId}] All segments generated, concatenating...`);

  // Create concat file
  const concatPath = path.join(jobDir, "concat.txt");
  const concatContent = segmentPaths
    .map(p => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n');

  fs.writeFileSync(concatPath, concatContent, 'utf-8');

  job.progress = 70;
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

  // Concatenate segments
  const finalOut = path.join(jobDir, "final_assembled.mp4");

  const concatArgs = [
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-c", "copy",
    "-y",
    finalOut
  ];

  console.log(`[Assemble Job ${jobId}] Concatenating segments...`);

  await runCmd("ffmpeg", concatArgs, {}, MAX_PROCESSING_TIME);

  console.log(`[Assemble Job ${jobId}] Concatenation completed`);

  if (!fs.existsSync(finalOut)) {
    throw new Error("Final output file was not created");
  }

  const stats = fs.statSync(finalOut);
  if (stats.size < 1000) {
    throw new Error("Final output file is too small (likely corrupt)");
  }

  job.status = "done";
  job.result = finalOut;
  job.progress = 100;
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

  console.log(`[Assemble Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

// ====================== UPDATED UNIFIED WORKER LOOP ======================
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
        } else {
          // Default merge job
          await processMergeJob(jobId, jobDir, jobFile, job as JobData);
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



// async function unifiedWorkerLoop() {
//   try {
//     const jobIds = fs.existsSync(JOBS_DIR) ? fs.readdirSync(JOBS_DIR) : [];

//     for (const jobId of jobIds) {
//       const jobDir = path.join(JOBS_DIR, jobId);
//       const jobFile = path.join(jobDir, "job.json");

//       if (!fs.existsSync(jobFile)) continue;

//       let job: JobData | Page1JobData | Page2JobData | Page3JobData | Page4JobData;
//       try {
//         job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));
//       } catch (err) {
//         console.error("Failed to read job file:", jobFile, err);
//         continue;
//       }

//       if (job.status !== "pending") continue;

//       // Mark as processing
//       job.status = "processing";
//       job.progress = 0;
//       fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

//       try {
//         // Determine job type and process accordingly
//         if (jobId.startsWith('page1_')) {
//           await processPage1Job(jobId, jobDir, jobFile, job as Page1JobData);
//         } else if (jobId.startsWith('page2_')) {
//           await processPage2Job(jobId, jobDir, jobFile, job as Page2JobData);
//         } else if (jobId.startsWith('page3_')) {
//           await processPage3Job(jobId, jobDir, jobFile, job as Page3JobData);
//         } else if (jobId.startsWith('page4_')) {
//           await processPage4Job(jobId, jobDir, jobFile, job as Page4JobData);
//         } else {
//           // Default merge job
//           await processMergeJob(jobId, jobDir, jobFile, job as JobData);
//         }
//       } catch (err) {
//         console.error(`[Job ${jobId}] ERROR:`, err);
//         job.status = "error";
//         job.error = String(err);
//         job.progress = 0;
//         fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
//       }
//     }
//   } catch (err) {
//     console.error("Worker loop unexpected error:", err);
//   } finally {
//     // Always continue loop after delay
//     setTimeout(unifiedWorkerLoop, 2000);
//   }
// }

// ====================== JOB PROCESSORS ======================

async function processMergeJob(jobId: string, jobDir: string, jobFile: string, job: JobData) {
  console.log(`[Merge Job ${jobId}] Starting processing...`);

  // Extract ZIP
  await fs.createReadStream(job.inputZip)
    .pipe(unzipper.Extract({ path: job.extractDir }))
    .promise();

  job.progress = 20;
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

  // Get video files
  const extractedFiles = fs.readdirSync(job.extractDir)
    .map(f => path.join(job.extractDir, f))
    .filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f))
    .sort();

  if (extractedFiles.length < 2) {
    throw new Error("ZIP must contain at least 2 videos");
  }

  console.log(`[Merge Job ${jobId}] Found ${extractedFiles.length} videos`);

  const inputCount = Math.min(extractedFiles.length, 4);
  const finalOut = path.join(jobDir, "result.mp4");

  // Build filters
  const layout = buildLayoutFilter(inputCount);
  const audioFilter = buildAudioFilter(inputCount);
  const filterComplex = `${layout.filter};${audioFilter}`;

  const ffmpegArgs = [
    ...extractedFiles.slice(0, inputCount).flatMap(f => ["-i", f]),
    "-filter_complex", filterComplex,
    "-map", `[${layout.outputs[0]}]`,
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-tune", "fastdecode",
    "-threads", "0",
    "-c:a", "aac",
    "-b:a", "96k",
    "-ac", "1",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", "300",
    "-shortest",
    "-y",
    finalOut,
  ];

  job.progress = 30;
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

  await runCmd("ffmpeg", ffmpegArgs, {}, MAX_PROCESSING_TIME);

  console.log(`[Merge Job ${jobId}] FFmpeg completed`);

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

  console.log(`[Merge Job ${jobId}] COMPLETED - ${stats.size} bytes`);
}

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

// ====================== START SINGLE WORKER ======================
console.log("Starting unified worker loop...");
unifiedWorkerLoop();




app.get('/health', (req: Request, res: Response): void => {
  res.json({ ok: true, endpoints: ['/host', '/guest', '/merge', '/clip'] });
});

app.listen(PORT, () => {
  console.log(`FFmpeg service listening on ${PORT}`);
});