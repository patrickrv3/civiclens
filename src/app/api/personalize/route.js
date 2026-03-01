import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(request) {
    try {
        const { bills, lifeTags } = await request.json();

        if (!process.env.OPENAI_API_KEY) {
            return NextResponse.json(
                { error: "OpenAI API Key missing." },
                { status: 500 }
            );
        }

        if (!lifeTags || lifeTags.length === 0) {
            return NextResponse.json({ impacts: {} });
        }

        // Build a focused prompt just for tag impacts
        const billSummaries = bills.map(b => ({
            id: b.id,
            shortTitle: b.shortTitle || b.title,
            generalSummary: b.generalSummary
        }));

        const prompt = "Given the following bills and their summaries, generate personalized impact statements for ONLY these Life Tags: " + lifeTags.join(", ") + ".\n\nFor each bill, return a tagImpacts object where keys are Life Tags and values are a single sentence explaining why the bill matters to someone with that tag. Only include tags that actually have a relevant impact.\n\nReturn ONLY valid JSON in the format: { \"impacts\": { \"bill_id\": { \"TagName\": \"impact sentence\" } } }\n\nBills:\n" + JSON.stringify(billSummaries, null, 2);

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a neutral, nonpartisan civic analyst. Return only valid JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);

        return NextResponse.json({ impacts: aiResponse.impacts || {} });

    } catch (error) {
        console.error("Error in personalize API:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
