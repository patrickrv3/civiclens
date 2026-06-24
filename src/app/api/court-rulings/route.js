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
// Top federal district courts (most active for high-profile rulings)
const DISTRICT_COURTS = [
    'dcd',    // D.C. — executive power, immigration, federal agency cases
    'nysd',   // Southern District of NY — financial, civil rights
    'nyed',   // Eastern District of NY
    'cacd',   // Central District of CA — immigration, tech
    'cand',   // Northern District of CA — tech, civil rights
    'casd',   // Southern District of CA — border/immigration
    'txsd',   // Southern District of TX — immigration, border
    'txnd',   // Northern District of TX — executive orders, gun rights
    'txed',   // Eastern District of TX — patent, tech
    'txwd',   // Western District of TX — immigration
    'flsd',   // Southern District of FL — various
    'flmd',   // Middle District of FL
    'ilnd',   // Northern District of IL — civil rights
    'paed',   // Eastern District of PA
    'mad',    // District of MA
    'mdd',    // District of MD
    'vaed',   // Eastern District of VA
    'gand',   // Northern District of GA — voting rights
    'cod',    // District of CO
    'azd',    // District of AZ — immigration
];

const COURT_NAME_MAP = {
    scotus: 'Supreme Court',
    ca1: '1st Circuit', ca2: '2nd Circuit', ca3: '3rd Circuit',
    ca4: '4th Circuit', ca5: '5th Circuit', ca6: '6th Circuit',
    ca7: '7th Circuit', ca8: '8th Circuit', ca9: '9th Circuit',
    ca10: '10th Circuit', ca11: '11th Circuit',
    cadc: 'D.C. Circuit', cafc: 'Federal Circuit',
    dcd: 'D.C. District', nysd: 'S.D.N.Y.', nyed: 'E.D.N.Y.',
    cacd: 'C.D. Cal.', cand: 'N.D. Cal.', casd: 'S.D. Cal.',
    txsd: 'S.D. Tex.', txnd: 'N.D. Tex.', txed: 'E.D. Tex.', txwd: 'W.D. Tex.',
    flsd: 'S.D. Fla.', flmd: 'M.D. Fla.',
    ilnd: 'N.D. Ill.', paed: 'E.D. Pa.',
    mad: 'D. Mass.', mdd: 'D. Md.',
    vaed: 'E.D. Va.', gand: 'N.D. Ga.',
    cod: 'D. Colo.', azd: 'D. Ariz.',
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
        const snap = await getDoc(doc(db, 'billSummaries', '_court_rl_v16_'));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (Date.now() - (data.fetchedAt || 0) > RATE_LIMIT_MS) return null;
        return data.rulingIds || [];
    } catch { return null; }
}

async function saveRateLimitCache(rulingIds) {
    try {
        await setDoc(doc(db, 'billSummaries', '_court_rl_v16_'), {
            rulingIds, fetchedAt: Date.now(),
        });
    } catch (e) { console.warn('Rate limit save failed:', e.message); }
}

// ── CourtListener fetch ──

