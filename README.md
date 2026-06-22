# ffmpeg — Trailer Generation Service

> **Note:** despite the repo name, this is **not** the FFmpeg project. It is a
> Node.js/TypeScript HTTP microservice that *uses* FFmpeg (plus
> [Remotion](https://www.remotion.dev/) and OpenCV) to automatically produce
> branded podcast/interview trailer videos.

## What it does

The service accepts uploaded video clips and turns them into polished, branded
trailers. The pipeline covers:

- **Upload / ingest** of source videos
- **Logo swap** — OpenCV (`detect_logo.py`) detects an existing logo, FFmpeg
  `delogo` removes it, and a new logo is composited in
- **Face centering** (`face_center.py`) and **split detection**
  (`detect_split.py`) for reframing side-by-side footage
- **Stacking, overlays and subtitles** (lower-thirds, ASS subtitles)
- **Clip extraction** from a transcript
- **Remotion render** — a React-based compositor renders an MP4 trailer
  (intro / guest card / clip segments / outro) via headless Chrome
- **Assemble + music** to produce the final trailer

Jobs are tracked as `job.json` files inside `JOBS_DIR`; a polling worker loop in
`opus.ts` picks up `pending` jobs and runs the matching processor.

## Architecture

- **Entry point:** `opus.ts` — boots Express, mounts the routers under `api/`,
  and runs the worker loop. This is the only server entry point.
- **`api/*/route.ts`** — one Express router per concern (upload, clips, overlay,
  subtitle, v_stack, logo_swap, interview, renderTrailer, cleanUp).
- **`utils/`** — shared config (`configs.ts`), command runner (`runCmd.ts`),
  cleanup and image helpers.
- **`remotion/`** — the React/Remotion composition rendered at runtime.
- **`*.py`** — OpenCV helpers invoked as subprocesses.

## Running

### Docker (recommended)

```bash
docker compose up --build
```

The service listens on port **9000**. Health check: `GET /health`.

### Local development

```bash
npm install
npm run dev      # ts-node + nodemon, watches opus.ts / api / utils / remotion
```

Build and run the compiled output:

```bash
npm run build    # tsc -> dist/
npm start        # node dist/opus.js
```

### Remotion

```bash
npm run remotion:studio    # open the Remotion studio
npm run remotion:render    # render the Trailer composition to out/trailer.mp4
```

## Configuration

| Variable           | Default      | Description                                                  |
| ------------------ | ------------ | ------------------------------------------------------------ |
| `PORT`             | `9000`       | HTTP port                                                    |
| `JOBS_DIR`         | `/tmp/jobs`  | Jobs / working directory                                     |
| `RENDER_API_TOKEN` | _(required)_ | Shared bearer token for service-to-service auth (see below)  |

Copy `.env.example` to `.env` for local reference. `.env` is gitignored — never
commit secrets.

## Authentication

Calls from other apps are authenticated with a **shared bearer token**. Set the
`RENDER_API_TOKEN` secret on this service (Render dashboard → Environment), and
have the calling app send it on every state-changing request:

```
Authorization: Bearer <RENDER_API_TOKEN>
```

Generate a strong value once, e.g. `openssl rand -hex 32`, and store the same
value on both sides.

What is protected (enforced by a single middleware in `utils/auth.ts`, wired in
`opus.ts`):

- **Protected:** all state-changing requests — `POST` (start a job),
  `PUT`/`PATCH`, and the `DELETE` cleanup endpoints. Missing/invalid token →
  `401 Unauthorized`. If `RENDER_API_TOKEN` is not configured on the server,
  protected requests get `503` (fail-closed — auth is never silently disabled).
- **Open:** safe `GET`/`HEAD` reads (`/status/:jobId`, `/download/:jobId`,
  `/files`, `/file`, and the `/static` mount) and `/health`. These reads are
  gated by the **unguessable job UUID** returned from the authenticated `POST`,
  so a download URL is only reachable after a request that already passed auth.
  `OPTIONS` is also open so CORS preflight is not blocked.

Always call over HTTPS so the token is never sent in the clear.

## HTTP endpoints (mounted in `opus.ts`)

| Mount path         | Purpose                          | Auth (POST/DELETE) |
| ------------------ | -------------------------------- | ------------------ |
| `/upload-video`    | Upload a source video            | 🔒 Bearer token    |
| `/full_interview`  | Full interview processing        | 🔒 Bearer token    |
| `/process-video`   | Vertical/horizontal stacking     | 🔒 Bearer token    |
| `/overlay-video`   | Overlays                         | 🔒 Bearer token    |
| `/subtitle-video`  | Subtitles                        | 🔒 Bearer token    |
| `/clip-video`      | Clip extraction                  | 🔒 Bearer token    |
| `/render-trailer`  | Remotion trailer render          | 🔒 Bearer token    |
| `/swap-logo`       | Logo detection + swap            | 🔒 Bearer token    |
| `/remove`          | Cleanup (DELETE)                 | 🔒 Bearer token    |
| `/health`          | Health check                     | Public             |
| `/static`          | Serves files from `JOBS_DIR`     | Public (GET)       |

> 🔒 = state-changing methods require `Authorization: Bearer <RENDER_API_TOKEN>`.
> The `GET` status/download reads on these same routers are open (gated by the
> job UUID). See [Authentication](#authentication).
