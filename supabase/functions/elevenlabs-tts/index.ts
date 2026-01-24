import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Voice IDs optimized for clarity in medical settings
const VOICE_IDS = {
  male: "JBFqnCBsd6RMkjVDRZzb", // George - clear male voice
  female: "EXAVITQu4vr4xnSDxMaL", // Sarah - clear female voice
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voice = "female" } = await req.json();
    
    if (!text || text.trim() === "") {
      return new Response(
        JSON.stringify({ error: "No text provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const voiceId = VOICE_IDS[voice as keyof typeof VOICE_IDS] || VOICE_IDS.female;
    const startTime = Date.now();

    // Use turbo model for lowest latency
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5", // Fastest model
          voice_settings: {
            stability: 0.6,
            similarity_boost: 0.75,
            style: 0.2,
            use_speaker_boost: true,
            speed: 1.1, // Slightly faster for urgency
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("TTS error:", response.status, errorText);
      throw new Error(`TTS failed: ${response.status}`);
    }

    const latency = Date.now() - startTime;
    console.log(`TTS latency: ${latency}ms for ${text.length} chars`);

    // Stream the audio response
    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "X-TTS-Latency": latency.toString(),
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
