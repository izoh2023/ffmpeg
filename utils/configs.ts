import multer from 'multer';
import path from "node:path";

export const JOBS_DIR = path.join("/home/isaac", "jobs");
export const upload = multer({ dest: JOBS_DIR });

export const MAX_PROCESSING_TIME = 6000000; // 3 minutes max
export const STALL_TIMEOUT = 60000; // 45 seconds without progress = stall