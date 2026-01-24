import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type TranslationStatus = "idle" | "recording" | "translating" | "speaking";

interface TranscriptEntry {
  id: string;
  original: string;
  translated: string;
  timestamp: number;
  latency?: number;
}

interface UseVoiceTranslationOptions {
  sourceLang: string;
  targetLang: string;
  voice: "male" | "female";
  onStatusChange?: (status: TranslationStatus) => void;
}

export function useVoiceTranslation({
  sourceLang,
  targetLang,
  voice,
  onStatusChange,
}: UseVoiceTranslationOptions) {
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<HTMLAudioElement[]>([]);
  const isPlayingRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const accumulatedTextRef = useRef("");
  const lastTranslationTimeRef = useRef(0);
  const translationDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const updateStatus = useCallback((newStatus: TranslationStatus) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  // Play queued audio
  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      if (status === "speaking") {
        updateStatus("recording");
      }
      return;
    }

    isPlayingRef.current = true;
    const audio = audioQueueRef.current.shift()!;
    
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      playNextAudio();
    };
    
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      playNextAudio();
    };

    audio.play().catch(() => playNextAudio());
  }, [status, updateStatus]);

  // Text-to-speech
  const synthesizeSpeech = useCallback(async (text: string) => {
    if (!text.trim()) return;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text, voice }),
        }
      );

      if (!response.ok) {
        throw new Error("TTS failed");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audioQueueRef.current.push(audio);
      
      if (!isPlayingRef.current) {
        updateStatus("speaking");
        playNextAudio();
      }
    } catch (err) {
      console.error("TTS error:", err);
    }
  }, [voice, playNextAudio, updateStatus]);

  // Translation with debouncing for incremental updates
  const translateText = useCallback(async (text: string, isCommitted: boolean) => {
    if (!text.trim()) return;

    const now = Date.now();
    
    // For partial transcripts, debounce to avoid too many requests
    if (!isCommitted) {
      if (translationDebounceRef.current) {
        clearTimeout(translationDebounceRef.current);
      }
      
      // Only translate if 300ms has passed since last translation
      if (now - lastTranslationTimeRef.current < 300) {
        translationDebounceRef.current = setTimeout(() => {
          translateText(text, false);
        }, 300);
        return;
      }
    }

    lastTranslationTimeRef.current = now;
    updateStatus("translating");

    try {
      const startTime = Date.now();
      
      const { data, error: fnError } = await supabase.functions.invoke("translate", {
        body: { text, sourceLang, targetLang },
      });

      if (fnError) throw fnError;

      const totalLatency = Date.now() - startTime;
      setLatency(totalLatency);

      if (data?.translatedText) {
        if (isCommitted) {
          // Add to permanent transcript list
          const entry: TranscriptEntry = {
            id: crypto.randomUUID(),
            original: text,
            translated: data.translatedText,
            timestamp: Date.now(),
            latency: totalLatency,
          };
          
          setTranscripts(prev => [...prev, entry]);
          setPartialTranscript("");
          
          // Synthesize committed translations
          synthesizeSpeech(data.translatedText);
        } else {
          // Show as partial/preview
          setPartialTranscript(data.translatedText);
        }
      }
    } catch (err) {
      console.error("Translation error:", err);
      setError("Translation failed");
    }
  }, [sourceLang, targetLang, updateStatus, synthesizeSpeech]);

  // Start recording with ElevenLabs Scribe
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscripts([]);
      setPartialTranscript("");
      accumulatedTextRef.current = "";

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        } 
      });
      streamRef.current = stream;

      // Set up audio analyzer for visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      // Get scribe token
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke(
        "elevenlabs-scribe-token"
      );

      if (tokenError || !tokenData?.token) {
        throw new Error("Failed to get transcription token");
      }

      // Connect to ElevenLabs Scribe WebSocket
      const ws = new WebSocket("wss://api.elevenlabs.io/v1/scribe");
      wsRef.current = ws;

      ws.onopen = () => {
        // Send initial config
        ws.send(JSON.stringify({
          type: "configure",
          token: tokenData.token,
          model_id: "scribe_v2_realtime",
          language_code: getLanguageCode(sourceLang),
          sample_rate: 16000,
        }));

        updateStatus("recording");

        // Start sending audio chunks
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            const arrayBuffer = await event.data.arrayBuffer();
            const base64 = btoa(
              String.fromCharCode(...new Uint8Array(arrayBuffer))
            );
            ws.send(JSON.stringify({
              type: "audio",
              data: base64,
            }));
          }
        };

        mediaRecorder.start(100); // Send chunks every 100ms
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === "partial_transcript") {
          const partialText = message.text || "";
          setPartialTranscript(partialText);
          
          // Translate partial for preview
          if (partialText.length > 10) {
            translateText(partialText, false);
          }
        } else if (message.type === "committed_transcript") {
          const committedText = message.text || "";
          
          if (committedText.trim()) {
            translateText(committedText, true);
          }
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setError("Connection error");
        stopRecording();
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
      };

    } catch (err) {
      console.error("Recording error:", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
      updateStatus("idle");
    }
  }, [sourceLang, updateStatus, translateText]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    updateStatus("idle");
    setPartialTranscript("");
  }, [updateStatus]);

  // Get audio levels for visualization
  const getAudioLevels = useCallback(() => {
    if (!analyserRef.current) return new Uint8Array(32);
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    return dataArray;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      audioQueueRef.current.forEach(audio => {
        URL.revokeObjectURL(audio.src);
      });
    };
  }, [stopRecording]);

  return {
    status,
    transcripts,
    partialTranscript,
    latency,
    error,
    startRecording,
    stopRecording,
    getAudioLevels,
    isRecording: status === "recording",
  };
}

// Helper to map language names to codes
function getLanguageCode(lang: string): string {
  const codes: Record<string, string> = {
    Tamil: "tam",
    Hindi: "hin",
    Telugu: "tel",
    Bengali: "ben",
    Marathi: "mar",
    Kannada: "kan",
    Malayalam: "mal",
    Gujarati: "guj",
    Punjabi: "pan",
    English: "eng",
  };
  return codes[lang] || "tam";
}
