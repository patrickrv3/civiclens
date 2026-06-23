import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export const maxDuration = 60; // Allow up to 60s for OpenAI processing

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
const RATE_LIMIT_MS = 6 * 60 * 60 * 1000; // 6 hours between CourtListener fetches
const MAX_OPINIONS = 8; // Cap to stay within Vercel 60s timeout

// CourtListener court IDs
const SCOTUS_COURTS = ['scotus'];
const CIRCUIT_COURTS = [
    'ca1', 'ca2', 'ca3', 'ca4', 'ca5', 'ca6', 'ca7', 'ca8',
    'ca9', 'ca10', 'ca11', 'cadc', 'cafc',
];
const ALL_COURTS = [...SCOTUS_COURTS, ...CIRCUIT_COURTS];

// Human-readable court name mapping
const COURT_NAME_MAP = {
    scotus: 'Supreme Court',
    ca1: '1st Circuit',
    ca2: '2nd Circuit',
    ca3: '3rd Circuit',
    ca4: '4th Circuit',
    ca5: '5th Circuit',
    ca6: '6th Circuit',
    ca7: '7th Circuit',
    ca8: '8th Circuit',
    ca9: '9th Circuit',
    ca10: '10th Circuit',
    ca11: '11th Circuit',
    cadc: 'D.C. Circuit',
    cafc: 'Federal Circuit',
};

const SYSTEM_PROMPT = `You are an expert, neutral, nonpartisan civic analyst specializing in court rulings.
Your job is to read court opinion data and output a JSON array.
For each ruling, provide:
- id: The exact ID provided.
- shortTitle: A very short, punchy plain-English title (max 6-8 words).
- originalTitle: The exact case name provided.
- generalSummary: A simple, plain-English summary of what the ruling decided. Maximum 2 sentences.
- impactLevel: One of "High Impact", "Moderate Impact", or "Low Impact".
- profileLevel: One of "High Profile", "Notable", or "Routine" based on these criteria:
  * "High Profile": Constitutional rights (1st, 2nd, 4th, 14th Amendment), immigration/asylum/deportation, executive power/separation of powers, abortion/reproductive rights, voting rights, gun control, LGBTQ+ rights, cases involving government agencies, cases overturning precedent, cases widely covered in media, district court rulings blocking government policy.
  * "Notable": Significant legal precedent but not front-page news.
  * "Routine": Standard legal proceedings.
- topics: An array of relevant topic strings from this list: "Immigration", "First Amendment", "Executive Power", "Civil Rights", "Voting Rights", "Criminal Justice", "Environment", "Healthcare", "Gun Rights", "Labor", "Technology", "Education". Only include genuinely relevant topics.
- court: The human-readable court name provided.
- courtType: The court type provided (one of "scotus", "federal_appeals", "state_supreme", "district").
- status: A brief ruling outcome text (e.g., "Affirmed", "Reversed", "Remanded", "Injunction Granted").
- latestAction: A brief 1-sentence description of the ruling action.
- tagImpacts: A JSON object where keys are the specific Life Tags provided, and values are a 1-sentence explanation of why this ruling matters to someone with that tag. Only include tags with a genuine impact.
- type: Always "Court Ruling".
- level: Use the level value provided ("Federal" or "State").
- url: The URL provided.
- date: The date provided.

Return ONLY valid JSON in the format:
{ "rulings": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "generalSummary": "...", "impactLevel": "...", "profileLevel": "...", "topics": [], "court": "...", "courtType": "...", "status": "...", "latestAction": "...", "tagImpacts": {}, "type": "Court Ruling", "level": "...", "url": "...", "date": "...", "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

async function getCachedSummary(id) {
    try {
        const ref = doc(db, 'billSummaries', id);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        if (Date.now() - (data.cachedAt || 0) > CACHE_TTL_MS) return null;
        return data;
    } catch {
        return null;
    }
}

async function cacheSummary(id, data) {
    try {
        await setDoc(doc(db, 'billSummaries', id), { ...data, cachedAt: Date.now() });
    } catch (err) {
        console.warn('Court ruling cache write failed:', err.message);
    }
}

/**
 * Check if we should skip the CourtListener API call and return cached ruling IDs.
 * Returns { shouldSkip: boolean, cachedIds: string[] }
 */
async function checkRateLimitCache() {
    try {
        const ref = doc(db, 'billSummaries', '_court_rate_limit_');
        const snap = await getDoc(ref);
        if (!snap.exists()) return { shouldSkip: false, cachedIds: [] };
        const data = snap.data();
        const elapsed = Date.now() - (data.fetchedAt || 0);
        if (elapsed < RATE_LIMIT_MS) {
            return { shouldSkip: true, cachedIds: data.rulingIds || [] };
        }
        return { shouldSkip: false, cachedIds: [] };
    } catch {
        return { shouldSkip: false, cachedIds: [] };
    }
}

/**
 * Save the list of ruling IDs + timestamp for rate limiting.
 */
async function saveRateLimitCache(rulingIds) {
    try {
        await setDoc(doc(db, 'billSummaries', '_court_rate_limit_'), {
            rulingIds,
            fetchedAt: Date.now(),
        });
    } catch (err) {
        console.warn('Rate limit cache write failed:', err.message);
    }
}

/**
 * Fetch opinions from CourtListener Search API.
 */
async function fetchFromCourtListener() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const filedAfter = ninetyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

    const params = new URLSearchParams();
    params.append('type', 'o');
    params.append('order_by', 'dateFiled desc');
    params.append('filed_after', filedAfter);

    // Add each court as a separate param
    ALL_COURTS.forEach(court => params.append('court', court));

    const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;

    const res = await fetch(url, {
        headers: {
            Authorization: `Token ${process.env.COURTLISTENER_API_TOKEN}`,
        },
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error(`CourtListener API error: ${res.status} - ${errText.substring(0, 200)}`);
        throw new Error(`CourtListener API error: ${res.status}`);
    }

    const data = await res.json();
    return data.results || [];
}

/**
 * Determine court type from court ID.
 */
function getCourtType(courtId) {
    if (SCOTUS_COURTS.includes(courtId)) return 'scotus';
    if (CIRCUIT_COURTS.includes(courtId)) return 'federal_appeals';
    return 'federal_appeals'; // fallback for included courts
}

/**
 * Get human-readable court name.
 */
function getCourtName(courtId, rawCourtName) {
    return COURT_NAME_MAP[courtId] || rawCourtName || courtId;
}

/**
 * Shape a raw CourtListener result into our processing format.
 */
function shapeOpinion(opinion) {
    const courtId = opinion.court_id || '';
    const courtType = getCourtType(courtId);
    const courtName = getCourtName(courtId, opinion.court);
    const level = courtId.startsWith('state') ? 'State' : 'Federal';
    const absoluteUrl = opinion.absolute_url
        ? `https://www.courtlistener.com${opinion.absolute_url}`
        : '';

    return {
        id: `court-${opinion.id || opinion.cluster_id || opinion.docket_id || Date.now()}`,
        caseName: opinion.caseName || opinion.case_name || '',
        court: courtName,
        courtType,
        level,
        date: opinion.dateFiled || opinion.date_filed || '',
        url: absoluteUrl,
        snippet: opinion.snippet || '',
        docketNumber: opinion.docketNumber || opinion.docket_number || '',
        suitNature: opinion.suitNature || opinion.suit_nature || '',
        citeCount: opinion.citeCount || opinion.citation_count || 0,
    };
}

