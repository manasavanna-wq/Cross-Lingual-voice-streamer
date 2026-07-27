import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_LANGS = [
  "Tamil", "Hindi", "Telugu", "Bengali", "Marathi",
  "Kannada", "Malayalam", "Gujarati", "Punjabi", "English",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  try {
    // Require Authorization header (JWT verified by verify_jwt=true at platform)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { text, sourceLang, targetLang } = body as {
      text?: unknown; sourceLang?: unknown; targetLang?: unknown;
    };

    if (typeof text !== "string" || text.trim() === "") {
      return new Response(
        JSON.stringify({ translatedText: "", isPartial: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (text.length > 5000) {
      return new Response(
        JSON.stringify({ error: "Text must be 5000 characters or fewer" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (
      typeof sourceLang !== "string" || typeof targetLang !== "string" ||
      !VALID_LANGS.includes(sourceLang) || !VALID_LANGS.includes(targetLang)
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid language selection" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error(`[${requestId}] LOVABLE_API_KEY not configured`);
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable", requestId }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startTime = Date.now();

    const systemPrompt = `You are a real-time medical interpreter. Translate the following ${sourceLang} speech fragment to ${targetLang}.

CRITICAL RULES:
1. Translate IMMEDIATELY - even partial sentences
2. Preserve medical terminology accuracy
3. Keep the same tone and urgency
4. If text is incomplete, translate what you have
5. Return ONLY the translation, no explanations
6. For medical terms, use standard English medical terminology`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[${requestId}] AI gateway error:`, response.status, errorText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Service is busy, please try again", requestId }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable", requestId }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Unable to process request", requestId }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content || "";
    const latency = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        translatedText: translatedText.trim(),
        latency,
        isPartial: text.length < 50,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[${requestId}] Translate error:`, error);
    return new Response(
      JSON.stringify({ error: "Unable to process request", requestId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
