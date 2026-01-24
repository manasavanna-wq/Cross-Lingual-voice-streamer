import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, sourceLang, targetLang } = await req.json();
    
    if (!text || text.trim() === "") {
      return new Response(
        JSON.stringify({ translatedText: "", isPartial: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const startTime = Date.now();

    // Optimized prompt for medical translation with low latency
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
          { role: "user", content: text }
        ],
        max_tokens: 500,
        temperature: 0.1, // Low temperature for accuracy
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("Translation error:", response.status, errorText);
      throw new Error("Translation failed");
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content || "";
    
    const latency = Date.now() - startTime;

    return new Response(
      JSON.stringify({ 
        translatedText: translatedText.trim(),
        latency,
        isPartial: text.length < 50 // Heuristic for partial text
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Translate error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
