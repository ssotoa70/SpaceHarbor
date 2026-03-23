import type { MediaType } from "../utils/media-types";

interface MediaTypeIconProps {
  type: MediaType;
  size?: number;
  className?: string;
}

function VideoIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="18" />
      <polygon points="20,16 34,24 20,32" />
    </svg>
  );
}

function ImageIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="10" width="36" height="28" rx="2" />
      <polyline points="6,34 16,24 24,32 32,22 42,34" />
      <circle cx="16" cy="18" r="3" />
    </svg>
  );
}

function AudioIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="20" x2="10" y2="28" />
      <line x1="16" y1="14" x2="16" y2="34" />
      <line x1="22" y1="18" x2="22" y2="30" />
      <line x1="28" y1="10" x2="28" y2="38" />
      <line x1="34" y1="16" x2="34" y2="32" />
      <line x1="40" y1="22" x2="40" y2="26" />
    </svg>
  );
}

function RawIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="18" />
      <circle cx="24" cy="24" r="6" />
      <line x1="24" y1="6" x2="24" y2="12" />
      <line x1="24" y1="36" x2="24" y2="42" />
      <line x1="6" y1="24" x2="12" y2="24" />
      <line x1="36" y1="24" x2="42" y2="24" />
    </svg>
  );
}

function ThreeDIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 6L42 16V32L24 42L6 32V16L24 6Z" />
      <line x1="24" y1="6" x2="24" y2="42" />
      <line x1="6" y1="16" x2="42" y2="16" />
      <line x1="6" y1="32" x2="24" y2="24" />
      <line x1="42" y1="32" x2="24" y2="24" />
    </svg>
  );
}

function DocumentIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6H30L38 14V42H12V6Z" />
      <polyline points="30,6 30,14 38,14" />
      <line x1="18" y1="22" x2="32" y2="22" />
      <line x1="18" y1="28" x2="32" y2="28" />
      <line x1="18" y1="34" x2="26" y2="34" />
    </svg>
  );
}

function AiIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="24,6 42,38 6,38" />
      <polygon points="24,18 34,34 14,34" />
    </svg>
  );
}

function VfxIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="14" cy="14" r="4" />
      <circle cx="34" cy="14" r="4" />
      <circle cx="14" cy="34" r="4" />
      <circle cx="34" cy="34" r="4" />
      <line x1="18" y1="14" x2="30" y2="14" />
      <line x1="14" y1="18" x2="14" y2="30" />
      <line x1="34" y1="18" x2="34" y2="30" />
      <line x1="18" y1="34" x2="30" y2="34" />
      <line x1="17" y1="17" x2="31" y2="31" />
    </svg>
  );
}

function OtherIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="32" height="32" rx="4" />
      <circle cx="24" cy="24" r="4" />
    </svg>
  );
}

const ICON_MAP: Record<MediaType, React.ComponentType<{ size: number }>> = {
  video: VideoIcon,
  image: ImageIcon,
  audio: AudioIcon,
  raw: RawIcon,
  "3d": ThreeDIcon,
  document: DocumentIcon,
  ai: AiIcon,
  vfx: VfxIcon,
  other: OtherIcon,
};

export function MediaTypeIcon({ type, size = 48, className = "" }: MediaTypeIconProps) {
  const Icon = ICON_MAP[type] ?? OtherIcon;
  return (
    <div className={`opacity-60 ${className}`} aria-hidden="true">
      <Icon size={size} />
    </div>
  );
}
