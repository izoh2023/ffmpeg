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

| Variable    | Default      | Description                          |
| ----------- | ------------ | ------------------------------------ |
| `PORT`      | `9000`       | HTTP port                            |
| `JOBS_DIR`  | `/tmp/jobs`  | Jobs / working directory             |

Copy `.env.example` to `.env` for local reference. `.env` is gitignored — never
commit secrets.

## HTTP endpoints (mounted in `opus.ts`)

| Mount path         | Purpose                          |
| ------------------ | -------------------------------- |
| `/upload-video`    | Upload a source video            |
| `/full_interview`  | Full interview processing        |
| `/process-video`   | Vertical/horizontal stacking     |
| `/overlay-video`   | Overlays                         |
| `/subtitle-video`  | Subtitles                        |
| `/clip-video`      | Clip extraction                  |
| `/render-trailer`  | Remotion trailer render          |
| `/swap-logo`       | Logo detection + swap            |
| `/remove`          | Cleanup                          |
| `/health`          | Health check                     |
| `/static`          | Serves files from `JOBS_DIR`     |
