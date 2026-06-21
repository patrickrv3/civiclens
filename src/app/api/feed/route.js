import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export const maxDuration = 60; // Allow up to 60s for OpenAI processing of uncached bills

// --- Firebase init (server-side, reuse existing app) ---
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

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

// Check Firestore cache for a single bill
async function getCachedSummary(billId) {
    try {
        const ref = doc(db, 'billSummaries', billId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        // Check TTL
        const age = Date.now() - (data.cachedAt || 0);
        if (age > CACHE_TTL_MS) return null;
        return data;
    } catch {
        return null; // Cache miss on error — just call OpenAI
    }
}

// Store an AI-generated summary in Firestore
async function cacheSummary(billId, summaryData) {
    try {
        const ref = doc(db, 'billSummaries', billId);
        await setDoc(ref, { ...summaryData, cachedAt: Date.now() });
    } catch (err) {
        console.warn('Cache write failed for', billId, err.message);
    }
}

export async function POST(request) {
    try {
        const { lifeTags, interests, offset } = await request.json();
        const pageOffset = offset || 0;

        // 1. Check for API keys
        if (!process.env.OPENAI_API_KEY || !process.env.CONGRESS_API_KEY) {
            return NextResponse.json(
                { error: "API Keys missing. Please configure OPENAI_API_KEY and CONGRESS_API_KEY in .env.local" },
                { status: 500 }
            );
        }

        // 2. Fetch Latest Bills from Congress.gov, sorted by most recently updated
        // sort=updateDate ensures high-profile bills with recent Senate/House votes surface first
        const batchSize = 20;
        const congressUrl = "https://api.congress.gov/v3/bill?api_key=" + process.env.CONGRESS_API_KEY +
            "&limit=" + batchSize +
            "&offset=" + pageOffset +
            "&sort=updateDate" +
            "&sort_direction=desc" +
            "&format=json";
        const congressRes = await fetch(congressUrl);

        if (!congressRes.ok) {
            throw new Error(`Congress API Error: ${congressRes.status}`);
        }

        const data = await congressRes.json();
        const bills = data.bills || [];

        // Bills are already sorted by updateDate desc from the API — no client-side re-sort needed


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

        // Format all bills for lookup / potential AI processing
        const billsForProcessing = bills.map((b) => {
            const congressNum = b.congress || 118;
            const typeUpper = b.type ? b.type.toUpperCase() : "HR";
            const slug = typeSlugMap[typeUpper] || 'house-bill';
            const url = "https://www.congress.gov/bill/" + congressNum + "th-congress/" + slug + "/" + b.number;
            return {
                id: congressNum + "-" + typeUpper.toLowerCase() + "-" + b.number,
                title: b.title,
                latestAction: b.latestAction?.text || "",
                updateDate: b.updateDate,
                url,
            };
        });

        // 3. Check Firestore cache for each bill (in parallel)
        const cacheResults = await Promise.all(
            billsForProcessing.map(b => getCachedSummary(b.id))
        );

        const cachedItems = [];
        const uncachedBills = [];

        billsForProcessing.forEach((bill, i) => {
            if (cacheResults[i]) {
                // Cache hit — use stored summary, attach url from current fetch
                cachedItems.push({ ...cacheResults[i], url: bill.url });
            } else {
                uncachedBills.push(bill);
            }
        });

        // 4. Only call OpenAI for bills not in cache
        let aiItems = [];
        if (uncachedBills.length > 0) {
            const interestsText = interests && interests.length > 0
                ? "\n\nThe user is interested in these policy topics: " + interests.join(", ") + ". Please classify and prioritize bills related to these topics with higher impact levels."
                : "";
            const userPrompt = "Summarize these corresponding bills and generate personalized impacts for the following Life Tags: " + (lifeTags ? lifeTags.join(", ") : "None") + "." + interestsText + "\n\nBills to process:\n" + JSON.stringify(uncachedBills, null, 2);

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Faster and cheaper than gpt-4o
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userPrompt }
                ],
                response_format: { type: "json_object" },
            });

            const aiResponse = JSON.parse(completion.choices[0].message.content);
            aiItems = aiResponse.bills || [];

            // 5. Save new summaries to Firestore cache (fire-and-forget)
            aiItems.forEach(item => {
                if (item.id) {
                    cacheSummary(item.id, {
                        id: item.id,
                        shortTitle: item.shortTitle,
                        originalTitle: item.originalTitle,
                        generalSummary: item.generalSummary,
                        impactLevel: item.impactLevel,
                        status: item.status,
                        latestAction: item.latestAction,
                        type: item.type || 'Bill',
                        level: item.level || 'Federal',
                        date: item.date || '',
                        sponsors: item.sponsors || [],
                        locationMatches: item.locationMatches || [],
                        likes: 0,
                        dislikes: 0,
                        // Note: tagImpacts are user-specific, not cached
                    });
                }
            });
        }

        // 6. Merge cached + fresh items, preserving Congress.gov order
        const allItemsById = new Map();
        [...cachedItems, ...aiItems].forEach(item => {
            if (item.id) allItemsById.set(item.id, item);
        });
        const orderedItems = billsForProcessing
            .map(b => allItemsById.get(b.id))
            .filter(Boolean);

        const pagination = data.pagination || {};
        // pagination.count = items in THIS page (e.g. 10), NOT the total.
        // pagination.next = URL for the next page — only present if more pages exist.
        const hasMore = !!pagination.next;

        console.log(`Feed: ${cachedItems.length} from cache, ${aiItems.length} from OpenAI, hasMore=${hasMore}`);

        return NextResponse.json({ items: orderedItems, hasMore, nextOffset: pageOffset + batchSize });

    } catch (error) {
        console.error("Error in feed API:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
