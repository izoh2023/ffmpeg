import { spawn } from "child_process";
import sharp from "sharp";
import fs from "fs/promises";



export function buildPage1Args({
  bgVideo,
  headshot,
  logo = "/assets/logo.png",
  qr = "/assets/qr.png",
  brandName,
  person,
  outPath,
  fps = 30
}: {
  bgVideo: string;
  headshot: string;
  logo?: string;
  qr?: string;
  brandName: string;
  person: string;
  outPath: string;
  fps?: number;
}) {
  return [
    "-i", bgVideo,
    "-i", headshot,
    "-i", logo,
    "-i", qr,

    "-filter_complex",
    `
[0:v]scale=1920:1080,fps=${fps}[bg];

[1:v]scale=260:260,format=rgba,
geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':
a='if(lte((X-130)^2+(Y-130)^2,130^2),255,0)'[head];

[2:v]scale=90:90[logo];
[3:v]scale=100:100[qr];

[bg][logo]overlay=W-w-40:40[o1];
[o1][head]overlay=80:H/2-200[o2];

[o2]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${brandName}':
fontsize=88:fontcolor=white:
x=80:y=H/2+80:
alpha='if(lt(t,5),t/5,1)'[t1];

[t1]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='${person}':
fontsize=42:fontcolor=black:
x=80:y=H/2+180:
alpha='if(lt(t,5),t/5,1)'[t5];

[t5]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='JOIN US':
fontsize=80:fontcolor=white:
x=W-380:y=H-280[t6];

[t6]drawtext=fontfile=/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/fonts/Montserrat-Bold.ttf:
text='LIVE':
fontsize=95:fontcolor=white:
x=W-380:y=H-180[t7];

[t7][qr]overlay=W-70-80:H-215[v]
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

async function run() {
  const args = await buildPage1Args({
    bgVideo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page1_bg.mp4",
    headshot: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/headshot.png",
    logo: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/logo.png",
    brandName: "MANGOMAGIC",
    qr: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page2/qr.png",
    person: "TOMAS VENTURO",
    outPath: "/mnt/c/Users/ISAAC/Desktop/ffmpeg_tests/page1.mp4"
  });

  const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });
  ffmpeg.on("close", code => console.log("\nFFmpeg exited:", code));
}

run().catch(console.error);
