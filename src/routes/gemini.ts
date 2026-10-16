import type { Route } from '../types';
import { error } from '../utils/http';
import { checkRateLimit } from '../middleware/rate-limit';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_SYSTEM =
  'Respond with only the final answer. Do not include any reasoning, chain-of-thought, or internal deliberation. Just give the direct response.';

const MODEL = 'gemma-4-26b-a4b-it';
const PROMPT_LIMIT = 8000;

function number(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

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

  const prompt = typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, PROMPT_LIMIT) : '';
  if (!prompt) {
    return error(`Field 'prompt' is required (max ${PROMPT_LIMIT} chars)`, 400);
  }

  const system = typeof body?.system === 'string' && body.system.trim()
    ? body.system.trim().slice(0, 2000)
    : DEFAULT_SYSTEM;
  const temperature = number(body?.temperature, 0, 2, 0.7);
  const maxOutputTokens = Math.round(number(body?.maxTokens, 1, 8192, 2048));
  const jsonMode = body?.json === true;

  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const generativeModel = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  });

  let stream: AsyncGenerator<any> | null = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    try {
      const result = await generativeModel.generateContentStream(prompt);
      stream = result.stream;
      break;
    } catch (e: any) {
      lastErr = e?.message || String(e);
      console.error(`[gemini] stream start attempt ${attempt + 1} failed: ${lastErr.slice(0, 300)}`);
    }
  }

  if (!stream) {
    return error('Upstream generation failed', 502);
  }

  const activeStream = stream;
  const encoder = new TextEncoder();
  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of activeStream) {
          const parts = chunk?.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part && !('thought' in part) && typeof part.text === 'string') {
              controller.enqueue(encoder.encode(part.text));
            }
          }
        }
      } catch (e: any) {
        console.error('[gemini] stream error:', e?.message || String(e));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(output, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Model': MODEL,
      'Access-Control-Expose-Headers': 'X-Model',
    },
  });
};
