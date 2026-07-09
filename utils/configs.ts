import multer from 'multer';

// Single source of truth for the jobs/working directory.
// Overridable via JOBS_DIR; defaults to /tmp/jobs (matches the Docker image
// and the /static mount in opus.ts).
export const JOBS_DIR = process.env.JOBS_DIR || "/tmp/jobs";
export const upload = multer({ dest: JOBS_DIR });

export const MAX_PROCESSING_TIME = 6000000; // 100 minutes max per command
export const STALL_TIMEOUT = 60000;         // 60s without progress = stalled
