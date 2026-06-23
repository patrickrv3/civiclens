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

const CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour (reduced to refresh summaries with new prompt)
const RATE_LIMIT_MS = 6 * 60 * 60 * 1000; // 6 hours between CourtListener fetches

// CourtListener court IDs
const SCOTUS_COURTS = ['scotus'];
const CIRCUIT_COURTS = [
    'ca1', 'ca2', 'ca3', 'ca4', 'ca5', 'ca6', 'ca7', 'ca8',
    'ca9', 'ca10', 'ca11', 'cadc', 'cafc',
];
// Major state supreme courts
const STATE_SUPREME_COURTS = [
    'cal', 'ny', 'tex', 'fla', 'ill', 'pa', 'ohio', 'ga', 'nc', 'mich',
    'nj', 'va', 'wash', 'mass', 'ariz', 'colo', 'minn', 'wis', 'md', 'ind',
];

// Human-readable court name mapping
const COURT_NAME_MAP = {
    scotus: 'Supreme Court',
    ca1: '1st Circuit', ca2: '2nd Circuit', ca3: '3rd Circuit',
    ca4: '4th Circuit', ca5: '5th Circuit', ca6: '6th Circuit',
    ca7: '7th Circuit', ca8: '8th Circuit', ca9: '9th Circuit',
    ca10: '10th Circuit', ca11: '11th Circuit',
    cadc: 'D.C. Circuit', cafc: 'Federal Circuit',
    // State supreme courts
    cal: 'California Supreme Court', ny: 'New York Court of Appeals',
    tex: 'Texas Supreme Court', fla: 'Florida Supreme Court',
    ill: 'Illinois Supreme Court', pa: 'Pennsylvania Supreme Court',
    ohio: 'Ohio Supreme Court', ga: 'Georgia Supreme Court',
    nc: 'North Carolina Supreme Court', mich: 'Michigan Supreme Court',
    nj: 'New Jersey Supreme Court', va: 'Virginia Supreme Court',
    wash: 'Washington Supreme Court', mass: 'Massachusetts Supreme Judicial Court',
    ariz: 'Arizona Supreme Court', colo: 'Colorado Supreme Court',
    minn: 'Minnesota Supreme Court', wis: 'Wisconsin Supreme Court',
    md: 'Maryland Court of Appeals', ind: 'Indiana Supreme Court',
};

