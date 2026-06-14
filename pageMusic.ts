import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";

const execPromise = promisify(exec);

// ====================== GET DURATIONS ======================
async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execPromise(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return parseFloat(stdout.trim());
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execPromise(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return parseFloat(stdout.trim());
}

// ====================== ADD AUDIO WITH LOOPING ======================
function buildAddAudioArgs({
  videoPath,
  audioPath,
  outputPath,
  videoDuration,
  audioDuration,
  fadeOutDuration = 3.0 // 3 second fade out
}: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  videoDuration: number;
  audioDuration: number;
  fadeOutDuration?: number;
}) {
  const fadeStartTime = videoDuration - fadeOutDuration;
  
  // If audio is shorter than video, we need to loop it
  if (audioDuration < videoDuration) {
    // Calculate how many times to loop
    const loopCount = Math.ceil(videoDuration / audioDuration);
    
    return [
      "-i", videoPath,
      "-stream_loop", String(loopCount - 1), // -1 because first play doesn't count as loop
      "-i", audioPath,
      
      "-filter_complex",
      `[1:a]atrim=0:${videoDuration},afade=t=out:st=${fadeStartTime}:d=${fadeOutDuration}[audio]`,
      
      "-map", "0:v",
      "-map", "[audio]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest", // Cut when video ends
      "-y",
      outputPath
    ];
  } else {
    // Audio is longer than or equal to video - just trim and fade
    return [
      "-i", videoPath,
      "-i", audioPath,
      
      "-filter_complex",
      `[1:a]atrim=0:${videoDuration},afade=t=out:st=${fadeStartTime}:d=${fadeOutDuration}[audio]`,
      
      "-map", "0:v",
      "-map", "[audio]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-y",
      outputPath
    ];
  }
}

// ====================== PROMISE WRAPPER FOR FFMPEG ======================
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("Running: ffmpeg", args.join(" "));
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
    
    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/* =========================
   RUNNER
========================= */
async function run() {
  const videoPath = "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/Santo George/final.mp4";
  const audioPath = "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/Santo George/Santo George.mp3";
  const outputPath = "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/Santo George/final_with_audio.mp4";

  console.log("Getting video duration...");
  const videoDuration = await getVideoDuration(videoPath);
  console.log(`Video duration: ${videoDuration.toFixed(2)}s`);

  console.log("Getting audio duration...");
  const audioDuration = await getAudioDuration(audioPath);
  console.log(`Audio duration: ${audioDuration.toFixed(2)}s`);

  if (audioDuration < videoDuration) {
    console.log(`\nAudio is shorter than video. Will loop audio to match video length.`);
  } else {
    console.log(`\nAudio is longer than or equal to video. Will trim audio to video length.`);
  }

  console.log("\nAdding audio to video with fade out...");
  
  const args = buildAddAudioArgs({
    videoPath,
    audioPath,
    outputPath,
    videoDuration,
    audioDuration,
    fadeOutDuration: 3.0 // 3 second fade
  });

  await runFFmpeg(args);

  console.log(`\n✅ Video with audio created: ${outputPath}`);
  console.log(`   - Audio loops: ${audioDuration < videoDuration ? 'YES' : 'NO'}`);
  console.log(`   - Fade out: 3 seconds at the end`);
}

run().catch(console.error);