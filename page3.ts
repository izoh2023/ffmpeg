import { spawn } from "child_process";
import sharp from "sharp";
import fs from "fs/promises";

function ffText(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}


/* =========================
   SVG → PNG INSIGHT PLATES
========================= */
async function generateInsightPlates({
  items,
  size = 1600,
  holeRadius = 190,
  cardW = 520,
  cardH = 200,
  colors = ["#A78BFA", "#FB923C", "#2DD4BF", "#F472B6"]
}: {
  items: { label: string; text: string; number: string }[];
  size?: number;
  holeRadius?: number;
  cardW?: number;
  cardH?: number;
  colors?: string[];
}) {
  if (items.length !== 8) {
    throw new Error("generateInsightPlates expects exactly 8 items");
  }

  const cx = size / 2;
  const cy = size / 2;

  const verticalPadding = 60;
  const spacing =
    (size - verticalPadding * 2 - cardH * 4) / 3.5;
  const startY = verticalPadding;

  const positions = [
    { x: 80, y: startY },
    { x: 20, y: startY + cardH + spacing },
    { x: 20, y: startY + (cardH + spacing) * 2 },
    { x: 80, y: startY + (cardH + spacing) * 3 },
    { x: size - cardW - 80, y: startY },
    { x: size - cardW - 20, y: startY + cardH + spacing },
    { x: size - cardW - 20, y: startY + (cardH + spacing) * 2 },
    { x: size - cardW - 80, y: startY + (cardH + spacing) * 3 }
  ];

  const circleRadius = 48;
  const circleX = circleRadius + 16;
  const circleY = cardH / 2;

  function wrapText(text: string, maxChars: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length <= maxChars) line = test;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function computeTypography(label: string, lines: string[]) {
    const totalChars =
      label.length + lines.join("").length;
    const lineCount = lines.length;

    // SHORT → scale up
    if (lineCount === 1 && totalChars < 60) {
      return { label: 34, body: 32, gap: 30 };
    }

    // DENSE → scale down
    if (lineCount >= 2 && totalChars > 110) {
      return { label: 20, body: 16, gap: 22 };
    }

    // DEFAULT
    return { label: 22, body: 18, gap: 26 };
  }

  const connectors = items.map((_, i) => {
    const pos = positions[i];
    const isLeft = i < 4;
    const stroke = colors[i % colors.length];

    // ----------------------------
    // 1. Start point
    // ----------------------------
    const startX = isLeft ? pos.x + cardW : pos.x;
    const startY = pos.y + cardH / 2;

    // ----------------------------
    // 2. Vector to headshot center
    // ----------------------------
    const dx = cx - startX;
    const dy = cy - startY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const ux = dx / len;
    const uy = dy / len;

    // ----------------------------
    // 3. Hard stop radius
    // ----------------------------
    const headshotRadius = 230;
    const markerLen = 26;
    const safety = 10;

    const stopRadius = headshotRadius + markerLen + safety;

    const rawEndX = cx - ux * stopRadius;
    const rawEndY = cy - uy * stopRadius;

    // ----------------------------
    // 4. Initial curve control
    // ----------------------------
    const midX = (startX + rawEndX) / 2;
    const midY = (startY + rawEndY) / 2;

    const px = -uy;
    const py = ux;

    const curvePush = 80;

    let controlX = midX + px * curvePush;
    let controlY = midY + py * curvePush;

    // ----------------------------
    // 5. 🔒 Clamp control point OUTSIDE headshot
    // ----------------------------
    const cdx = controlX - cx;
    const cdy = controlY - cy;
    const cLen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;

    const minControlRadius = headshotRadius + 60;

    if (cLen < minControlRadius) {
      const scale = minControlRadius / cLen;
      controlX = cx + cdx * scale;
      controlY = cy + cdy * scale;
    }

    // ----------------------------
    // 6. Tangent-safe endpoint retreat
    // ----------------------------
    const tx = rawEndX - controlX;
    const ty = rawEndY - controlY;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;

    const retreat = 16;

    const endX = rawEndX - (tx / tLen) * retreat;
    const endY = rawEndY - (ty / tLen) * retreat;

    // ----------------------------
    // 7. SVG
    // ----------------------------
    return `
    <path d="M ${startX} ${startY}
             Q ${controlX} ${controlY}
               ${endX} ${endY}"
      fill="none"
      stroke="${stroke}"
      stroke-width="6"
      opacity="0.18"
      stroke-linecap="round"/>

    <path d="M ${startX} ${startY}
             Q ${controlX} ${controlY}
               ${endX} ${endY}"
      fill="none"
      stroke="${stroke}"
      stroke-width="3.6"
      stroke-dasharray="6,6"
      opacity="0.95"
      stroke-linecap="round"
      marker-end="url(#arrow-${i})"/>
  `;
  }).join("");



  const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');
    </style>

    ${colors.map((c, i) => `
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
  ${connectors}

  <!-- CARDS -->
  ${items.map((it, i) => {
    const pos = positions[i];
    const c = colors[i % colors.length];

    const wrapped = wrapText(it.text, 42).slice(0, 2);
    const typo = computeTypography(it.label, wrapped);

    return `
      <g transform="translate(${pos.x}, ${pos.y})">
        <rect width="${cardW}" height="${cardH}" rx="56"
              fill="${c}" opacity="0.96"/>

        <circle cx="${circleX}" cy="${circleY}" r="${circleRadius}"
                fill="white" opacity="0.25"/>

        <text x="${circleX}" y="${circleY + 1}"
              font-family="Inter, Arial, sans-serif"
              font-size="34"
              font-weight="700"
              fill="white"
              text-anchor="middle"
              dominant-baseline="middle">
          ${it.number}
        </text>

        <text x="${circleX + circleRadius + 28}"
              y="${circleY - typo.gap}"
              font-family="Inter, Arial, sans-serif"
              font-size="${typo.label}"
              font-weight="600"
              fill="rgba(0,0,0,0.85)">
          ${it.label}
        </text>

        ${wrapped.map((line, idx) => `
          <text x="${circleX + circleRadius + 28}"
                y="${circleY + 8 + idx * typo.gap}"
                font-family="Inter, Arial, sans-serif"
                font-size="${typo.body}"
                font-weight="500"
                fill="rgba(0,0,0,0.85)">
            ${line}
          </text>
        `).join("")}
      </g>
    `;
  }).join("")}
</svg>
`;

  const out = `/tmp/page3_plate_${Date.now()}.png`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}

/* =========================
   FFMPEG PAGE 3 BUILDER
========================= */

export async function buildPage3Args({
  bgVideo,
  headshot,
  items,
  logo,
  personName,
  brandName,
  outPath,
  fps = 30
}: {
  bgVideo: string;
  headshot: string;
  items: { label: string; text: string; number: string }[];
  logo: string;
  personName: string;
  brandName: string;
  outPath: string;
  fps?: number;
}) {
  const plate = await generateInsightPlates({ items });
  const D = 0.8;

  return [
    "-i", bgVideo,
    "-i", plate,
    "-i", headshot,
    "-i", logo,

    "-filter_complex",
    `
[0:v]scale=1920:1080,fps=${fps}[bg];
[1:v]scale=1920:1080[plate];

[2:v]scale=320:320,format=rgba,
geq=
r='r(X,Y)':
g='g(X,Y)':
b='b(X,Y)':
a='if(lte((X-160)^2+(Y-160)^2,160^2),255,0)'
[head];

[head]scale=
w='320*if(lt(t,${D}),t/${D},1)':
h='320*if(lt(t,${D}),t/${D},1)':
eval=frame[headA];

[bg][headA]overlay=W/2-160:H/2-220[o1];
[o1][plate]overlay=0:0[o2];

[3:v]scale=100:100[logo];


[o2][logo]overlay=W/2-20:H/2+240[o7];


[o7]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${ffText(personName)}':fontsize=32:fontcolor=black:x=(W-text_w)/2:y=H/2+120[o8];

[o8]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${ffText(brandName)}':fontsize=48:fontcolor=white:x=(W-text_w)/2:y=H/2+160[v]
`,
    "-map", "[v]",
    "-map", "0:a?",
    "-t", "21",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-crf", "22",
    "-y",
    outPath
  ];
}

/* =========================
   RUNNER
========================= */

async function run() {
  const args = await buildPage3Args({
    bgVideo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page3_bg.mp4",
    headshot: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/mango_logo.png",

    items:[{"number":"01","label":"Highlight","text":"Brian emphasized the importance of using AI tools like Lovable for rapid prototyping in UI/UX design, which enhances team collaboration."},{"number":"02","label":"Highlight","text":"Happy Dance, the platform designed for recruitment, focuses on tailored job boards for enterprise companies, showcasing a unique niche in the market."},{"number":"03","label":"Highlight","text":"Brian discussed the evolution of SEO into generative engine optimization, emphasizing the need for clear, concise content that aligns with audience intent."},{"number":"01","label":"Example","text":"Lovable for UI/UX prototyping, which aids in collaboration and functionality suggestion."},{"number":"02","label":"Example","text":"Tools like Cursor used internally by development teams for efficient coding."},{"number":"03","label":"Example","text":"Generative AI for content strategies, including writing assistance for projects like Brian's upcoming book."},{"number":"01","label":"Insight","text":"The ongoing debate about the relevance of SEO, with Brian arguing that it continues to evolve rather than diminish in importance."},{"number":"02","label":"Insight","text":"The balance companies must strike between using various AI tools and ensuring customer value in their features."}],

    logo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/mango_logo.png",

    personName: "BRYAN ADAMS",
    brandName: "MANGOMAGIC",

    outPath: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page3.mp4"
  });

  const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });
  ffmpeg.on("close", code => console.log("\nFFmpeg exited:", code));
}

run().catch(console.error);