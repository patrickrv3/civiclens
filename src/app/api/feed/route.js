import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Define the shape of our mock data as a fallback or structure reference
// We want OpenAI to return an array of items matching this general structure
const SYSTEM_PROMPT = `You are an expert, neutral, nonpartisan civic analyst.
Your job is to read raw legislative text/summaries and output a JSON array of bills.
For each bill, provide:
- shortTitle: A very short, punchy title for the bill (Max 5-8 words) that is easy for a normal person to read.
- originalTitle: The exact original title provided in the raw text.
- generalSummary: A simple, plain-English summary of what the bill does. Maximum 2 sentences.
- impactLevel: One of "High Impact", "Moderate Impact", or "Low Impact".
- status: Based on the latestAction, classify as one of: "Introduced", "In Committee", "Passed House", "Passed Senate", "Passed Both Chambers", "Signed into Law", or "Failed". Use your best judgment based on the action text.
- latestAction: Pass through the latestAction text exactly as provided.
- tagImpacts: A JSON object where keys are the specific Life Tags provided, and values are a 1-sentence explanation of why this bill matters to someone with that tag. Only include tags that actually have a relevant impact.

Return ONLY valid JSON in the format { "bills": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "url": "...", "type": "Bill", "level": "Federal", "date": "...", "generalSummary": "...", "impactLevel": "...", "status": "...", "latestAction": "...", "tagImpacts": {...}, "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(request) {
    try {
        const { lifeTags, interests, offset } = await request.json();
        const pageOffset = offset || 0;

        // 1. Check for API keys
        if (!process.env.OPENAI_API_KEY || !process.env.CONGRESS_API_KEY) {
            console.warn("Missing API keys. Returning mock data instead.");
            // If no keys, we could return the mock data from Step 3, but for now let's return a specific error
            return NextResponse.json(
                { error: "API Keys missing. Please configure OPENAI_API_KEY and CONGRESS_API_KEY in .env.local" },
                { status: 500 }
            );
        }

        // 2. Fetch Latest Bills from Congress.gov
        const batchSize = 10;
        const congressUrl = "https://api.congress.gov/v3/bill?api_key=" + process.env.CONGRESS_API_KEY + "&limit=" + batchSize + "&offset=" + pageOffset + "&format=json";
        const congressRes = await fetch(congressUrl);

        if (!congressRes.ok) {
            throw new Error(`Congress API Error: ${congressRes.status}`);
        }

        const data = await congressRes.json();
        const bills = data.bills || [];

        // Sort the bills by date from newest to oldest
        bills.sort((a, b) => new Date(b.updateDate) - new Date(a.updateDate));

        // Map Congress API bill types to their Congress.gov URL slug
        const typeSlugMap = {
            'HR': 'house-bill',
            'S': 'senate-bill',
            'HJRES': 'house-joint-resolution',
            'SJRES': 'senate-joint-resolution',
            'HCONRES': 'house-concurrent-resolution',
            'SCONRES': 'senate-concurrent-resolution',
            'HRES': 'house-resolution',
            'SRES': 'senate-resolution',
        };

        // Format the bills to send to OpenAI so it has context to summarize
        const billsTextForAI = bills.map((b) => {
            const congressNum = b.congress || 118;
            const typeUpper = b.type ? b.type.toUpperCase() : "HR";
            const slug = typeSlugMap[typeUpper] || 'house-bill';
            const url = "https://www.congress.gov/bill/" + congressNum + "th-congress/" + slug + "/" + b.number;

            return {
                id: congressNum + "-" + typeUpper.toLowerCase() + "-" + b.number,
                title: b.title,
                latestAction: b.latestAction?.text || "",
                updateDate: b.updateDate,
                url: url
            };
        });

        // 3. Ask OpenAI to generate Summaries and tag Impacts
        const interestsText = interests && interests.length > 0 ? "\n\nThe user is interested in these policy topics: " + interests.join(", ") + ". Please classify and prioritize bills related to these topics with higher impact levels." : "";
        const userPrompt = "Summarize these corresponding bills and generate personalized impacts for the following Life Tags: " + (lifeTags ? lifeTags.join(", ") : "None") + "." + interestsText + "\n\nBills to process:\n" + JSON.stringify(billsTextForAI, null, 2);

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);

        // 4. Return formatted data to the frontend
        const pagination = data.pagination || {};
        const hasMore = (pageOffset + batchSize) < (pagination.count || 0);
        return NextResponse.json({ items: aiResponse.bills, hasMore, nextOffset: pageOffset + batchSize });

    } catch (error) {
        console.error("Error in feed API:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
