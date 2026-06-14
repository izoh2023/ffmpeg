import { spawn } from "child_process";
import sharp from "sharp";
import fs from "fs/promises";

function ffText(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}


// async function generateRadialPlate({
//   tools,
//   size = 1100,
//   holeRadius = 180,
//   toolSize = 210,
//   radius = 450,
//   strokes = ["#ffffff", "#00e5ff", "#ff8a00", "#7cff00", "#ff3d81", "#8c7bff"]
// }: {
//   tools: string[];
//   size?: number;
//   holeRadius?: number;
//   toolSize?: number;
//   radius?: number;
//   strokes?: string[];
// }) {
//   const cx = size / 2;
//   const cy = size / 2;

//   const toolImages = await Promise.all(
//     tools.map(async p => (await fs.readFile(p)).toString("base64"))
//   );

//   const step = (2 * Math.PI) / tools.length;

//   const points = tools.map((_, i) => {
//     const a = -Math.PI / 2 + i * step;
//     return {
//       x: cx + radius * Math.cos(a),
//       y: cy + radius * Math.sin(a)
//     };
//   });

//   const connectors = points.map((p, i) => {
//     const vx = p.x - cx;
//     const vy = p.y - cy;
//     const len = Math.sqrt(vx * vx + vy * vy);

//     const ex = cx + (vx / len) * (holeRadius + 10);
//     const ey = cy + (vy / len) * (holeRadius + 10);

//     const mx = (p.x + ex) / 2;
//     const my = (p.y + ey) / 2 - radius * 0.18;

//     const stroke = strokes[i % strokes.length];

//     return `
//       <path d="M ${p.x} ${p.y} Q ${mx} ${my} ${ex} ${ey}"
//         fill="none"
//         stroke="${stroke}"
//         stroke-width="2.8"
//         stroke-dasharray="6,6"
//         opacity="0.9"
//         stroke-linecap="round"
//         marker-end="url(#arrow-${i})"/>
//     `;
//   });

//   const svg = `
// <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
// <defs>
//   <mask id="hole">
//     <rect width="100%" height="100%" fill="white"/>
//     <circle cx="${cx}" cy="${cy}" r="${holeRadius}" fill="black"/>
//   </mask>

//   ${strokes.map((c, i) => `
//     <marker id="arrow-${i}"
//       markerWidth="10"
//       markerHeight="10"
//       refX="9"
//       refY="5"
//       orient="auto">
//       <path d="M0,0 L10,5 L0,10 z" fill="${c}" opacity="0.9"/>
//     </marker>
//   `).join("")}
// </defs>

// <!-- CONNECTORS OUTSIDE MASK (IMPORTANT) -->
// ${connectors.join("")}

// <!-- TOOLS INSIDE MASK -->
// <g mask="url(#hole)">
//   ${toolImages.map((img, i) => `
//     <image href="data:image/png;base64,${img}"
//       x="${points[i].x - toolSize / 2}"
//       y="${points[i].y - toolSize / 2}"
//       width="${toolSize}"
//       height="${toolSize}"/>
//   `).join("")}
// </g>
// </svg>
// `;

//   const out = `/tmp/page2_plate_${Date.now()}.png`;
//   await sharp(Buffer.from(svg)).png().toFile(out);
//   return out;
// }

async function generateRadialPlate({
  tools,
  size = 1100,
  holeRadius = 180,
  toolSize = 210,
  radius = 450,
  strokes = ["#ffffff", "#00e5ff", "#ff8a00", "#7cff00", "#ff3d81", "#8c7bff"]
}: {
  tools: string[];
  size?: number;
  holeRadius?: number;
  toolSize?: number;
  radius?: number;
  strokes?: string[];
}) {
  const cx = size / 2;
  const cy = size / 2;

  const toolImages = await Promise.all(
    tools.map(async p => (await fs.readFile(p)).toString("base64"))
  );

  const step = (2 * Math.PI) / tools.length;

  const points = tools.map((_, i) => {
    const a = -Math.PI / 2 + i * step;
    return {
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a)
    };
  });

  const connectors = points.map((p, i) => {
    const vx = p.x - cx;
    const vy = p.y - cy;
    const len = Math.sqrt(vx * vx + vy * vy);

    const ex = cx + (vx / len) * (holeRadius + 10);
    const ey = cy + (vy / len) * (holeRadius + 10);

    const mx = (p.x + ex) / 2;
    const my = (p.y + ey) / 2 - radius * 0.18;

    const stroke = strokes[i % strokes.length];

    return `
      <path d="M ${p.x} ${p.y} Q ${mx} ${my} ${ex} ${ey}"
        fill="none"
        stroke="${stroke}"
        stroke-width="2.8"
        stroke-dasharray="6,6"
        opacity="0.9"
        stroke-linecap="round"
        marker-end="url(#arrow-${i})"/>
    `;
  });

  const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <mask id="hole">
    <rect width="100%" height="100%" fill="white"/>
    <circle cx="${cx}" cy="${cy}" r="${holeRadius}" fill="black"/>
  </mask>

  ${strokes.map((c, i) => `
    <marker id="arrow-${i}"
      markerWidth="10"
      markerHeight="10"
      refX="9"
      refY="5"
      orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="${c}" opacity="0.9"/>
    </marker>
  `).join("")}
