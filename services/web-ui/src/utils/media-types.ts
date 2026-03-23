export type MediaType = "video" | "image" | "audio" | "raw" | "3d" | "document" | "ai" | "vfx" | "other";

const EXT_MAP: Record<string, MediaType> = {
  // Video
  mp4: "video", mov: "video", mxf: "video", avi: "video", mkv: "video", webm: "video",
  // Image
  tiff: "image", tif: "image", exr: "image", dpx: "image", png: "image",
  jpg: "image", jpeg: "image", hdr: "image", psd: "image",
  // Audio
  wav: "audio", aiff: "audio", aif: "audio", mp3: "audio", flac: "audio", ogg: "audio",
  // Raw camera
  cr3: "raw", cr2: "raw", arw: "raw", nef: "raw", dng: "raw", r3d: "raw",
  // 3D
  usd: "3d", usda: "3d", usdc: "3d", usdz: "3d", abc: "3d", vdb: "3d", fbx: "3d", obj: "3d",
  // Document
  pdf: "document", doc: "document", docx: "document",
  // AI (Adobe Illustrator)
  ai: "ai",
  // VFX
  nk: "vfx", hip: "vfx", ma: "vfx", mb: "vfx",
};

export function inferMediaType(filename: string, _sourceUri?: string): MediaType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "other";
}

interface TypeBadgeInfo {
  label: string;
  color: string;
  bg: string;
  border: string;
}

const BADGE_MAP: Record<MediaType, TypeBadgeInfo> = {
  video:    { label: "VIDEO",    color: "#22d3ee", bg: "rgba(34,211,238,0.12)",  border: "rgba(34,211,238,0.25)" },
  image:    { label: "IMAGE",    color: "#a855f7", bg: "rgba(168,85,247,0.12)",  border: "rgba(168,85,247,0.25)" },
  audio:    { label: "AUDIO",    color: "#10b981", bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.25)" },
  raw:      { label: "RAW",      color: "#f97316", bg: "rgba(249,115,22,0.12)",  border: "rgba(249,115,22,0.25)" },
  "3d":     { label: "3D",       color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   border: "rgba(6,182,212,0.25)" },
  document: { label: "DOCUMENT", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.25)" },
  ai:       { label: "AI",       color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.25)" },
  vfx:      { label: "VFX",      color: "#a855f7", bg: "rgba(168,85,247,0.12)",  border: "rgba(168,85,247,0.25)" },
  other:    { label: "FILE",     color: "#475569", bg: "rgba(71,85,105,0.12)",   border: "rgba(71,85,105,0.25)" },
};

export function getTypeBadge(type: MediaType): TypeBadgeInfo {
  return BADGE_MAP[type];
}

const GRADIENT_MAP: Record<MediaType, string> = {
  video:    "radial-gradient(ellipse at 30% 40%, rgba(34,211,238,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  image:    "radial-gradient(ellipse at 30% 40%, rgba(168,85,247,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  audio:    "radial-gradient(ellipse at 30% 40%, rgba(16,185,129,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  raw:      "radial-gradient(ellipse at 30% 40%, rgba(249,115,22,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  "3d":     "radial-gradient(ellipse at 30% 40%, rgba(6,182,212,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  document: "radial-gradient(ellipse at 30% 40%, rgba(148,163,184,0.10) 0%, rgba(2,11,24,0.95) 70%)",
  ai:       "radial-gradient(ellipse at 30% 40%, rgba(245,158,11,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  vfx:      "radial-gradient(ellipse at 30% 40%, rgba(168,85,247,0.15) 0%, rgba(2,11,24,0.95) 70%)",
  other:    "radial-gradient(ellipse at 30% 40%, rgba(71,85,105,0.10) 0%, rgba(2,11,24,0.95) 70%)",
};

export function getThumbGradient(type: MediaType): string {
  return GRADIENT_MAP[type];
}

export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) return "";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function extractVastPath(sourceUri: string): string {
  // Return the canonical absolute path — no vast:// prefix
  if (sourceUri.startsWith("vast://")) {
    // Legacy: strip vast:// and return as absolute path
    const stripped = sourceUri.replace(/^vast:\/\//, "");
    return `/${stripped}`;
  }
  return sourceUri;
}
