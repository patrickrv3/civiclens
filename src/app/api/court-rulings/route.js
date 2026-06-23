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
        const ref = doc(db, 'billSummaries', '_court_rate_limit_v6_');
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
 * Fetch from CourtListener with a single query.
 */
async function fetchCL(params, label) {
    const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
    console.log(`CourtListener ${label}:`, url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

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
}

/**
 * Fetch opinions from CourtListener using 2 queries (not 4) to avoid rate limits:
 *   1. All named courts (SCOTUS + circuits + state) in one query
 *   2. Keyword search for high-profile district court rulings
 *
 * Then smart-distribute into 50 slots.
 */
async function fetchFromCourtListener() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const filedAfter = ninetyDaysAgo.toISOString().split('T')[0];

    // Query 1: All named courts in ONE request
    const allNamedCourts = [...SCOTUS_COURTS, ...CIRCUIT_COURTS, ...STATE_SUPREME_COURTS];
    const courtsParams = new URLSearchParams();
    courtsParams.append('type', 'o');
    courtsParams.append('order_by', 'dateFiled desc');
    courtsParams.append('filed_after', filedAfter);
    allNamedCourts.forEach(c => courtsParams.append('court', c));

    const courtsResults = await fetchCL(courtsParams, 'AllCourts');

    // Small delay to avoid rate limit before second request
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Query 2: Keyword search for high-profile (catches district courts)
    const hpParams = new URLSearchParams();
    hpParams.append('type', 'o');
    hpParams.append('order_by', 'dateFiled desc');
    hpParams.append('filed_after', filedAfter);
    hpParams.append('q', '"preliminary injunction" OR "temporary restraining order" OR "unconstitutional" OR "voter rolls" OR "deportation" OR "executive order" OR "struck down" OR "enjoined"');

    const hpResults = await fetchCL(hpParams, 'HighProfile');

    // Deduplicate all results
    const seen = new Set();
    const allResults = [...courtsResults, ...hpResults].filter(r => {
        const key = r.cluster_id || r.id || r.docket_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Categorize by court type
    const buckets = { scotus: [], federal_appeals: [], state_supreme: [], district: [] };
    for (const r of allResults) {
        const courtId = r.court_id || '';
        let type;
        if (SCOTUS_COURTS.includes(courtId)) type = 'scotus';
        else if (CIRCUIT_COURTS.includes(courtId)) type = 'federal_appeals';
        else if (STATE_SUPREME_COURTS.includes(courtId)) type = 'state_supreme';
        else type = 'district';
        buckets[type].push(r);
    }

    // Sort each bucket by date (newest first)
    for (const key of Object.keys(buckets)) {
        buckets[key].sort((a, b) => (b.dateFiled || '').localeCompare(a.dateFiled || ''));
    }

    console.log(`Buckets: SCOTUS=${buckets.scotus.length}, Circuit=${buckets.federal_appeals.length}, State=${buckets.state_supreme.length}, District=${buckets.district.length}`);

    // Smart distribution: allocate 50 slots
    const TOTAL = 50;
    const targets = {
        scotus: 10,
        federal_appeals: 15,
        state_supreme: 10,
        district: 15,
    };

    // First pass: fill each bucket up to its target
    const selected = [];
    let remaining = TOTAL;
    const leftover = {};

    for (const [type, target] of Object.entries(targets)) {
        const available = buckets[type].slice(0, target);
        selected.push(...available);
        remaining -= available.length;
        leftover[type] = buckets[type].slice(available.length); // unused from this bucket
        console.log(`  ${type}: wanted ${target}, got ${available.length}`);
    }

    // Second pass: redistribute unused slots
    if (remaining > 0) {
        // Priority order for redistribution: district → circuit → state → scotus
        const redistOrder = ['district', 'federal_appeals', 'state_supreme', 'scotus'];
        for (const type of redistOrder) {
            if (remaining <= 0) break;
            const extra = leftover[type].slice(0, remaining);
            selected.push(...extra);
            remaining -= extra.length;
            if (extra.length > 0) console.log(`  Redistributed ${extra.length} from ${type}`);
        }
    }

    console.log(`Smart distribution: ${selected.length} total selected`);
    return selected;
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
