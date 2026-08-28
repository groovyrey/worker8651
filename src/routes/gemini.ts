import type { Route } from '../types';
import { json, error } from '../utils/http';
import { checkRateLimit } from '../middleware/rate-limit';

export const geminiRoute: Route = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== '/api/groovyrey/gemini' || request.method !== 'POST') return null;

  if (!env.GEMINI_API_KEY) {
    return error('Gemini is not configured', 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(env.DB, ip, 'gemini:POST'))) {
    return error('Rate limit exceeded', 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return error('Request body must be valid JSON', 400);
  }

  const prompt = typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 4000) : '';
  if (!prompt) {
    return error("Field 'prompt' is required (max 4000 chars)", 400);
  }

  const model = env.GEMINI_MODEL || 'gemma-4-26b-a4b-it';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const upstream = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: 'Respond with only the final answer. Do not include any reasoning, chain-of-thought, or internal deliberation. Just give the direct response.' }],
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[gemini] upstream ${upstream.status}: ${detail.slice(0, 500)}`);
    return error('Upstream generation failed', 502);
  }

  const data: any = await upstream.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  // Gemma emits its chain-of-thought as a part carrying a `thought` field.
  // Return only the final-answer parts (no `thought` key).
  const text = parts
    .filter((p: any) => p && 'thought' in p === false)
    .map((p: any) => p?.text || '')
    .join('') || '';
  return json({ model, text });
};