const SYSTEM_PROMPT = `You are an expert, neutral, nonpartisan civic analyst specializing in court rulings.
Your job is to read court opinion data and output a JSON array.
For each ruling, provide:
- id: The exact ID provided.
- shortTitle: A very short, punchy plain-English title (max 6-8 words).
- originalTitle: The exact case name provided.
- generalSummary: A plain-English summary that MUST state what the court actually ruled or decided. The first sentence should clearly state the outcome (e.g., "The court ruled that...", "The judge blocked...", "The court upheld...", "The appeals court reversed..."). The second sentence should explain the real-world impact or what it means. Do NOT just describe what the case is about — tell the reader what happened. Maximum 2 sentences.
- impactLevel: One of "High Impact", "Moderate Impact", or "Low Impact".
- profileLevel: One of "High Profile", "Notable", or "Routine" based on these criteria:
  * "High Profile": Constitutional rights (1st, 2nd, 4th, 14th Amendment), immigration/asylum/deportation, executive power/separation of powers, abortion/reproductive rights, voting rights, gun control, LGBTQ+ rights, cases involving government agencies, cases overturning precedent, cases widely covered in media, district court rulings blocking government policy.
  * "Notable": Significant legal precedent but not front-page news.
  * "Routine": Standard legal proceedings, routine patent disputes, procedural matters.
- topics: An array of relevant topic strings from this list: "Immigration", "First Amendment", "Executive Power", "Civil Rights", "Voting Rights", "Criminal Justice", "Environment", "Healthcare", "Gun Rights", "Labor", "Technology", "Education". Only include genuinely relevant topics.
- court: The human-readable court name provided.
- courtType: The court type provided (one of "scotus", "federal_appeals", "state_supreme", "district").
- status: A specific ruling outcome (e.g., "Blocked", "Upheld", "Reversed", "Injunction Granted", "Affirmed", "Struck Down", "Remanded"). Be specific about what the court did.
- latestAction: A 1-sentence description of the specific ruling action and outcome. State what the judge or court decided, not just that they "reviewed" or "considered" the case.
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

async function checkRateLimitCache() {
    try {
        const ref = doc(db, 'billSummaries', '_court_rate_limit_v5_');
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
 * Fetch opinions from CourtListener. Makes separate queries for SCOTUS and other courts
 * to ensure SCOTUS opinions are always included.
 */
async function fetchFromCourtListener() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const filedAfter = ninetyDaysAgo.toISOString().split('T')[0];

    const fetchWithCourts = async (courts, label) => {
        const params = new URLSearchParams();
        params.append('type', 'o');
        params.append('order_by', 'dateFiled desc');
        params.append('filed_after', filedAfter);
        courts.forEach(court => params.append('court', court));

        const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
        console.log(`CourtListener ${label} URL:`, url);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
            const res = await fetch(url, {
                headers: { Authorization: `Token ${process.env.COURTLISTENER_API_TOKEN}` },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) {
                console.error(`CourtListener ${label} error: ${res.status}`);
                return [];
            }
            const data = await res.json();
            console.log(`CourtListener ${label}: ${(data.results || []).length} results`);
            return data.results || [];
        } catch (err) {
            clearTimeout(timeout);
            console.error(`CourtListener ${label} failed:`, err.message);
            return [];
        }
    };

    // Keyword search for high-profile district court rulings (injunctions, constitutional cases, etc.)
    const fetchHighProfile = async () => {
        const params = new URLSearchParams();
        params.append('type', 'o');
        params.append('order_by', 'dateFiled desc');
        params.append('filed_after', filedAfter);
        params.append('q', '"preliminary injunction" OR "temporary restraining order" OR "unconstitutional" OR "voter rolls" OR "deportation" OR "executive order" OR "struck down" OR "enjoined"');

        const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
        console.log('CourtListener HighProfile URL:', url);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
            const res = await fetch(url, {
                headers: { Authorization: `Token ${process.env.COURTLISTENER_API_TOKEN}` },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) {
                console.error(`CourtListener HighProfile error: ${res.status}`);
                return [];
            }
            const data = await res.json();
            console.log(`CourtListener HighProfile: ${(data.results || []).length} results`);
            return data.results || [];
        } catch (err) {
            clearTimeout(timeout);
            console.error('CourtListener HighProfile failed:', err.message);
            return [];
        }
    };

    // Fetch all 4 queries in parallel
    const [scotusResults, circuitResults, stateResults, highProfileResults] = await Promise.all([
        fetchWithCourts(SCOTUS_COURTS, 'SCOTUS'),
        fetchWithCourts(CIRCUIT_COURTS, 'Circuits'),
        fetchWithCourts(STATE_SUPREME_COURTS, 'State Supreme'),
        fetchHighProfile(),
    ]);

    // Deduplicate by cluster_id across all sources
    const seen = new Set();
    const dedup = (results) => results.filter(r => {
        const key = r.cluster_id || r.id || r.docket_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Prioritize: SCOTUS first, then high-profile, then circuits + state by date
    const scotusSlice = dedup(scotusResults).slice(0, 10);
    const highProfileSlice = dedup(highProfileResults).slice(0, 20);
    const otherResults = dedup([...circuitResults, ...stateResults])
        .sort((a, b) => (b.dateFiled || '').localeCompare(a.dateFiled || ''));
    const otherSlice = otherResults.slice(0, 20);

    const total = [...scotusSlice, ...highProfileSlice, ...otherSlice];
    console.log(`Prioritized: ${scotusSlice.length} SCOTUS + ${highProfileSlice.length} HighProfile + ${otherSlice.length} other = ${total.length} total`);
    return total;
}

function getCourtType(courtId) {
    if (SCOTUS_COURTS.includes(courtId)) return 'scotus';
    if (CIRCUIT_COURTS.includes(courtId)) return 'federal_appeals';
    if (STATE_SUPREME_COURTS.includes(courtId)) return 'state_supreme';
    return 'district'; // Anything not in the above lists is a district/other court
}

function getCourtName(courtId, rawCourtName) {
    return COURT_NAME_MAP[courtId] || rawCourtName || courtId;
}

function shapeOpinion(opinion) {
    const courtId = opinion.court_id || '';
    const courtType = getCourtType(courtId);
    const courtName = getCourtName(courtId, opinion.court);
    const level = STATE_SUPREME_COURTS.includes(courtId) ? 'State' : 'Federal';
    const absoluteUrl = opinion.absolute_url
        ? `https://www.courtlistener.com${opinion.absolute_url}`
        : '';

    return {
        id: `court-${opinion.cluster_id || opinion.id || opinion.docket_id || Date.now()}`,
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
        const { lifeTags, interests, page = 1 } = await request.json();
        const PAGE_SIZE = 10;
        const offset = (page - 1) * PAGE_SIZE;

        // Step 1: Check rate limit
        const { shouldSkip, cachedIds } = await checkRateLimitCache();

        if (shouldSkip && cachedIds.length >= 10) {
            // Paginate through cached IDs
            const pageIds = cachedIds.slice(offset, offset + PAGE_SIZE);
            const cachedResults = await Promise.all(
                pageIds.map(id => getCachedSummary(id))
            );
            const validCached = cachedResults.filter(Boolean);
            console.log(`Rate limit hit: page=${page}, ${pageIds.length} IDs, ${validCached.length} valid cached`);

            if (validCached.length > 0) {
                const scotusCount = validCached.filter(i => i.courtType === 'scotus').length;
                const hasMore = offset + PAGE_SIZE < cachedIds.length;
                return NextResponse.json({ items: validCached, scotusCount, hasMore });
            }
            console.log('Cached IDs found but no valid summaries, re-fetching...');
        } else if (shouldSkip && cachedIds.length > 0 && cachedIds.length < 10) {
            console.log(`Rate limit cache has only ${cachedIds.length} items (partial failure?), re-fetching...`);
        }

        // Step 2: Fetch from CourtListener (all 4 queries in parallel)
        const rawOpinions = await fetchFromCourtListener();
        const allOpinions = rawOpinions.map(shapeOpinion);

        console.log(`Shaped ${allOpinions.length} total opinions`);

        // Only save to rate limit cache if we got a meaningful number of results
        // Prevents partial failures (e.g. only SCOTUS) from blocking future fetches
        const allRulingIds = allOpinions.map(o => o.id);
        if (allRulingIds.length >= 10) {
            saveRateLimitCache(allRulingIds);
        } else {
            console.log(`Only ${allRulingIds.length} results — skipping rate limit cache to allow re-fetch`);
        }

        // Paginate
        const opinionsForProcessing = allOpinions.slice(offset, offset + PAGE_SIZE);
        console.log(`Page ${page}: processing items ${offset}-${offset + opinionsForProcessing.length} of ${allOpinions.length}`);

        // Step 3: Check Firestore cache
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

        console.log(`Cache check: ${cachedItems.length} cached, ${uncached.length} need AI`);

        // Step 4: Process uncached rulings with OpenAI
        let aiItems = [];
        if (uncached.length > 0) {
            const batch = uncached.slice(0, 10);
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
            const interestsText = interests?.length
                ? `\n\nThe user is interested in: ${interests.join(', ')}.`
                : '';
            const userPrompt = `Analyze these court rulings and generate tagImpacts for Life Tags: ${(lifeTags || []).join(', ') || 'None'}.${interestsText}\n\nRulings:\n${JSON.stringify(batch, null, 2)}`;

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

        // Step 5: Combine cached + AI results
        const items = [...cachedItems, ...aiItems];
        items.sort((a, b) => {
            if (a.courtType === 'scotus' && b.courtType !== 'scotus') return -1;
            if (a.courtType !== 'scotus' && b.courtType === 'scotus') return 1;
            return (b.date || '').localeCompare(a.date || '');
        });

        const scotusCount = items.filter(i => i.courtType === 'scotus').length;
        const hasMore = offset + PAGE_SIZE < allOpinions.length;
        console.log(`Final page ${page}: ${items.length} items, hasMore=${hasMore}`);

        return NextResponse.json({ items, scotusCount, hasMore });

    } catch (error) {
        console.error('Court rulings API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
