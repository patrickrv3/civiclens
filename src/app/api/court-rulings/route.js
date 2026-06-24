import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export const maxDuration = 60;

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
const RATE_LIMIT_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 10;

// Court lists
const SCOTUS_COURTS = ['scotus'];
const CIRCUIT_COURTS = [
    'ca1', 'ca2', 'ca3', 'ca4', 'ca5', 'ca6', 'ca7', 'ca8',
    'ca9', 'ca10', 'ca11', 'cadc', 'cafc',
];

const COURT_NAME_MAP = {
    scotus: 'Supreme Court',
    ca1: '1st Circuit', ca2: '2nd Circuit', ca3: '3rd Circuit',
    ca4: '4th Circuit', ca5: '5th Circuit', ca6: '6th Circuit',
    ca7: '7th Circuit', ca8: '8th Circuit', ca9: '9th Circuit',
    ca10: '10th Circuit', ca11: '11th Circuit',
    cadc: 'D.C. Circuit', cafc: 'Federal Circuit',
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
- courtType: The court type provided (one of "scotus", "federal_appeals", "district").
- status: A specific ruling outcome (e.g., "Blocked", "Upheld", "Reversed", "Injunction Granted", "Affirmed", "Struck Down", "Remanded"). Be specific about what the court did.
- latestAction: A 1-sentence description of the specific ruling action and outcome. State what the judge or court decided, not just that they "reviewed" or "considered" the case.
- tagImpacts: A JSON object where keys are the specific Life Tags provided, and values are a 1-sentence explanation of why this ruling matters to someone with that tag. Only include tags with a genuine impact.
- type: Always "Court Ruling".
- level: Always "Federal".
- url: The URL provided.
- date: The date provided.

Return ONLY valid JSON in the format:
{ "rulings": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "generalSummary": "...", "impactLevel": "...", "profileLevel": "...", "topics": [], "court": "...", "courtType": "...", "status": "...", "latestAction": "...", "tagImpacts": {}, "type": "Court Ruling", "level": "Federal", "url": "...", "date": "...", "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

// ── Firestore helpers ──

async function getCachedSummary(id) {
    try {
        const snap = await getDoc(doc(db, 'billSummaries', id));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (Date.now() - (data.cachedAt || 0) > CACHE_TTL_MS) return null;
        return data;
    } catch { return null; }
}

async function cacheSummary(id, data) {
    try { await setDoc(doc(db, 'billSummaries', id), { ...data, cachedAt: Date.now() }); }
    catch (e) { console.warn('Cache write failed:', e.message); }
}

async function getRateLimitCache() {
    try {
        const snap = await getDoc(doc(db, 'billSummaries', '_court_rl_v8_'));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (Date.now() - (data.fetchedAt || 0) > RATE_LIMIT_MS) return null;
        return data.rulingIds || [];
    } catch { return null; }
}

async function saveRateLimitCache(rulingIds) {
    try {
        await setDoc(doc(db, 'billSummaries', '_court_rl_v8_'), {
            rulingIds, fetchedAt: Date.now(),
        });
    } catch (e) { console.warn('Rate limit save failed:', e.message); }
}

// ── CourtListener fetch ──

async function fetchCL(params, label) {
    const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
    console.log(`[CL] ${label}:`, url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Token ${process.env.COURTLISTENER_API_TOKEN}` },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) { console.error(`[CL] ${label} error: ${res.status}`); return []; }
        const data = await res.json();
        console.log(`[CL] ${label}: ${(data.results || []).length} results`);
        return data.results || [];
    } catch (err) {
        clearTimeout(timeout);
        console.error(`[CL] ${label} failed:`, err.message);
        return [];
    }
}

/**
 * Fetch 50 opinions: 15 SCOTUS + 15 Appeals + 20 District (high-profile keyword search).
 * Only 2 API calls: one for SCOTUS+Appeals courts, one for keyword search.
 * If a bucket doesn't fill, redistribute slots to others.
 */
async function fetchAll50() {
    const filedAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

    // Query 1: SCOTUS + all circuit courts (one request)
    const p1 = new URLSearchParams();
    p1.append('type', 'o');
    p1.append('order_by', 'dateFiled desc');
    p1.append('filed_after', filedAfter);
    [...SCOTUS_COURTS, ...CIRCUIT_COURTS].forEach(c => p1.append('court', c));
    const courtsRaw = await fetchCL(p1, 'SCOTUS+Appeals');

    // 1.5s delay to stay under rate limit
    await new Promise(r => setTimeout(r, 1500));

    // Query 2: high-profile keyword search (any court, catches district courts)
    const p2 = new URLSearchParams();
    p2.append('type', 'o');
    p2.append('order_by', 'dateFiled desc');
    p2.append('filed_after', filedAfter);
    p2.append('q',
        '"preliminary injunction" OR "temporary restraining order" OR ' +
        '"unconstitutional" OR "voter rolls" OR "deportation" OR ' +
        '"executive order" OR "struck down" OR "enjoined"'
    );
    const hpRaw = await fetchCL(p2, 'HighProfile');

    // Deduplicate
    const seen = new Set();
    const all = [...courtsRaw, ...hpRaw].filter(r => {
        const k = r.cluster_id || r.id || r.docket_id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    // Categorize
    const scotus = [], appeals = [], district = [];
    for (const r of all) {
        const cid = r.court_id || '';
        if (SCOTUS_COURTS.includes(cid)) scotus.push(r);
        else if (CIRCUIT_COURTS.includes(cid)) appeals.push(r);
        else district.push(r);
    }

    // Sort each by date
    const byDate = (a, b) => (b.dateFiled || '').localeCompare(a.dateFiled || '');
    scotus.sort(byDate);
    appeals.sort(byDate);
    district.sort(byDate);

    console.log(`[Buckets] SCOTUS=${scotus.length} Appeals=${appeals.length} District=${district.length}`);

    // Smart distribution: 15 + 15 + 20 = 50
    let sTarget = 15, aTarget = 15, dTarget = 20;

    const sTake = scotus.slice(0, sTarget);
    const aTake = appeals.slice(0, aTarget);
    const dTake = district.slice(0, dTarget);

    // Redistribute unused slots
    let leftover = (sTarget - sTake.length) + (aTarget - aTake.length) + (dTarget - dTake.length);
    const extras = [];
    if (leftover > 0) {
        // Pull more from whichever bucket has extras
        const pools = [
            { arr: district.slice(dTake.length), label: 'district' },
            { arr: appeals.slice(aTake.length), label: 'appeals' },
            { arr: scotus.slice(sTake.length), label: 'scotus' },
        ];
        for (const pool of pools) {
            if (leftover <= 0) break;
            const take = pool.arr.slice(0, leftover);
            extras.push(...take);
            leftover -= take.length;
            if (take.length) console.log(`  +${take.length} from ${pool.label}`);
        }
    }

    const selected = [...sTake, ...aTake, ...dTake, ...extras];
    console.log(`[Distribution] ${sTake.length}S + ${aTake.length}A + ${dTake.length}D + ${extras.length}extra = ${selected.length}`);
    return selected;
}

// ── Shape opinion ──

function getCourtType(courtId) {
    if (SCOTUS_COURTS.includes(courtId)) return 'scotus';
    if (CIRCUIT_COURTS.includes(courtId)) return 'federal_appeals';
    return 'district';
}

function shapeOpinion(opinion) {
    const courtId = opinion.court_id || '';
    return {
        id: `court-${opinion.cluster_id || opinion.id || opinion.docket_id || Date.now()}`,
        caseName: opinion.caseName || opinion.case_name || '',
        court: COURT_NAME_MAP[courtId] || opinion.court || courtId,
        courtType: getCourtType(courtId),
        level: 'Federal',
        date: opinion.dateFiled || opinion.date_filed || '',
        url: opinion.absolute_url ? `https://www.courtlistener.com${opinion.absolute_url}` : '',
        snippet: opinion.snippet || '',
        docketNumber: opinion.docketNumber || opinion.docket_number || '',
        suitNature: opinion.suitNature || opinion.suit_nature || '',
        citeCount: opinion.citeCount || opinion.citation_count || 0,
    };
}

// ── Main handler ──

export async function POST(request) {
    try {
        const { lifeTags, interests, page = 1 } = await request.json();
        const offset = (page - 1) * PAGE_SIZE;

        // Step 1: Try rate limit cache — return ALL items at once (no pagination)
        const cachedIds = await getRateLimitCache();

        if (cachedIds && cachedIds.length >= 10 && page === 1) {
            const cached = (await Promise.all(cachedIds.map(getCachedSummary))).filter(Boolean);
            console.log(`[Cache] ALL: ${cachedIds.length} ids, ${cached.length} valid`);

            if (cached.length > 0) {
                return NextResponse.json({ items: cached, hasMore: false });
            }
            // Summaries expired — fall through to re-process
        }

        // Step 2: Fetch from CourtListener (2 API calls)
        const raw = await fetchAll50();
        const shaped = raw.map(shapeOpinion);
        console.log(`[Shaped] ${shaped.length} opinions`);

        // Save all IDs (only if we got a real batch)
        if (shaped.length >= 10) {
            saveRateLimitCache(shaped.map(o => o.id));
        }

        // Paginate
        const batch = shaped.slice(offset, offset + PAGE_SIZE);
        if (batch.length === 0) {
            return NextResponse.json({ items: [], hasMore: false });
        }

        console.log(`[Page ${page}] processing ${batch.length} items (offset ${offset})`);

        // Step 3: Check which are already cached
        const cacheHits = await Promise.all(batch.map(o => getCachedSummary(o.id)));
        const cachedItems = [];
        const uncached = [];
        batch.forEach((op, i) => {
            if (cacheHits[i]) cachedItems.push({ ...cacheHits[i], url: op.url });
            else uncached.push(op);
        });

        console.log(`[Cache] ${cachedItems.length} hit, ${uncached.length} need AI`);

        // Step 4: AI-process uncached (max 10)
        let aiItems = [];
        if (uncached.length > 0) {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
            const userPrompt = `Analyze these court rulings and generate tagImpacts for Life Tags: ${(lifeTags || []).join(', ') || 'None'}.${
                interests?.length ? `\n\nThe user is interested in: ${interests.join(', ')}.` : ''
            }\n\nRulings:\n${JSON.stringify(uncached, null, 2)}`;

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

            // Cache each result
            for (const item of aiItems) {
                if (item.id) {
                    cacheSummary(item.id, {
                        ...item,
                        sponsors: [], locationMatches: [],
                        likes: 0, dislikes: 0,
                    });
                }
            }
        }

        // Step 5: Return combined results
        const items = [...cachedItems, ...aiItems];
        const hasMore = offset + PAGE_SIZE < shaped.length;
        console.log(`[Done] page=${page}: ${items.length} items, hasMore=${hasMore}`);

        return NextResponse.json({ items, hasMore });

    } catch (error) {
        console.error('[ERROR]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
