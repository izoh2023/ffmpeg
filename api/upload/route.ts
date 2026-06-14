import { Router } from "express";
import { JOBS_DIR, upload } from "../../utils/configs";
import { v4 as uuidv4 } from 'uuid';
import fs from "node:fs";
import path from "node:path";

const uploadRoute = Router()

uploadRoute.post("/", upload.single("file"), async (req, res) => {
    try {
        console.log("===== /upload-video called =====");

        if (!req.file) {
            res.status(400).json({ error: "No file uploaded" });
            return;
        }

        const ext = path.extname(req.file.originalname) || '.mp4';
        const filename = `upload_${Date.now()}_${uuidv4()}${ext}`;
        const destPath = path.join(JOBS_DIR, filename);

        fs.renameSync(req.file.path, destPath);

        res.json({
            success: true,
            videoPath: destPath,
            filename,
        });

    } catch (err) {
        console.error("ERR /upload-video:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

export default uploadRoute