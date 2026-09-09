import { useCallback, useRef, useState, useEffect } from "react";

const STORAGE_KEY = "trans-web-cloned-voice";

export function useVoiceClone() {
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  const [isSampling, setIsSampling] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [secondsRecorded, setSecondsRecorded] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setClonedVoiceId(saved);
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const uploadSample = useCallback(async (blob: Blob) => {
    setIsCloning(true);
    setCloneError(null);
    try {
      const form = new FormData();
      form.append("sample", blob, "sample.webm");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-clone-voice`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: form,
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.voiceId) {
        throw new Error(data?.error || "Could not create your voice");
      }

      localStorage.setItem(STORAGE_KEY, data.voiceId);
      setClonedVoiceId(data.voiceId);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Could not create your voice");
    } finally {
      setIsCloning(false);
    }
  }, []);

  const startSampling = useCallback(async () => {
    setCloneError(null);
    setSecondsRecorded(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        cleanup();
        setIsSampling(false);
        void uploadSample(blob);
      };

      recorder.start();
      setIsSampling(true);

      timerRef.current = setInterval(() => {
        setSecondsRecorded((s) => {
          if (s + 1 >= 45) {
            recorderRef.current?.stop();
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      cleanup();
      setIsSampling(false);
      setCloneError("Microphone permission denied");
    }
  }, [cleanup, uploadSample]);

  const stopSampling = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      cleanup();
      setIsSampling(false);
    }
  }, [cleanup]);

  const clearClone = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setClonedVoiceId(null);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return {
    clonedVoiceId,
    isSampling,
    isCloning,
    cloneError,
    secondsRecorded,
    startSampling,
    stopSampling,
    clearClone,
  };
}
