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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const lastTranslationTimeRef = useRef(0);
  const translationDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTextRef = useRef("");

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
      
      // Only translate if 500ms has passed since last translation
      if (now - lastTranslationTimeRef.current < 500) {
        translationDebounceRef.current = setTimeout(() => {
          translateText(text, false);
        }, 500);
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
        
        // Go back to recording if we're still active
        if (recognitionRef.current && status !== "speaking") {
          updateStatus("recording");
        }
      }
    } catch (err) {
      console.error("Translation error:", err);
      setError("Translation failed");
      updateStatus("recording");
    }
  }, [sourceLang, targetLang, updateStatus, synthesizeSpeech, status]);

  // Start recording using Web Speech API (works in browsers)
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscripts([]);
      setPartialTranscript("");
      accumulatedTextRef.current = "";

      // Get microphone access for visualization
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      streamRef.current = stream;

      // Set up audio analyzer for visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      // Use Web Speech API for speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        throw new Error("Speech recognition not supported in this browser. Please use Chrome or Edge.");
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      
      // Configure recognition
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = getLanguageCode(sourceLang);
      
      recognition.onstart = () => {
        updateStatus("recording");
      };

      recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        // Handle interim results (partial)
        if (interimTranscript) {
          setPartialTranscript(interimTranscript);
          if (interimTranscript.length > 15) {
            translateText(interimTranscript, false);
          }
        }

        // Handle final results (committed)
        if (finalTranscript) {
          setPartialTranscript("");
          translateText(finalTranscript.trim(), true);
        }
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setError("Microphone permission denied");
        } else if (event.error !== "no-speech") {
          setError(`Recognition error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        // Auto-restart if still supposed to be recording
        if (recognitionRef.current && status === "recording") {
          try {
            recognition.start();
          } catch (e) {
            // Already started or stopped
          }
        }
      };

      recognition.start();

    } catch (err) {
      console.error("Recording error:", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
      updateStatus("idle");
    }
  }, [sourceLang, updateStatus, translateText, status]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (translationDebounceRef.current) {
      clearTimeout(translationDebounceRef.current);
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
    isRecording: status !== "idle",
  };
}

// Helper to map language names to BCP-47 codes for Web Speech API
function getLanguageCode(lang: string): string {
  const codes: Record<string, string> = {
    Tamil: "ta-IN",
    Hindi: "hi-IN",
    Telugu: "te-IN",
    Bengali: "bn-IN",
    Marathi: "mr-IN",
    Kannada: "kn-IN",
    Malayalam: "ml-IN",
    Gujarati: "gu-IN",
    Punjabi: "pa-IN",
    English: "en-US",
  };
  return codes[lang] || "ta-IN";
}

// Add type declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionInterface extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInterface;
    webkitSpeechRecognition: new () => SpeechRecognitionInterface;
  }
}
