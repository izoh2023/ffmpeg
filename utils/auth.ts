import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// Shared-bearer-token auth for service-to-service calls.
//
// Another app (a trusted backend we control) calls these automations with
//   Authorization: Bearer <RENDER_API_TOKEN>
// and this service verifies the header against the RENDER_API_TOKEN secret.
//
// Only *unsafe* HTTP methods are protected. Safe methods (GET/HEAD/OPTIONS) are
// left open on purpose:
//   - GET /status, /download, /files, /file and the /static mount are gated by
//     the unguessable job UUID that an authenticated POST returns. You can only
//     reach a download URL after passing through an authenticated request, so
//     the UUID acts as a capability.
//   - GET /health must stay open for Render's health checks.
//   - OPTIONS must stay open so CORS preflight requests are not blocked.
const OPEN_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Constant-time comparison that does not leak the token length. Both sides are
// hashed to a fixed 32 bytes first, so timingSafeEqual always receives
// equal-length buffers and the comparison time is independent of the input.
function safeEqual(a: string, b: string): boolean {
    const ah = crypto.createHash("sha256").update(a).digest();
    const bh = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(ah, bh);
}

export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
    if (OPEN_METHODS.has(req.method)) {
        next();
        return;
    }

    const expected = process.env.RENDER_API_TOKEN;

    // Fail closed: a missing/empty secret must never silently disable auth.
    // This is a server misconfiguration, not a client error, so report 503.
    if (!expected) {
        console.error("[auth] RENDER_API_TOKEN is not set; rejecting protected request");
        res.status(503).json({ error: "Server auth not configured" });
        return;
    }

    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const provided = match?.[1]?.trim();

    if (!provided || !safeEqual(provided, expected)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    next();
}