async function fetchCL(url, label) {
    console.log(`[CL] ${label}:`, url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Token ${process.env.COURTLISTENER_API_TOKEN}` },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) { console.error(`[CL] ${label} error: ${res.status}`); return { results: [], next: null }; }
        const data = await res.json();
        console.log(`[CL] ${label}: ${(data.results || []).length} results (of ${data.count || '?'} total)`);
        return { results: data.results || [], next: data.next || null };
    } catch (err) {
        clearTimeout(timeout);
        console.error(`[CL] ${label} failed:`, err.message);
        return { results: [], next: null };
    }
}

/**
 * Fetch multiple pages from CourtListener, following cursor links.
 * Stops when we have enough results or run out of pages.
 */
async function fetchCLPages(params, label, minResults = 20, maxPages = 4) {
    const firstUrl = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
    let allResults = [];
    let nextUrl = firstUrl;
    let page = 0;

    while (nextUrl && page < maxPages && allResults.length < minResults) {
        const { results, next } = await fetchCL(nextUrl, `${label} p${page + 1}`);
        allResults.push(...results);
        nextUrl = next;
        page++;
        if (nextUrl && allResults.length < minResults) {
            await new Promise(r => setTimeout(r, 1000)); // delay between pages
        }
    }

    console.log(`[CL] ${label} total: ${allResults.length} results across ${page} page(s)`);
    return allResults;
}

/**
 * Fetch 50 opinions with 3 PARALLEL API calls (~3 seconds):
 *   1. SCOTUS (20 results)
 *   2. Circuit courts (20 results)
 *   3. D.C. District Court (20 results)
 * All 3 fire simultaneously — faster and avoids sequential timeout issues.
 */
async function fetchAll50() {
    const filedAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

    const makeUrl = (courts) => {
        const p = new URLSearchParams();
        p.append('type', 'o');
        p.append('order_by', 'dateFiled desc');
        p.append('filed_after', filedAfter);
        courts.forEach(c => p.append('court', c));
        return `https://www.courtlistener.com/api/rest/v4/search/?${p.toString()}`;
    };

    // Fire all 3 in parallel
    const [scotusRes, appealsRes, districtRes] = await Promise.allSettled([
        fetchCL(makeUrl(SCOTUS_COURTS), 'SCOTUS'),
        fetchCL(makeUrl(CIRCUIT_COURTS), 'Appeals'),
        fetchCL(makeUrl(['dcd']), 'DC-District'),
    ]);

    const scotusRaw = scotusRes.status === 'fulfilled' ? scotusRes.value.results : [];
    const appealsRaw = appealsRes.status === 'fulfilled' ? appealsRes.value.results : [];
    const districtRaw = districtRes.status === 'fulfilled' ? districtRes.value.results : [];

    console.log(`[Raw] SCOTUS=${scotusRaw.length} Appeals=${appealsRaw.length} District=${districtRaw.length}`);
    if (scotusRes.status === 'rejected') console.error('[SCOTUS failed]', scotusRes.reason);
    if (appealsRes.status === 'rejected') console.error('[Appeals failed]', appealsRes.reason);
    if (districtRes.status === 'rejected') console.error('[District failed]', districtRes.reason);

    // Deduplicate
    const seen = new Set();
    const dedup = (arr) => arr.filter(r => {
        const k = r.cluster_id || r.id || r.docket_id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    const scotus = dedup(scotusRaw);
    const appeals = dedup(appealsRaw);
    const district = dedup(districtRaw);

    const byDate = (a, b) => (b.dateFiled || '').localeCompare(a.dateFiled || '');
    scotus.sort(byDate);
    appeals.sort(byDate);
    district.sort(byDate);

    console.log(`[Buckets] SCOTUS=${scotus.length} Appeals=${appeals.length} District=${district.length}`);

    // Smart distribution: 15 + 15 + 20 = 50
    const sTake = scotus.slice(0, 15);
    const aTake = appeals.slice(0, 15);
    const dTake = district.slice(0, 20);

    // Redistribute unused slots
    let leftover = (15 - sTake.length) + (15 - aTake.length) + (20 - dTake.length);
    const extras = [];
    if (leftover > 0) {
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

// ── AI processing helper ──

async function processWithAI(opinions, lifeTags, interests) {
    if (opinions.length === 0) return [];
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
    const userPrompt = `Analyze these court rulings and generate tagImpacts for Life Tags: ${(lifeTags || []).join(', ') || 'None'}.${
        interests?.length ? `\n\nThe user is interested in: ${interests.join(', ')}.` : ''
    }\n\nRulings:\n${JSON.stringify(opinions, null, 2)}`;

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    return parsed.rulings || [];
}

// ── Main handler ──

export async function POST(request) {
    try {
        const { lifeTags, interests } = await request.json();

        // Step 1: Try rate limit cache — return ALL items at once
        const cachedIds = await getRateLimitCache();

        if (cachedIds && cachedIds.length >= 10) {
            const cached = (await Promise.all(cachedIds.map(getCachedSummary))).filter(Boolean);
            console.log(`[Cache] ${cachedIds.length} ids, ${cached.length} valid summaries`);

            if (cached.length >= 10) {
                return NextResponse.json({ items: cached, hasMore: false });
            }
            console.log('[Cache] Not enough valid summaries, re-fetching...');
        }

        // Step 2: Fetch from CourtListener (2 API calls)
        const raw = await fetchAll50();
        const shaped = raw.map(shapeOpinion);
        console.log(`[Shaped] ${shaped.length} total opinions`);

        if (shaped.length === 0) {
            return NextResponse.json({ items: [], hasMore: false });
        }

        // Save all IDs for rate limiting
        if (shaped.length >= 10) {
            saveRateLimitCache(shaped.map(o => o.id));
        }

        // Step 3: Check Firestore cache for each item
        const cacheHits = await Promise.all(shaped.map(o => getCachedSummary(o.id)));
        const cachedItems = [];
        const uncached = [];
        shaped.forEach((op, i) => {
            if (cacheHits[i]) cachedItems.push({ ...cacheHits[i], url: op.url });
            else uncached.push(op);
        });

        console.log(`[Cache] ${cachedItems.length} cached, ${uncached.length} need AI`);

        // Step 4: Process ALL uncached with AI
        // Split into 2 parallel batches to stay within 60s timeout
        let aiItems = [];
        if (uncached.length > 0) {
            if (uncached.length <= 25) {
                // Single batch
                aiItems = await processWithAI(uncached, lifeTags, interests);
            } else {
                // Two parallel batches
                const mid = Math.ceil(uncached.length / 2);
                const [batch1, batch2] = await Promise.all([
                    processWithAI(uncached.slice(0, mid), lifeTags, interests),
                    processWithAI(uncached.slice(mid), lifeTags, interests),
                ]);
                aiItems = [...batch1, ...batch2];
            }

            // Cache each AI result
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

        // Step 5: Return ALL items
        const items = [...cachedItems, ...aiItems];
        console.log(`[Done] ${items.length} total items (${cachedItems.length} cached + ${aiItems.length} AI)`);

        return NextResponse.json({ items, hasMore: false });

    } catch (error) {
        console.error('[ERROR]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
