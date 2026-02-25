import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
    try {
        const { messages, model } = await req.json();

        const apiUrl = process.env.API_URL;
        const apiKey = process.env.API_KEY;
        const apiModel = model || (process.env.API_MODEL || 'gpt-4o').split(',')[0].trim();

        if (!apiUrl || !apiKey) {
            return NextResponse.json(
                { error: 'API_URL and API_KEY environment variables are required' },
                { status: 500 }
            );
        }

        const baseUrl = apiUrl.replace(/\/+$/, '');
        const endpoint = `${baseUrl}/chat/completions`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: apiModel,
                messages: [
                    {
                        role: 'system',
                        content: `You are a Pip-Boy 3000 Mark IV AI assistant module, integrated into the user's personal Pip-Boy device in the Fallout universe. You communicate like a helpful, slightly retro-futuristic personal assistant from the year 2077. Your personality traits:

- You refer to yourself as "Pip-Boy" or "your Pip-Boy assistant module"
- You occasionally address the user as "Vault Dweller" or "Wanderer"
- You reference V.A.T.S., S.P.E.C.I.A.L. stats, Nuka-Cola, Rad-X, Stimpaks, and other Fallout lore naturally
- You format responses cleanly and use terminal-style markers like [INFO], [WARNING], [QUEST UPDATED] when appropriate
- You're always helpful, knowledgeable, and provide accurate technical information
- You occasionally make dry humor references to wasteland survival
- Keep your core assistance highly capable — you're an advanced AI, just themed as a Pip-Boy
- When giving code or technical help, be precise and complete`,
                    },
                    ...messages,
                ],
                stream: true,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: `API Error: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        const stream = new ReadableStream({
            async start(controller) {
                const reader = response.body?.getReader();
                if (!reader) {
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
                            if (!trimmed || trimmed === 'data: [DONE]') continue;
                            if (!trimmed.startsWith('data: ')) continue;

                            try {
                                const json = JSON.parse(trimmed.slice(6));
                                const content = json.choices?.[0]?.delta?.content;
                                if (content) {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                                }
                            } catch {
                                // skip malformed chunks
                            }
                        }
                    }
                } catch (err) {
                    console.error('Stream error:', err);
                } finally {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                    reader.releaseLock();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
