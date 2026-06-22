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
- impactLevel: One of "High Impact", "Moderate Impact", or "Low Impact". Use these strict criteria:
  * "High Impact": Bills that broadly affect Americans' daily lives — taxes, healthcare, immigration, housing, education, environment, national security, federal spending (appropriations), gun policy, social programs, voting rights, or any bill that has PASSED at least one chamber of Congress.
  * "Moderate Impact": Bills affecting specific industries, regions, or groups — regulatory changes, agency funding, infrastructure for specific areas, amendments to existing programs.
  * "Low Impact": Purely symbolic bills — naming post offices/buildings, commemorative coins, honorary designations, awareness days/months, minor technical corrections with no policy change.
  IMPORTANT: Err toward "High Impact" for any bill dealing with federal money, rights, or services that affect millions of people.
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
        const { lifeTags, interests, offset, sortBy } = await request.json();
        const pageOffset = offset || 0;
        const sortMode = sortBy || 'impact'; // 'impact' | 'recent'

        // 1. Check for API keys
        if (!process.env.OPENAI_API_KEY || !process.env.CONGRESS_API_KEY) {
            return NextResponse.json(
                { error: "API Keys missing. Please configure OPENAI_API_KEY and CONGRESS_API_KEY in .env.local" },
                { status: 500 }
            );
        }

        // 2. Fetch bills from Congress.gov sorted by most recently updated.
        // Fetch a larger pool so we have enough after filtering to current congress
        const fetchSize = 50;
        // Only fetch bills updated in the last 90 days (API-level pre-filter)
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 90);
        const fromDateTime = fromDate.toISOString().split('.')[0] + 'Z';
        const congressUrl = "https://api.congress.gov/v3/bill?api_key=" + process.env.CONGRESS_API_KEY +
            "&limit=" + fetchSize +
            "&offset=" + pageOffset +
            "&fromDateTime=" + fromDateTime +
            "&sort=updateDate" +
            "&sort_direction=desc" +
            "&format=json";
        const congressRes = await fetch(congressUrl);

        if (!congressRes.ok) {
            const errorText = await congressRes.text();
            console.error(`Congress API Error: ${congressRes.status} - ${errorText}`);
            throw new Error(`Congress API Error: ${congressRes.status}`);
        }

        const data = await congressRes.json();
        // Keep only current congress (119th, 2025-2027) and limit to 15 for processing
        const bills = (data.bills || [])
            .filter(b => b.congress >= 119)
            .slice(0, 15);

        // Bills filtered to current congress only

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
                latestActionDate: b.latestAction?.actionDate || b.updateDate,
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

        // 6. Merge cached + fresh items, and attach the real updateDate from Congress.gov
        const allItemsById = new Map();
        [...cachedItems, ...aiItems].forEach(item => {
            if (item.id) allItemsById.set(item.id, item);
        });
        let orderedItems = billsForProcessing
            .map(b => {
                const item = allItemsById.get(b.id);
                if (!item) return null;
                // Attach dates from Congress.gov for accurate sorting and display
                return { ...item, updateDate: b.updateDate, latestActionDate: b.latestActionDate };
            })
            .filter(Boolean);

        // 7. Server-side sort so the client always receives items in the right order.
        // Impact mode: High Impact first so the first cards the user sees are meaningful.
        // Recent mode: preserve the updateDate desc order from Congress.gov.
        if (sortMode === 'impact') {
            const impactRank = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
            orderedItems.sort((a, b) => (impactRank[a.impactLevel] ?? 3) - (impactRank[b.impactLevel] ?? 3));
        }
        // 'recent' order is already correct — no sort needed

        const pagination = data.pagination || {};
        const hasMore = !!pagination.next;

        console.log(`Feed [${sortMode}]: ${cachedItems.length} cached, ${aiItems.length} from AI, hasMore=${hasMore}`);

        return NextResponse.json({ items: orderedItems, hasMore, nextOffset: pageOffset + fetchSize });

    } catch (error) {
        console.error("Error in feed API:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
