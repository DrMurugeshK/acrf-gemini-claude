// Node.js serverless runtime (not Edge) — allows up to 60s on Vercel Hobby,
// vs Edge Runtime's hard 25s time-to-first-byte cap. Fixes 504 timeouts on
// longer 12-stage generations.

const MODEL = "gemini-2.5-flash";
const MAX_RETRIES = 2;          // retry transient errors (503/429) before giving up
const RETRY_DELAY_MS = 1500;    // base delay between retries (doubles each attempt)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGemini(geminiBody, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (res.ok) return res;

    // Only retry on transient errors — overloaded (503) or rate-limited (429).
    // Anything else (404 bad model, 400 bad request, 403 auth) fails immediately.
    if ((res.status === 503 || res.status === 429) && attempt < MAX_RETRIES) {
      lastErr = res;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }

    return res; // non-retryable, or retries exhausted — return as-is
  }
  return lastErr;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(200).end();
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY) {
    res.status(500).json({ error: "GEMINI_API_KEY not set" });
    return;
  }

  const body = req.body || {};
  const systemPrompt = body.system || "";
  const messages = body.messages || [];

  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const geminiBody = {
    system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    contents,
    generationConfig: { maxOutputTokens: 8192, temperature: 0.3 }
  };

  let geminiRes;
  try {
    geminiRes = await callGemini(geminiBody, GEMINI_API_KEY);
  } catch (e) {
    res.status(502).json({ error: "Failed to reach Gemini API: " + e.message });
    return;
  }

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    res.status(geminiRes.status).json({ error: err });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();

  const reader = geminiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.write("data: [DONE]\n\n");
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (text) {
              const delta = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } });
              res.write(`data: ${delta}\n\n`);
            }
          } catch {}
        }
      }
    }
  } finally {
    res.end();
  }
}
