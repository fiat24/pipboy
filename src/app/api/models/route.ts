import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
    const apiModel = process.env.API_MODEL || 'gpt-4o';

    // Support comma-separated model list: "gpt-5.2,gpt-4o,deepseek-chat"
    const models = apiModel.split(',').map(m => m.trim()).filter(Boolean);

    return NextResponse.json({ models, default: models[0] });
}
