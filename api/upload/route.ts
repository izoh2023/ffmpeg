import { Router } from "express";
import { JOBS_DIR, upload } from "../../utils/configs";
import { v4 as uuidv4 } from 'uuid';
import fs from "node:fs";
import path from "node:path";
import axios from "axios";

const uploadRoute = Router()

uploadRoute.post("/", upload.single("file"), async (req, res) => {
    try {
        console.log("===== /upload-video called =====");

        const { driveUrl } = req.body;

        // --- Path A: Drive URL ---
        if (!req.file && driveUrl) {
            const fileId = extractDriveFileId(driveUrl);
            if (!fileId) {
                res.status(400).json({ error: "Could not extract file ID from driveUrl" });
                return;
            }

            const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
            const filename = `upload_${Date.now()}_${uuidv4()}.mp4`;
            const destPath = path.join(JOBS_DIR, filename);

            console.log(`[upload] Streaming Drive file ${fileId} -> ${destPath}`);
            await streamToDisk(downloadUrl, destPath, fileId);
            console.log(`[upload] Stream complete: ${destPath}`);

            res.json({ success: true, videoPath: destPath, filename });
            return;
        }

        // --- Path B: Multipart file ---
        if (req.file) {
            const ext = path.extname(req.file.originalname) || '.mp4';
            const filename = `upload_${Date.now()}_${uuidv4()}${ext}`;
            const destPath = path.join(JOBS_DIR, filename);

            fs.renameSync(req.file.path, destPath);

            res.json({ success: true, videoPath: destPath, filename });
            return;
        }

        // --- Neither provided ---
        res.status(400).json({ error: "Provide either a file upload or a driveUrl in the request body" });

    } catch (err) {
        console.error("ERR /upload-video:", err);
        res.status(500).json({ error: "Internal Error", details: String(err) });
    }
});

// --- Helpers ---

function extractDriveFileId(url: string): string | null {
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /[?&]id=([a-zA-Z0-9_-]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function streamToString(stream: any): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', reject);
    });
}

function pipeToFile(response: any, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

async function streamToDisk(url: string, destPath: string, fileId: string): Promise<void> {
    const initial = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        timeout: 30 * 60 * 1000,
    });

    const contentType = String(initial.headers['content-type'] ?? '');

    if (!contentType.includes('text/html')) {
        await pipeToFile(initial, destPath);
        return;
    }

    console.log(`[upload] Got HTML interstitial, extracting confirm token...`);

    const cookies = initial.headers['set-cookie'] ?? [];
    const cookieString = Array.isArray(cookies)
        ? cookies.map((c: string) => c.split(';')[0]).join('; ')
        : '';

    const html = await streamToString(initial.data);

    // Match form input values directly
    const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
    const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);

    if (!confirmMatch) {
        console.log(`[upload] HTML snippet:`, html.substring(0, 1000));
        throw new Error(
            'Could not extract confirm token from Drive response. ' +
            'Ensure the file is shared as "Anyone with the link".'
        );
    }

    const confirmToken = confirmMatch[1];
    const uuid = uuidMatch?.[1];

    console.log(`[upload] confirm=${confirmToken} uuid=${uuid}`);

    const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmToken}${uuid ? `&uuid=${uuid}` : ''}`;

    console.log(`[upload] Confirm URL: ${confirmUrl}`);

    const confirmed = await axios({
        method: 'GET',
        url: confirmUrl,
        responseType: 'stream',
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Cookie': cookieString,
        },
        timeout: 30 * 60 * 1000,
    });

    const confirmedContentType = String(confirmed.headers['content-type'] ?? '');
    if (confirmedContentType.includes('text/html')) {
        const errorHtml = await streamToString(confirmed.data);
        console.log(`[upload] Still got HTML after confirm. Snippet:`, errorHtml.substring(0, 500));
        throw new Error('Drive still returned HTML after confirm attempt.');
    }

    await pipeToFile(confirmed, destPath);
}

export default uploadRoute;