import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
const REQUEST_TIMEOUT_MS = 45000;
const SYSTEM_PROMPT = `You are a Pip-Boy 3000 Mark IV AI assistant module, integrated into the user's personal Pip-Boy device in the Fallout universe. You communicate like a helpful, slightly retro-futuristic personal assistant from the year 2077. Your personality traits:

- You refer to yourself as "Pip-Boy" or "your Pip-Boy assistant module"
- You occasionally address the user as "Vault Dweller" or "Wanderer"
- You reference V.A.T.S., S.P.E.C.I.A.L. stats, Nuka-Cola, Rad-X, Stimpaks, and other Fallout lore naturally
- You format responses cleanly and use terminal-style markers like [INFO], [WARNING], [QUEST UPDATED] when appropriate
- You're always helpful, knowledgeable, and provide accurate technical information
- You occasionally make dry humor references to wasteland survival
- Keep your core assistance highly capable — you're an advanced AI, just themed as a Pip-Boy
- When giving code or technical help, be precise and complete`;

type OpenAIChoice = {
  message?: { content?: unknown };
  delta?: { content?: unknown };
  text?: unknown;
};

const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isChatRole(value: unknown): value is 'user' | 'assistant' | 'system' {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function resolveChatEndpoint(apiUrl: string) {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function extractChoiceContent(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const withChoices = payload as { choices?: unknown; output_text?: unknown };

  if (typeof withChoices.output_text === 'string' && withChoices.output_text.trim()) {
    return withChoices.output_text;
  }

  if (!Array.isArray(withChoices.choices) || withChoices.choices.length === 0) {
    return '';
  }

  const first = withChoices.choices[0] as OpenAIChoice;
  return pickString(first.delta?.content, first.message?.content, first.text);
}

async function readUpstreamError(response: Response) {
  const bodyText = await response.text().catch(() => '');
  if (!bodyText) {
    return `Upstream returned ${response.status} without error body`;
  }

  try {
    const payload = JSON.parse(bodyText) as { error?: unknown; message?: unknown };
    const nestedMessage =
      payload.error && typeof payload.error === 'object'
        ? (payload.error as { message?: unknown }).message
        : undefined;
    const detail = pickString(payload.error, payload.message, nestedMessage);
    if (detail) return detail;
  } catch {
    // not JSON, use plain text below
  }

  const compact = bodyText.replace(/\s+/g, ' ').trim();
  return compact.length > 420 ? `${compact.slice(0, 417)}...` : compact;
}

function makeSseFromText(content: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      if (content) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, { headers: sseHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { messages?: unknown; model?: unknown } | null;

    const inputMessages = Array.isArray(body?.messages)
      ? body.messages
        .filter(
          (item): item is { role: unknown; content: unknown } =>
            !!item &&
            typeof item === 'object' &&
            'role' in item &&
            'content' in item
        )
        .map((item) => ({
          role: typeof item.role === 'string' ? item.role.trim() : '',
          content: typeof item.content === 'string' ? item.content.trim() : '',
        }))
        .filter(
          (item): item is { role: 'user' | 'assistant' | 'system'; content: string } =>
            isChatRole(item.role) && item.content.length > 0
        )
      : [];

    const selectedModel = typeof body?.model === 'string' ? body.model.trim() : '';
    const apiUrl = process.env.API_URL;
    const apiKey = process.env.API_KEY;
    const apiModel = selectedModel || (process.env.API_MODEL || 'gpt-4o').split(',')[0].trim();

    if (!apiUrl || !apiKey) {
      return NextResponse.json(
        { error: 'Missing environment variables: API_URL and API_KEY are required.' },
        { status: 500 }
      );
    }

    const endpoint = resolveChatEndpoint(apiUrl);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: apiModel,
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT,
            },
            ...inputMessages,
          ],
          stream: true,
          temperature: 0.7,
        }),
        signal: abort.signal,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown fetch error';
      return NextResponse.json(
        {
          error: `Upstream request failed: ${detail}`,
          hint: 'Check API_URL reachability from Vercel and API_KEY/API_MODEL values.',
        },
        { status: 502 }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const detail = await readUpstreamError(upstream);
      return NextResponse.json(
        {
          error: `Upstream API error (${upstream.status}): ${detail}`,
          endpoint,
        },
        { status: upstream.status }
      );
    }

    const upstreamType = upstream.headers.get('content-type') || '';
    if (upstreamType.includes('application/json')) {
      const payload = await upstream.json().catch(() => null);
      const content = extractChoiceContent(payload);
      return makeSseFromText(content);
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Upstream response body was empty.' })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;

              let payload: unknown = null;
              try {
                payload = JSON.parse(trimmed.slice(6));
              } catch {
                payload = null;
              }
              if (!payload) continue;

              const content = extractChoiceContent(payload);
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
              }
            }
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unknown stream error';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `Stream error: ${detail}` })}\n\n`));
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
  } catch (error) {
    console.error('Chat API error:', error);
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Internal server error: ${detail}` },
      { status: 500 }
    );
  }
}
