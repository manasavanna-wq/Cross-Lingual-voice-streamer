import { cn } from "@/lib/utils";
import type { TranslationStatus } from "@/hooks/useVoiceTranslation";

interface StatusIndicatorProps {
  status: TranslationStatus;
  latency: number | null;
}

const statusConfig = {
  idle: {
    label: "Ready",
    dotClass: "status-dot-ready",
    description: "Click start to begin translation",
  },
  recording: {
    label: "Listening",
    dotClass: "status-dot-recording",
    description: "Capturing audio...",
  },
  translating: {
    label: "Translating",
    dotClass: "status-dot-translating",
    description: "Processing speech...",
  },
  speaking: {
    label: "Speaking",
    dotClass: "status-dot-speaking",
    description: "Playing translation...",
  },
};

export function StatusIndicator({ status, latency }: StatusIndicatorProps) {
  const config = statusConfig[status];

  const getLatencyClass = () => {
    if (!latency) return "";
    if (latency < 1000) return "latency-good";
    if (latency < 2000) return "latency-moderate";
    return "latency-high";
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={cn("status-dot", config.dotClass)} />
        <div>
          <p className="text-sm font-medium text-foreground">{config.label}</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </div>
      </div>
      
      {latency !== null && (
        <div className={cn("text-right", getLatencyClass())}>
          <p className="text-lg font-semibold tabular-nums">
            {latency}ms
          </p>
          <p className="text-xs text-muted-foreground">latency</p>
        </div>
      )}
    </div>
  );
}
