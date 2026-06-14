import { spawn } from "child_process";
import sharp from "sharp";

/* =========================
   HELPERS
========================= */
function ffText(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

/* =========================
   SVG → PNG QUOTE PLATE
========================= */
async function generateQuotePlate({
  quote,
  width = 1200,
  height = 720
}: {
  quote: string;
  width?: number;
  height?: number;
}) {
  const padding = 90;
  const radius = 42;
  const fontFamily = "Montserrat, Arial, sans-serif";
  const maxFont = 92;
  const minFont = 28;
  const lineGap = 1.25;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  function wrap(text: string, maxChars: number) {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";

    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (t.length > maxChars) {
        lines.push(line);
        line = w;
      } else {
        line = t;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  async function measure(lines: string[], fontSize: number) {
    const lineHeight = fontSize * lineGap;
    const totalH = lines.length * lineHeight;

    const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    text {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      font-weight: 500;
    }
  </style>
  ${lines
        .map(
          (l, i) => `
    <text x="${width / 2}"
          y="${100 + i * lineHeight}"
          text-anchor="middle">${l}</text>`
        )
        .join("")}
</svg>
`;

    const img = await sharp(Buffer.from(svg))
      .png()
      .trim()
      .toBuffer({ resolveWithObject: true });

    return {
      width: img.info.width,
      height: Math.max(img.info.height, totalH)
    };
  }

  let fontSize = maxFont;
  let lines: string[] = [];

  // 🔁 real fitting loop
  while (fontSize >= minFont) {
    const approxChars = Math.max(12, Math.floor(innerW / (fontSize * 0.48)));
    lines = wrap(quote, approxChars);

    const m = await measure(lines, fontSize);

    if (m.width <= innerW && m.height <= innerH) break;
    fontSize -= 2;
  }

  const lineHeight = fontSize * lineGap;
  const totalH = lines.length * lineHeight;
  const startY = height / 2 - totalH / 2 + fontSize;

  const textSvg = lines
    .map(
      (l, i) => `
    <text
      x="${width / 2}"
      y="${startY + i * lineHeight}"
      text-anchor="middle"
      font-family="${fontFamily}"
      font-size="${fontSize}"
      font-weight="500"
      fill="#ffffff"
    >${l}</text>
  `
    )
    .join("");

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <!-- Frame -->
  <rect x="6" y="6"
    width="${width - 12}"
    height="${height - 12}"
    rx="${radius}"
    fill="none"
    stroke="#ffffff"
    stroke-width="4"/>

  <!-- Glass -->
  <rect x="${padding}" y="${padding}"
    width="${innerW}"
    height="${innerH}"
    rx="${radius - 10}"
    fill="rgba(255,255,255,0.06)"/>

  <!-- Quotes -->
  <text x="${padding - 30}" y="${padding + 60}"
    font-size="96"
    font-family="${fontFamily}"
    fill="#ffffff">“</text>

  <text x="${width - padding + 8}" y="${height - padding + 70}"
    font-size="96"
    font-family="${fontFamily}"
    fill="#ffffff">”</text>

  ${textSvg}
</svg>
`;

  const out = `/tmp/page4_quote_${Date.now()}.png`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}


/* =========================
   PERSON PLATE (IMPROVED)
========================= */
async function generatePersonPlate({
  person,
  headshot,
  width = 900,
  height = 260,
  headSize = 100,
  paddingRight = 20,
  gap = 12,
  fontSize = 32,
  fontFamily = "Montserrat, Arial, sans-serif"
}: {
  person: string;
  headshot: string;
  width?: number;
  height?: number;
  headSize?: number;
  paddingRight?: number;
  gap?: number;
  fontSize?: number;
  fontFamily?: string;
}) {
  try {
    /* =========================
       HEADSHOT (CIRCULAR)
    ========================= */
    const head = await sharp(headshot)
      .resize(headSize, headSize, { fit: "cover" })
      .composite([
        {
          input: Buffer.from(`
            <svg width="${headSize}" height="${headSize}">
              <circle
                cx="${headSize / 2}"
                cy="${headSize / 2}"
                r="${headSize / 2}"
                fill="white"
              />
            </svg>
          `),
          blend: "dest-in"
        }
      ])
      .png()
      .toBuffer();

    /* =========================
       TEXT SPLIT
    ========================= */
    const words = person.trim().split(/\s+/);
    const topLine = words.slice(0, 2).join(" ");
    const bottomLine = words.slice(2).join(" "); // may be empty

    const rightX = width - paddingRight;
    const centerY = height / 2;
    const lineOffset = fontSize * 0.65;

    /* =========================
       MEASURE TOP LINE (EXACT)
    ========================= */
    let topLineWidth = 0;

    if (bottomLine) {
      const measureSvg = Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .name {
              font-family: ${fontFamily};
              font-size: ${fontSize}px;
              font-weight: 700;
              fill: #000;
            }
          </style>

          <text
            class="name"
            x="${rightX}"
            y="${centerY}"
            text-anchor="end"
            dominant-baseline="middle"
          >${topLine}</text>
        </svg>
      `);

      const measured = await sharp(measureSvg)
        .png()
        .trim()
        .toBuffer({ resolveWithObject: true });

      topLineWidth = measured.info.width;
    }

    /* =========================
       FINAL SVG
    ========================= */
    const topCenterX = rightX - topLineWidth / 2;

    const finalSvg = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .name {
            font-family: ${fontFamily};
            font-size: ${fontSize}px;
            font-weight: 700;
            fill: #000;
          }
        </style>

        <text class="name">
          <!-- Top line -->
          <tspan
            x="${rightX}"
            y="${bottomLine ? centerY - lineOffset : centerY}"
            text-anchor="end"
            dominant-baseline="middle"
          >${bottomLine ? topLine : person}</tspan>

          ${bottomLine
        ? `
              <tspan
                x="${topCenterX}"
                y="${centerY + lineOffset}"
                text-anchor="middle"
                dominant-baseline="middle"
              >${bottomLine}</tspan>
            `
        : ""
      }
        </text>
      </svg>
    `);

    /* =========================
       POSITION HEADSHOT
    ========================= */
    const textLeftX = bottomLine
      ? rightX - topLineWidth
      : rightX - (await sharp(finalSvg).png().trim().metadata()).width!;

    const headX = Math.max(0, textLeftX - gap - headSize);
    const headY = Math.round((height - headSize) / 2);

    /* =========================
       OUTPUT
    ========================= */
    const out = `/tmp/person_plate_${Date.now()}.png`;

    await sharp(finalSvg)
      .png()
      .composite([{ input: head, left: headX, top: headY }])
      .toFile(out);

    return out;
  } catch (err) {
    const error = err as Error;
    throw new Error(
      `Failed to generate person plate: ${error.message}`
    );
  }
}


/* =========================
   PAGE 4 BUILDER (FINAL)
========================= */
export async function buildPage4Args({
  bgVideo,
  headshot,
  person,
  brandName,
  quote,
  logo = "/assets/logo.png",
  qr = "/assets/qr.png",
  outPath,
  fps = 30
}: {
  bgVideo: string;
  headshot: string;
  person: string;
  brandName: string;
  quote: string;
  logo?: string;
  qr?: string;
  outPath: string;
  fps?: number;
}) {
  const quotePlate = await generateQuotePlate({ quote });

  const personPlate = await generatePersonPlate({
    person,
    headshot,
    width: 1100,
    height: 260,
    headSize: 180,
    paddingRight: 20,
    gap: 20,
    fontSize: 56
  });

  return [
    "-i", bgVideo,
    "-i", quotePlate,
    "-i", personPlate,
    "-i", logo,
    "-i", qr,

    "-filter_complex",
    `
[0:v]scale=1920:1080,fps=${fps}[bg];
[1:v]scale=1000:720[quote];
[2:v]scale=1100:260[personPlate];

[3:v]scale=200:200[logo];
[4:v]scale=200:200[qr];

[bg][quote]overlay=80:H/2-360[o1];
[o1][personPlate]overlay=W-1100-20:80[o2];

[o2][logo]overlay=W-500:80+220[t3];

[t3]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${ffText(brandName)}':
fontsize=88:fontcolor=white:
x=W-700:y=80+260+20+65+100[t4];

[t4]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='JOIN US':
fontsize=160:fontcolor=white:
x=W-700:y=H-380[t5];

[t5]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='LIVE':
fontsize=200:fontcolor=white:
x=W-700:y=H-180[t6];

[t6][qr]overlay=W-200-40:H-215[v]
    `,

    "-map", "[v]",
    "-map", "0:a?",
    "-t", "10",
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
  const args = await buildPage4Args({
    bgVideo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page4_bg.mp4",
    headshot: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/mango_logo.png",
    person: "Brandon Schulte, MBA",
    brandName: "MANGOMAGIC",
    quote: "In the long term, everything will move to AI.",
    qr: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/qr.png",
    logo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/mango_logo.png",

    outPath: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page4.mp4"
  });

  spawn("ffmpeg", args, { stdio: "inherit" });
}

run().catch(console.error);