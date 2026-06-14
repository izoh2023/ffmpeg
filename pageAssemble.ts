import { spawn } from "child_process";
import { writeFileSync } from "fs";
import sharp from "sharp";

interface AssembleJobData {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  inputZip: string;
  extractDir: string;
  result?: string;
  error?: string;
  progress?: number;
}

// ====================== ASSEMBLE BUILDER ======================
function buildAssembleSegmentArgs({
  page1,
  page2,
  page3,
  page4,
  outPath,
  transitions
}: {
  page1: string;
  page2: string;
  page3: string;
  page4: string;
  outPath: string;
  transitions: { type: string; duration: number }[];
}) {
  // Proper offset calculations to ensure all pages show completely:
  // page1: 7.4s duration
  // page2: 8.47s duration
  // page3: 18.2s duration
  // page4: 7.4s duration
  
  // Offsets account for overlap during transitions
  const offset1 = 6.2;   // page1 -> page2 transition (before page1 ends)
  const offset2 = 13.57; // page2 -> page3 transition
  const offset3 = 30.57; // page3 -> page4 transition

  const t1 = transitions[0];
  const t2 = transitions[1];
  const t3 = transitions[2];

  return [
    "-i", page1,
    "-i", page2,
    "-i", page3,
    "-i", page4,

    "-filter_complex",
    `[0:v][1:v]xfade=transition=${t1.type}:duration=${t1.duration}:offset=${offset1}[v1];` +
    `[v1][2:v]xfade=transition=${t2.type}:duration=${t2.duration}:offset=${offset2}[v2];` +
    `[v2][3:v]xfade=transition=${t3.type}:duration=${t3.duration}:offset=${offset3}[vout]`,

    "-map", "[vout]",
    "-an", // No audio for segments
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-y",
    outPath
  ];
}

// ====================== BUILD MULTIPLE SEGMENTS ======================
function buildMultipleSegments({
  page1,
  page2,
  page3,
  page4,
  segmentCount = 4,
  outputDir
}: {
  page1: string;
  page2: string;
  page3: string;
  page4: string;
  segmentCount?: number;
  outputDir: string;
}) {
  const segments = [];
  
  // Different transition combinations for variety while keeping it subtle
  const transitionSets = [
    [
      { type: "fade", duration: 1.2 },
      { type: "dissolve", duration: 1.5 },
      { type: "fade", duration: 1.2 }
    ],
    [
      { type: "dissolve", duration: 1.5 },
      { type: "fade", duration: 1.2 },
      { type: "dissolve", duration: 1.5 }
    ],
    [
      { type: "fade", duration: 1.2 },
      { type: "dissolve", duration: 1.5 },
      { type: "fade", duration: 1.2 }
    ],
    [
      { type: "dissolve", duration: 1.5 },
      { type: "fade", duration: 1.2 },
      { type: "dissolve", duration: 1.5 }
    ]
  ];

  for (let i = 0; i < segmentCount; i++) {
    segments.push({
      outPath: `${outputDir}/segment${i + 1}.mp4`,
      args: buildAssembleSegmentArgs({
        page1,
        page2,
        page3,
        page4,
        outPath: `${outputDir}/segment${i + 1}.mp4`,
        transitions: transitionSets[i % transitionSets.length]
      })
    });
  }

  return segments;
}

// ====================== CONCAT SEGMENTS ======================
function buildConcatArgs(segmentPaths: string[], outputPath: string, concatFilePath: string) {
  return [
    "-f", "concat",
    "-safe", "0",
    "-i", concatFilePath,
    "-c", "copy",
    "-y",
    outputPath
  ];
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
  const outputDir = "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/Santo George";
  
  // Build 4 segments
  const segments = buildMultipleSegments({
    page1: `${outputDir}/page1_result.mp4`,
    page2: `${outputDir}/page2_result.mp4`,
    page3: `${outputDir}/page3_result.mp4`,
    page4: `${outputDir}/page4_result.mp4`,
    segmentCount: 4,
    outputDir
  });

  console.log("Creating segments...");
  
  // Create all segments sequentially
  for (let i = 0; i < segments.length; i++) {
    console.log(`\nCreating segment ${i + 1}/${segments.length}...`);
    await runFFmpeg(segments[i].args);
  }

  console.log("\nAll segments created. Concatenating...");

  // Create concat file using ES modules import
  const concatFilePath = `${outputDir}/concat.txt`;
  const concatContent = segments
    .map(s => `file '${s.outPath}'`)
    .join("\n");
  
  writeFileSync(concatFilePath, concatContent, "utf8");

  // Concatenate segments
  const finalPath = `${outputDir}/final.mp4`;
  const concatArgs = buildConcatArgs(
    segments.map(s => s.outPath),
    finalPath,
    concatFilePath
  );

  await runFFmpeg(concatArgs);

  console.log(`\n✅ Final video created: ${finalPath}`);
}

run().catch(console.error);