export async function POST(request) {
    try {
        const { lifeTags, interests } = await request.json();

        // Step 1: Check rate limit — should we call CourtListener or use cached IDs?
        const { shouldSkip, cachedIds } = await checkRateLimitCache();

        let opinionsForProcessing = [];

        if (shouldSkip && cachedIds.length > 0) {
            // Use cached ruling IDs — resolve them from billSummaries cache
            const cachedResults = await Promise.all(
                cachedIds.map(id => getCachedSummary(id))
            );
            const validCached = cachedResults.filter(Boolean);

            if (validCached.length > 0) {
                // All items are already cached, return them directly
                const scotusCount = validCached.filter(
                    item => item.courtType === 'scotus'
                ).length;
                return NextResponse.json({ items: validCached, scotusCount });
            }

            // Cached IDs exist but summaries expired — fall through to re-fetch
        }

        // Step 2: Fetch from CourtListener
        const rawOpinions = await fetchFromCourtListener();

        // Shape and limit to MAX_OPINIONS
        opinionsForProcessing = rawOpinions
            .slice(0, MAX_OPINIONS)
            .map(shapeOpinion);

        // Save ruling IDs for rate limiting
        const rulingIds = opinionsForProcessing.map(o => o.id);
        saveRateLimitCache(rulingIds); // fire-and-forget

        // Step 3: Check Firestore cache in parallel
        const cacheResults = await Promise.all(
            opinionsForProcessing.map(o => getCachedSummary(o.id))
        );

        const cachedItems = [];
        const uncached = [];

        opinionsForProcessing.forEach((opinion, i) => {
            if (cacheResults[i]) {
                cachedItems.push({ ...cacheResults[i], url: opinion.url });
            } else {
                uncached.push(opinion);
            }
        });

        // Step 4: Process uncached rulings with OpenAI
        let aiItems = [];
        if (uncached.length > 0) {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
            const interestsText = interests?.length
                ? `\n\nThe user is interested in: ${interests.join(', ')}.`
                : '';
            const userPrompt = `Analyze these court rulings and generate tagImpacts for Life Tags: ${(lifeTags || []).join(', ') || 'None'}.${interestsText}\n\nRulings:\n${JSON.stringify(uncached, null, 2)}`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                response_format: { type: 'json_object' },
            });

            const parsed = JSON.parse(completion.choices[0].message.content);
            aiItems = parsed.rulings || [];

            // Cache fire-and-forget
            aiItems.forEach(item => {
                if (item.id) {
                    cacheSummary(item.id, {
                        id: item.id,
                        shortTitle: item.shortTitle,
                        originalTitle: item.originalTitle,
                        generalSummary: item.generalSummary,
                        impactLevel: item.impactLevel,
                        profileLevel: item.profileLevel,
                        topics: item.topics || [],
                        court: item.court,
                        courtType: item.courtType,
                        status: item.status || '',
                        latestAction: item.latestAction || '',
                        type: 'Court Ruling',
                        level: item.level || 'Federal',
                        date: item.date || '',
                        url: item.url || '',
                        sponsors: [],
                        locationMatches: [],
                        likes: 0,
                        dislikes: 0,
                    });
                }
            });
        }

        // Step 5: Merge cached + AI results preserving order
        const allById = new Map();
        [...cachedItems, ...aiItems].forEach(item => {
            if (item.id) allById.set(item.id, item);
        });
        const items = opinionsForProcessing
            .map(o => allById.get(o.id))
            .filter(Boolean);

        // Count SCOTUS rulings for frontend free-tier filtering
        const scotusCount = items.filter(
            item => item.courtType === 'scotus'
        ).length;

        return NextResponse.json({ items, scotusCount });

    } catch (error) {
        console.error('Court rulings API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
