import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const SYSTEM_PROMPT = `You are CivicLens AI — a friendly, nonpartisan civic research assistant.

Your role:
- Explain laws, bills, policies, and government actions in simple, plain English
- Give personalized context based on the user's profile (location, life situation, interests)
- Be neutral and factual — never take political sides
- When relevant, link to Congress.gov: https://www.congress.gov/bill/{congress}th-congress/{type-slug}/{number}
- Keep responses concise but thorough (aim for 2-4 paragraphs max)
- After your response, suggest 2-3 follow-up questions the user might want to ask, formatted as a bulleted list under "**You might also want to ask:**"

If the user's profile info is available, tailor your response to their situation. For example, if they're a renter, explain how housing bills affect renters specifically.

Always be encouraging and make civic topics feel accessible, not intimidating.`;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(request) {
    try {
        const { messages, profile } = await request.json();

        if (!process.env.OPENAI_API_KEY) {
            return NextResponse.json(
                { error: 'OpenAI API key not configured.' },
                { status: 500 }
            );
        }

        // Build a profile context string for the AI
        let profileContext = '';
        if (profile) {
            const parts = [];
            if (profile.zipCode) parts.push(`Location: ${profile.zipCode}`);
            if (profile.lifeTags?.length) parts.push(`Life situation: ${profile.lifeTags.join(', ')}`);
            if (profile.interests?.length) parts.push(`Policy interests: ${profile.interests.join(', ')}`);
            if (parts.length > 0) {
                profileContext = `\n\nUser profile:\n${parts.join('\n')}`;
            }
        }

        const systemMessage = SYSTEM_PROMPT + profileContext;

        // Build the messages array for OpenAI
        const chatMessages = [
            { role: 'system', content: systemMessage },
            ...messages.map(m => ({ role: m.role, content: m.content }))
        ];

        // Stream the response
        const stream = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: chatMessages,
            stream: true,
        });

        // Create a ReadableStream for the SSE response
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of stream) {
                        const content = chunk.choices[0]?.delta?.content || '';
                        if (content) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                        }
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                } catch (err) {
                    controller.error(err);
                }
            }
        });

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
