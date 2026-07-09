import express from "express";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { renderTrailer } from "../../remotion/render";

const router = express.Router();

const JOBS_DIR     = process.env.JOBS_DIR  ?? "/tmp/jobs";
const EXPRESS_PORT = process.env.PORT      ?? "9000";
const STATIC_BASE  = `http://localhost:${EXPRESS_PORT}/static`;

fs.mkdirSync(JOBS_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClipFile {
  fileName: string;
}

interface RenderRequest {
  clips: {
    jobId: string;
    files: ClipFile[];
  };
  guest: {
    name: string;
    title: string;
    company: string;
    photoPath: string;
    linkedIn: string;
  };
  episode: {
    title: string;
    number: string;
    pullQuote: string;
    pullQuoteAttribution: string;
    pullQuoteHighlights: string[];
  };
  branding: { primaryColor: string; logoPath: string; showName: string; musicPath?: string };
}

interface RenderJob {
  id: string;
  status: "pending" | "rendering" | "done" | "error";
  progress: number;
  outputFile?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeJob(jobId: string, job: RenderJob) {
  const dir = path.join(JOBS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job, null, 2));
}

function readJob(jobId: string): RenderJob | null {
  const f = path.join(JOBS_DIR, jobId, "job.json");
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf-8"));
}

function getVideoDuration(filePath: string): number {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8" }
    ).trim();
    const duration = parseFloat(output);
    if (isNaN(duration) || duration <= 0) throw new Error(`Invalid duration: ${output}`);
    return duration;
  } catch (err) {
    throw new Error(`ffprobe failed for ${filePath}: ${err}`);
  }
}

// ─── Background worker ────────────────────────────────────────────────────────

async function runRenderJob(jobId: string, request: RenderRequest) {
  const job: RenderJob = { id: jobId, status: "rendering", progress: 0 };
  writeJob(jobId, job);

  try {
    const { clips: clipsPayload, guest, episode, branding } = request;

    const clips = clipsPayload.files.map((f) => {
      const absolutePath = path.join(JOBS_DIR, clipsPayload.jobId, "clips", f.fileName);

      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Clip not found: ${absolutePath}`);
      }

      const duration = getVideoDuration(absolutePath);
      console.log(`[${jobId}] ${f.fileName} → ${duration.toFixed(2)}s`);

      return {
        videoPath: `${STATIC_BASE}/${clipsPayload.jobId}/clips/${encodeURIComponent(f.fileName)}`,
        title: f.fileName.replace(/_/g, " ").replace(/\.mp4$/i, ""),
        duration,
      };
    });

    console.log(`[${jobId}] Resolved ${clips.length} clips via ${STATIC_BASE}/${clipsPayload.jobId}/clips/`);

    const outputFile = path.join(JOBS_DIR, jobId, `${jobId}.mp4`);

    await renderTrailer(
  {
    clips,
    guest,
    episode,
    branding,
    motion: { energy: 'hype', colorGrade: 'warm' },
    musicPath: branding.musicPath ?? "",
  },
  outputFile,
  (progress) => {
    job.progress = progress;
    writeJob(jobId, job);
  }
);

    job.status = "done";
    job.progress = 100;
    job.outputFile = outputFile;
    writeJob(jobId, job);
    console.log(`[${jobId}] Done → ${outputFile}`);
  } catch (err) {
    console.error(`[${jobId}] Error:`, err);
    job.status = "error";
    job.error = String(err);
    writeJob(jobId, job);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post("/", (req, res) => {
  const body = req.body as RenderRequest;

  if (!body?.clips?.files?.length)      return res.status(400).json({ error: "clips.files is required" });
  if (!body.guest?.name)                return res.status(400).json({ error: "guest.name is required" });
  if (!body.episode?.title)             return res.status(400).json({ error: "episode.title is required" });
  if (!body.episode?.pullQuote)         return res.status(400).json({ error: "episode.pullQuote is required" });
  if (!body.branding?.showName)         return res.status(400).json({ error: "branding.showName is required" });

  const jobId = `render_${Date.now()}_${uuidv4()}`;
  runRenderJob(jobId, body);

  return res.json({
    jobId,
    status: "pending",
    status_url:   `/render-trailer/status/${jobId}`,
    download_url: `/render-trailer/download/${jobId}`,
  });
});

router.get("/status/:jobId", (req, res) => {
  const job = readJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  return res.json({
    jobId:    job.id,
    status:   job.status,
    progress: job.progress,
    ...(job.status === "done" && { download_url: `/render-trailer/download/${job.id}` }),
    ...(job.error             && { error: job.error }),
  });
});

router.get("/download/:jobId", (req, res) => {
  const job = readJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  if (job.status !== "done") {
    return res.status(400).json({ error: "Not finished", status: job.status, progress: job.progress });
  }
  if (!job.outputFile || !fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: "Output file not found" });
  }

  return res.download(job.outputFile, `trailer_${req.params.jobId}.mp4`);
});

export default router;