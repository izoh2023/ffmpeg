import sharp from "sharp";
import fs from "fs";
import path from "path";

sharp.cache(false);
sharp.concurrency(1);

const fontFile = fs.existsSync('/usr/share/fonts/truetype/montserrat/Montserrat-VariableFont_wght.ttf')
    ? '/usr/share/fonts/truetype/montserrat/Montserrat-VariableFont_wght.ttf'
    : '/usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf';

const MONTSERRAT_BASE64 = fs.readFileSync(fontFile).toString("base64");

const FONT_FACE = `
    @font-face {
        font-family: 'Montserrat';
        src: url('data:font/truetype;base64,${MONTSERRAT_BASE64}');
        font-weight: 100 900;
    }
`;

export async function generatePillImages(
    text: string,
    options?: {
        pillBg?: string;
        pillText?: string;
        shadowBg?: string;
        fontSize?: number;
    }
) {
    const fontSize     = options?.fontSize ?? 42;
    const paddingX     = Math.round(fontSize * 1.2);
    const paddingY     = Math.round(fontSize * 0.6);
    const borderRadius = Math.round(fontSize * 1.1);

    const pillBg   = options?.pillBg   ?? "#000000";
    const pillText = options?.pillText ?? "#FFFFFF";
    const shadowBg = options?.shadowBg ?? "#FFD400";

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>${FONT_FACE}</style>
      </defs>
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Montserrat" font-weight="600">${text}</text>
    </svg>
  `;
    const metrics = await sharp(Buffer.from(svg)).metadata();

    if (!metrics.width) {
        throw new Error("Could not measure text width");
    }

    const width  = metrics.width + paddingX * 2;
    const height = fontSize + paddingY * 2;

    const pillPath   = `/tmp/pill_${Date.now()}.png`;
    const shadowPath = `/tmp/shadow_${Date.now()}.png`;

    const pillSVG = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>${FONT_FACE}</style>
      </defs>
      <rect width="100%" height="100%" rx="${borderRadius}" ry="${borderRadius}" fill="${pillBg}"/>
      <text
        x="50%"
        y="50%"
        font-size="${fontSize}"
        fill="${pillText}"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="Montserrat"
        font-weight="600"
        font-variation-settings="'wght' 600"
      >${text}</text>
    </svg>
  `;

    await sharp(Buffer.from(pillSVG)).png().toFile(pillPath);

    const shadowExtension    = Math.round(fontSize * 0.25);
    const shadowHeight       = height + shadowExtension;
    const shadowBorderRadius = borderRadius + shadowExtension / 2;

    const shadowSVG = `
    <svg width="${width}" height="${shadowHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect
        width="100%"
        height="100%"
        rx="${shadowBorderRadius}"
        ry="${shadowBorderRadius}"
        fill="${shadowBg}"
      />
    </svg>
  `;

    await sharp(Buffer.from(shadowSVG)).png().toFile(shadowPath);

    return { pillPath, shadowPath, width, height };
}
