import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 8 * 1024 * 1024; // 8MB sample cap

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      console.error(`[${requestId}] ELEVENLABS_API_KEY not configured`);
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable", requestId }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("sample");

    if (!(file instanceof File)) {
      return new Response(
        JSON.stringify({ error: "No voice sample provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size < 10_000) {
      return new Response(
        JSON.stringify({ error: "Voice sample is too short. Please speak for at least 15 seconds." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: "Voice sample is too large" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const upstream = new FormData();
    upstream.append("name", `trans-web-${requestId.slice(0, 8)}`);
    upstream.append("remove_background_noise", "true");
    upstream.append("files", file, "sample.webm");

    const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      body: upstream,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[${requestId}] Voice clone error:`, response.status, errorText);

      let code = "";
      try {
        code = JSON.parse(errorText)?.detail?.status || JSON.parse(errorText)?.detail?.code || "";
      } catch { /* not json */ }

      let message = "Something went wrong making your voice. Please try again.";
      let retryable = true;

      if (code === "can_not_use_instant_voice_cloning" || code === "paid_plan_required") {
        message =
          "Making a copy of your voice needs a paid plan on the voice service. Your translations will keep using the standard voice.";
        retryable = false;
      } else if (code === "voice_limit_reached") {
        message = "The voice service has reached its saved-voice limit. Remove an old voice and try again.";
      } else if (code === "invalid_audio" || response.status === 422) {
        message = "That recording was too quiet or unclear. Find a quiet spot and record again.";
      } else if (response.status === 401 || response.status === 403) {
        message = "The voice service rejected the request. Please try again later.";
        retryable = false;
      } else if (response.status === 429) {
        message = "The voice service is busy right now. Wait a moment and try again.";
      }

      return new Response(
        JSON.stringify({ error: message, retryable, requestId }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    if (!data?.voice_id) {
      console.error(`[${requestId}] Voice clone: missing voice_id`, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Unable to create the voice right now.", requestId }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ voiceId: data.voice_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[${requestId}] Clone error:`, error);
    return new Response(
      JSON.stringify({ error: "Unable to process request", requestId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
