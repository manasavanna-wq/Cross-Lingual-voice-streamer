import { useCallback, useRef, useState, useEffect } from "react";

const STORAGE_KEY = "trans-web-cloned-voice";
const MIN_SECONDS = 15;
const MAX_SECONDS = 45;

export function useVoiceClone() {
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  const [isSampling, setIsSampling] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [secondsRecorded, setSecondsRecorded] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBlobRef = useRef<Blob | null>(null);
  const secondsRef = useRef(0);

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
    lastBlobRef.current = blob;
    setIsCloning(true);
    setCloneError(null);
    setCanRetry(false);

    const attempt = async () => {
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
        const err = new Error(data?.error || "Could not create your voice") as Error & {
          retryable?: boolean;
        };
        err.retryable = data?.retryable !== false;
        throw err;
      }
      return data.voiceId as string;
    };

    try {
      let voiceId: string;
      try {
        voiceId = await attempt();
      } catch (first) {
        // one silent retry for transient/network failures
        const retryable = (first as { retryable?: boolean }).retryable !== false;
        if (!retryable) throw first;
        await new Promise((r) => setTimeout(r, 1200));
        voiceId = await attempt();
      }
      localStorage.setItem(STORAGE_KEY, voiceId);
      setClonedVoiceId(voiceId);
      setCloneError(null);
      setCanRetry(false);
    } catch (err) {
      const retryable = (err as { retryable?: boolean }).retryable !== false;
      setCanRetry(retryable);
      setCloneError(
        err instanceof Error && err.message
          ? err.message
          : "Could not create your voice. Please check your connection and try again."
      );
    } finally {
      setIsCloning(false);
    }
  }, []);

  const retryUpload = useCallback(() => {
    if (lastBlobRef.current) void uploadSample(lastBlobRef.current);
  }, [uploadSample]);

  const startSampling = useCallback(async () => {
    setCloneError(null);
    setCanRetry(false);
    setSecondsRecorded(0);
    secondsRef.current = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onerror = () => {
        cleanup();
        setIsSampling(false);
        setCloneError("The recording stopped unexpectedly. Please record again.");
        setCanRetry(false);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const seconds = secondsRef.current;
        cleanup();
        setIsSampling(false);

        if (seconds < MIN_SECONDS || blob.size < 10_000) {
          setCloneError(
            `That was only ${seconds}s. Please talk for at least ${MIN_SECONDS} seconds so your voice can be copied.`
          );
          setCanRetry(false);
          return;
        }
        void uploadSample(blob);
      };

      recorder.start(1000);
      setIsSampling(true);

      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSecondsRecorded(secondsRef.current);
        if (secondsRef.current >= MAX_SECONDS) {
          recorderRef.current?.stop();
        }
      }, 1000);
    } catch {
      cleanup();
      setIsSampling(false);
      setCloneError("We couldn't use your microphone. Allow microphone access and try again.");
      setCanRetry(false);
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
    setCloneError(null);
    setCanRetry(false);
  }, []);

  const dismissError = useCallback(() => {
    setCloneError(null);
    setCanRetry(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return {
    clonedVoiceId,
    isSampling,
    isCloning,
    cloneError,
    canRetry,
    secondsRecorded,
    minSeconds: MIN_SECONDS,
    startSampling,
    stopSampling,
    retryUpload,
    clearClone,
    dismissError,
  };
}
