import { useState, useEffect, useCallback } from "react";
import { Mic, MicOff, Volume2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useVoiceTranslation } from "@/hooks/useVoiceTranslation";
import { AudioWaveform } from "@/components/AudioWaveform";
import { StatusIndicator } from "@/components/StatusIndicator";
import { LanguageSelector } from "@/components/LanguageSelector";
import { TranscriptPanel } from "@/components/TranscriptPanel";

export function VoiceStreamer() {
  const { toast } = useToast();
  const [sourceLang, setSourceLang] = useState("Tamil");
  const [targetLang, setTargetLang] = useState("English");
  const [voice, setVoice] = useState<"male" | "female">("female");
  const [audioLevels, setAudioLevels] = useState<Uint8Array>(new Uint8Array(32));

  const {
    status,
    transcripts,
    partialTranscript,
    latency,
    error,
    startRecording,
    stopRecording,
    getAudioLevels,
    isRecording,
  } = useVoiceTranslation({
    sourceLang,
    targetLang,
    voice,
  });

  // Update audio levels for visualization
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      setAudioLevels(getAudioLevels());
    }, 50);

    return () => clearInterval(interval);
  }, [isRecording, getAudioLevels]);

  // Handle errors
  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error,
      });
    }
  }, [error, toast]);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <header className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold gradient-text">
            Cross-Lingual Voice Streamer
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real-time medical translation from regional languages to English. 
            Breaking language barriers in healthcare consultations.
          </p>
        </header>

        {/* Main Translation Card */}
        <Card className="glass-card p-6 space-y-6">
          {/* Status */}
          <StatusIndicator status={status} latency={latency} />

          {/* Language Selection */}
          <LanguageSelector
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSourceChange={setSourceLang}
            onTargetChange={setTargetLang}
            disabled={isRecording}
          />

          {/* Voice Selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Doctor's voice
            </label>
            <RadioGroup
              value={voice}
              onValueChange={(v) => setVoice(v as "male" | "female")}
              className="flex gap-4"
              disabled={isRecording}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="female" id="female" />
                <Label htmlFor="female" className="text-sm cursor-pointer">
                  Female
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="male" id="male" />
                <Label htmlFor="male" className="text-sm cursor-pointer">
                  Male
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Audio Visualizers */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-voice-input rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Mic className="w-4 h-4 text-voice-input" />
                <span className="text-xs font-medium text-muted-foreground">
                  Patient Audio
                </span>
              </div>
              <AudioWaveform
                levels={audioLevels}
                isActive={isRecording}
                variant="input"
              />
            </div>

            <div className="bg-voice-output rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Volume2 className="w-4 h-4 text-voice-output" />
                <span className="text-xs font-medium text-muted-foreground">
                  Doctor Audio
                </span>
              </div>
              <AudioWaveform
                levels={status === "speaking" ? audioLevels : new Uint8Array(32)}
                isActive={status === "speaking"}
                variant="output"
              />
            </div>
          </div>

          {/* Record Button */}
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={handleToggleRecording}
              className={`
                w-20 h-20 rounded-full transition-all duration-300
                ${isRecording 
                  ? "bg-status-recording hover:bg-status-recording/90 pulse-recording" 
                  : "btn-medical"
                }
              `}
            >
              {isRecording ? (
                <MicOff className="w-8 h-8" />
              ) : (
                <Mic className="w-8 h-8" />
              )}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {isRecording 
              ? "Click to stop recording" 
              : "Click to start translation"
            }
          </p>
        </Card>

        {/* Transcripts */}
        <Card className="glass-card p-6 min-h-[300px] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">Translation History</h2>
            {transcripts.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {transcripts.length} translation{transcripts.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <TranscriptPanel
            transcripts={transcripts}
            partialTranscript={partialTranscript}
          />
        </Card>

        {/* Latency Target Info */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-secondary/30">
          <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Target: &lt;2 second latency</p>
            <p className="text-muted-foreground mt-1">
              This system processes speech continuously using streaming ASR, 
              incremental translation, and fast TTS synthesis for near real-time 
              medical interpretation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
