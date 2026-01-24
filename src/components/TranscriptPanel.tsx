import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TranscriptEntry {
  id: string;
  original: string;
  translated: string;
  timestamp: number;
  latency?: number;
}

interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
  partialTranscript: string;
}

export function TranscriptPanel({ transcripts, partialTranscript }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, partialTranscript]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: "2-digit", 
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="flex-1 overflow-hidden">
      <ScrollArea className="h-full" ref={scrollRef}>
        <div className="space-y-4 p-1">
          {transcripts.length === 0 && !partialTranscript && (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">
                Transcripts will appear here as you speak
              </p>
            </div>
          )}

          {transcripts.map((entry, index) => (
            <div
              key={entry.id}
              className={cn(
                "rounded-xl p-4 animate-fade-in",
                "bg-secondary/50"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  {formatTime(entry.timestamp)}
                </span>
                {entry.latency && (
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    entry.latency < 1000 ? "bg-status-speaking/10 text-status-speaking" :
                    entry.latency < 2000 ? "bg-status-translating/10 text-status-translating" :
                    "bg-status-recording/10 text-status-recording"
                  )}>
                    {entry.latency}ms
                  </span>
                )}
              </div>
              
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="text-xs font-medium text-voice-input shrink-0">IN</span>
                  <p className="text-sm text-muted-foreground">{entry.original}</p>
                </div>
                <div className="flex gap-2">
                  <span className="text-xs font-medium text-voice-output shrink-0">EN</span>
                  <p className="text-sm font-medium text-foreground">{entry.translated}</p>
                </div>
              </div>
            </div>
          ))}

          {partialTranscript && (
            <div className="rounded-xl p-4 bg-primary/5 border border-primary/20 animate-pulse-subtle">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-status-recording animate-pulse" />
                <span className="text-xs text-muted-foreground">Listening...</span>
              </div>
              <p className="text-sm text-muted-foreground italic">
                {partialTranscript}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
