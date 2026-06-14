interface ProcessVideoParams {
    inputVideo: string;
    outPath: string;
    crop: { w: number; h: number; x: number; y: number };
    fps?: number;
}

interface ProcessVideoJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputVideo: string;
    outputVideo: string;
    progress?: number;
    result?: string;
    error?: string;
}

interface OverlayJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputVideo: string;
    outputVideo: string;
    hostName: string;
    guestName: string;
    hostSide: "left" | "right";
    logoPath: string;
    pillConfig?: {
        pillBg?: string;
        pillText?: string;
        shadowBg?: string;
    };
    progress?: number;
    result?: string;
    error?: string;
}

interface OverlayParams {
    inputVideo: string;
    outPath: string;
    hostSide: "left" | "right";
    logoPath: string;
    hostPill: { pillPath: string; shadowPath: string; width: number; height: number };
    guestPill: { pillPath: string; shadowPath: string; width: number; height: number };
}

interface OverlayJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputVideo: string;
    outputVideo: string;
    hostName: string;
    guestName: string;
    hostSide: "left" | "right";
    logoPath: string;
    pillConfig?: {
        pillBg?: string;
        pillText?: string;
        shadowBg?: string;
    };
    progress?: number;
    result?: string;
    error?: string;
}

interface OverlayParams {
    inputVideo: string;
    outPath: string;
    hostSide: "left" | "right";
    logoPath: string;
    hostPill: { pillPath: string; shadowPath: string; width: number; height: number };
    guestPill: { pillPath: string; shadowPath: string; width: number; height: number };
}

interface SubtitleJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputVideo: string;
    subtitlesPath: string;
    outputVideo: string;
    progress?: number;
    result?: string;
    error?: string;
}

interface ClipJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    inputVideo: string;
    clips: {
        title: string;
        start_ffmpeg: string;
        end_ffmpeg: string;
    }[];
    outputDir: string;
    progress?: number;
    results?: string[];
    error?: string;
}

interface FullInterviewJobData {
    id: string;
    status: string;
    progress?: number;
    inputVideo: string;
    logoPath: string;
    hostname: string;
    guestname: string;
    hostside: "left" | "right";
    pillConfig: {
        pillBg?: string;
        pillText?: string;
        shadowBg?: string;
        fontSize?: number;
    };
    introPath?: string;
    outroPath?: string;
    result?: string;
    error?: string;
}

interface LogoSwapJobData {
    id: string;
    status: "pending" | "processing" | "done" | "error";
    progress: number;
    inputVideo: string;
    newLogo: string;
    result?: string;
    error?: string;
}