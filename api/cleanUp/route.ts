import { Router } from "express";
import { JOBS_DIR } from "../../utils/configs";
import fs from "node:fs";
import path from "node:path";

const cleanup = Router();

// Delete a job by jobId
cleanup.delete("/job/:jobId", (req, res) => {
    const { jobId } = req.params;
    const jobDir = path.join(JOBS_DIR, jobId);
    const jobFile = path.join(jobDir, "job.json");

    if (!fs.existsSync(jobFile)) return res.status(404).json({ error: "Job not found" });

    try {
        const job = JSON.parse(fs.readFileSync(jobFile, "utf-8"));

        if (job.status !== "done" && job.status !== "error") {
            return res.status(400).json({ error: "Job is still processing, cannot delete" });
        }

        const preserveErrors = req.query.preserveErrors === "true";
        if (preserveErrors && job.status === "error") {
            for (const entry of fs.readdirSync(jobDir)) {
                if (entry !== "job.json") {
                    fs.rmSync(path.join(jobDir, entry), { recursive: true, force: true });
                }
            }
            console.log(`[Cleanup] Preserved error metadata for job ${jobId}`);
            return res.json({ success: true, jobId, preserved: "job.json", message: "Error metadata preserved" });
        }

        fs.rmSync(jobDir, { recursive: true, force: true });
        console.log(`[Cleanup] Removed job ${jobId}`);
        return res.json({ success: true, jobId, message: "Job deleted successfully" });
    } catch (err) {
        console.error(`[Cleanup] Error removing job ${jobId}:`, err);
        return res.status(500).json({ error: "Failed to delete job", details: String(err) });
    }
});

// Delete a list of files by filename or full path
cleanup.delete("/files", (req, res) => {
    const files: { filename?: string; videoPath?: string }[] = req.body;

    if (!Array.isArray(files) || !files.length) {
        return res.status(400).json({ error: "Expected a non-empty array of files" });
    }

    const results = files.map(({ filename, videoPath }) => {
        const filePath = videoPath ?? (filename ? path.join(JOBS_DIR, filename) : null);

        if (!filePath) return { filename, success: false, error: "No path provided" };

        // Prevent path traversal — resolved path must stay inside JOBS_DIR
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(JOBS_DIR) + path.sep)) {
            console.warn(`[Cleanup] Blocked path traversal attempt: ${filePath}`);
            return { filePath, success: false, error: "Path outside JOBS_DIR is not allowed" };
        }

        try {
            if (!fs.existsSync(resolved)) return { filePath: resolved, success: false, error: "File not found" };
            fs.rmSync(resolved, { force: true });
            console.log(`[Cleanup] Removed file ${resolved}`);
            return { filePath: resolved, success: true };
        } catch (err) {
            console.error(`[Cleanup] Error removing file ${resolved}:`, err);
            return { filePath: resolved, success: false, error: String(err) };
        }
    });

    return res.json({ results });
});

export default cleanup;