</defs>

<!-- CONNECTORS OUTSIDE MASK (IMPORTANT) -->
${connectors.join("")}

<!-- TOOLS INSIDE MASK -->
<g mask="url(#hole)">
  ${toolImages.map((img, i) => `
    <image href="data:image/png;base64,${img}"
      x="${points[i].x - toolSize / 2}"
      y="${points[i].y - toolSize / 2}"
      width="${toolSize}"
      height="${toolSize}"
      image-rendering="optimizeQuality"/>
  `).join("")}
</g>
</svg>
`;

  const out = `/tmp/page2_plate_${Date.now()}.png`;
  await sharp(Buffer.from(svg))
    .png({ 
      compressionLevel: 6,    // Better compression while maintaining quality
      quality: 100            // Maximum quality
    })
    .toFile(out);
  return out;
}

export async function buildPage2Args({
  bgVideo,
  headshot,
  tools,
  logo,
  qr,
  outPath,
  fps = 30
}: {
  bgVideo: string;
  headshot: string;
  tools: string[];
  logo: string;
  qr: string;
  outPath: string;
  fps?: number;
}) {

  const plate = await generateRadialPlate({ tools });
  const D = 0.8;

  return [
    "-i", bgVideo,
    "-i", plate,
    "-i", headshot,
    "-i", logo,
    "-i", qr,

    "-filter_complex",
`
[0:v]scale=1920:1080,fps=${fps}[bg];
[1:v]scale=1100:1100[plate];

[2:v]scale=380:380,format=rgba,
geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':
a='if(lte((X-190)^2+(Y-190)^2,190^2),255,0)'
[headM];

[headM]scale=
w='380*if(lt(t,${D}),t/${D},1)':
h='380*if(lt(t,${D}),t/${D},1)':
eval=frame
[head];

[3:v]scale=
w='min(50,40+10*if(lt(t,${D}),t/${D},1))':
h='min(50,40+10*if(lt(t,${D}),t/${D},1))':
eval=frame
[logoA];

[4:v]scale=150:150[qr];


[bg][head]overlay=
x='80+((W/2-190)-80)*if(lt(t,${D}),t/${D},1)':
y='(H/2-200)+((H/2-190)-(H/2-200))*if(lt(t,${D}),t/${D},1)':
shortest=0
[o1];


[o1][plate]overlay=W/2-550:H/2-550[s1];

[s1][logoA]overlay=
x='(W-130)+((W-230)-(W-130))*if(lt(t,${D}),t/${D},1)':
y='40+((H-125)-40)*if(lt(t,${D}),t/${D},1)'
[s6];

[s6]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='JOIN US':fontsize=80:fontcolor=white:
x=W-350:y=H-280:box=1:boxcolor=black@0:boxborderw=14[s7];

[s7]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='LIVE':fontsize=65:fontcolor=white:
x=W-350:y=H-180:box=1:boxcolor=black@0:boxborderw=14[s8];

[s8][qr]overlay=W-170:H-220[v]
`,

    "-map", "[v]",
    "-map", "0:a?",
    "-t", "11",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-crf", "22",
    "-y",
    outPath
  ];
}


async function run() {
  const args = await buildPage2Args({
    bgVideo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/page2_bg.mp4",
    headshot: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/headshot.png",
    tools: [
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/Appsheet.png",
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/ChatGPT.png",
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/Grok.png",
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/LinkedIn.png",
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/Slack.png",
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/Google.png",
      "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/airtable.png"
    ],
    logo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/logo.png",
    qr: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/qr.png",
    outPath: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/page2.mp4"
  });

  const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });
  ffmpeg.on("close", code => console.log("\nFFmpeg exited:", code));
}

run().catch(console.error);
