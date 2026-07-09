import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export const maxDuration = 60;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

// ── Firebase init ──
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

const TAG_IMPACT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a stable hash key for a set of lifeTags.
 * Users with the same tags share the same cache.
 */
function tagHash(lifeTags) {
    return (lifeTags || []).map(t => t.toLowerCase().trim()).sort().join('_') || 'none';
}

/**
 * Get cached tagImpacts for a specific bill + tag combination.
 */
async function getCachedImpacts(billId, hash) {
    try {
        const snap = await getDoc(doc(db, 'tagImpactCache', `${billId}_${hash}`));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (Date.now() - (data.cachedAt || 0) > TAG_IMPACT_TTL_MS) return null;
        return data.impacts || null;
    } catch { return null; }
}

/**
 * Cache tagImpacts for a specific bill + tag combination.
 */
async function cacheImpacts(billId, hash, impacts) {
    try {
        await setDoc(doc(db, 'tagImpactCache', `${billId}_${hash}`), {
            impacts,
            cachedAt: Date.now(),
        });
    } catch (e) {
        console.warn('[Personalize] Cache write failed:', e.message);
    }
}

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

        if (!bills || bills.length === 0) {
            return NextResponse.json({ impacts: {} });
        }

        const hash = tagHash(lifeTags);

        // Check cache first — users with the same lifeTags share cached results
        const cachedResults = {};
        const uncachedBills = [];

        await Promise.all(bills.map(async (b) => {
            const cached = await getCachedImpacts(b.id, hash);
            if (cached) {
                cachedResults[b.id] = cached;
            } else {
                uncachedBills.push(b);
            }
        }));

        console.log(`[Personalize] ${bills.length} bills, ${Object.keys(cachedResults).length} cached, ${uncachedBills.length} need AI (tags: ${hash})`);

        // If everything is cached, return immediately (no AI call!)
        if (uncachedBills.length === 0) {
            return NextResponse.json({ impacts: cachedResults });
        }

        // Build a focused prompt just for uncached bills
        const billSummaries = uncachedBills.map(b => ({
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
        }, { signal: AbortSignal.timeout(30000) });

        let aiResponse;
        try {
            aiResponse = JSON.parse(completion.choices[0].message.content);
        } catch (parseErr) {
            console.warn('[Personalize] Failed to parse AI response:', parseErr.message);
            return NextResponse.json({ impacts: cachedResults });
        }

        const aiImpacts = aiResponse.impacts || {};

        // Cache the new AI results (fire-and-forget is OK here since we return them anyway)
        const cachePromises = Object.entries(aiImpacts).map(([billId, impacts]) =>
            cacheImpacts(billId, hash, impacts)
        );
        await Promise.all(cachePromises);

        // Merge cached + new results
        const allImpacts = { ...cachedResults, ...aiImpacts };

        return NextResponse.json({ impacts: allImpacts });

    } catch (error) {
        console.error("Error in personalize API:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
