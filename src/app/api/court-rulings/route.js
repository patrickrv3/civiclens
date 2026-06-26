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

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — court rulings don't change once published
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours between CourtListener fetches
const MAX_PER_COURT = 50; // Rolling window: keep top 50 per court

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
    dcd: 'D.C. District',
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

// ── Per-court rolling cache ──

const COURT_CACHE_KEYS = {
    scotus: '_court_cache_scotus_v1_',
    federal_appeals: '_court_cache_appeals_v1_',
    district: '_court_cache_district_v1_',
};

async function getCourtCache(courtType) {
    try {
        const key = COURT_CACHE_KEYS[courtType];
        if (!key) return { ids: [], fetchedAt: 0 };
        const snap = await getDoc(doc(db, 'billSummaries', key));
        if (!snap.exists()) return { ids: [], fetchedAt: 0 };
        const data = snap.data();
        return { ids: data.ids || [], fetchedAt: data.fetchedAt || 0 };
    } catch { return { ids: [], fetchedAt: 0 }; }
}

async function saveCourtCache(courtType, ids) {
    try {
        const key = COURT_CACHE_KEYS[courtType];
        if (!key) return;
        await setDoc(doc(db, 'billSummaries', key), {
            ids: ids.slice(0, MAX_PER_COURT),
            fetchedAt: Date.now(),
        });
    } catch (e) { console.warn(`Court cache save failed (${courtType}):`, e.message); }
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
 * Fetch latest 20 opinions per court (3 parallel API calls).
 * Returns { scotus: [...], appeals: [...], district: [...] }
 */
async function fetchLatest() {
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

    const [scotusRes, appealsRes, districtRes] = await Promise.allSettled([
        fetchCL(makeUrl(SCOTUS_COURTS), 'SCOTUS'),
        fetchCL(makeUrl(CIRCUIT_COURTS), 'Appeals'),
        fetchCL(makeUrl(['dcd']), 'DC-District'),
    ]);

    return {
        scotus: (scotusRes.status === 'fulfilled' ? scotusRes.value : []).map(shapeOpinion),
        appeals: (appealsRes.status === 'fulfilled' ? appealsRes.value : []).map(shapeOpinion),
        district: (districtRes.status === 'fulfilled' ? districtRes.value : []).map(shapeOpinion),
    };
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

/**
 * Merge new items into existing cached IDs for a court.
 * Deduplicates by ID, sorts by date (newest first), keeps top MAX_PER_COURT.
 * Returns the merged list of IDs and the list of new shaped items that need AI processing.
 */
function mergeCourtItems(existingIds, newShaped) {
    const existingSet = new Set(existingIds);
    const genuinelyNew = newShaped.filter(item => !existingSet.has(item.id));

    // Combine: new items first (they have date info), then existing IDs
    // We'll resolve full items later; for now track IDs
    const allIds = [...new Set([
        ...newShaped.map(i => i.id),
        ...existingIds,
    ])].slice(0, MAX_PER_COURT);

    return { mergedIds: allIds, newItems: genuinelyNew };
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

        // Step 1: Check if any court cache needs refreshing
        const [scotusCache, appealsCache, districtCache] = await Promise.all([
            getCourtCache('scotus'),
            getCourtCache('federal_appeals'),
            getCourtCache('district'),
        ]);

        const now = Date.now();
        const needsRefresh =
            (now - scotusCache.fetchedAt > REFRESH_INTERVAL_MS) ||
            (now - appealsCache.fetchedAt > REFRESH_INTERVAL_MS) ||
            (now - districtCache.fetchedAt > REFRESH_INTERVAL_MS);

        let allNewItems = []; // Items that need AI processing

        if (needsRefresh) {
            console.log('[Refresh] Fetching latest from CourtListener...');

            // Step 2: Fetch latest 20 per court
            const latest = await fetchLatest();
            console.log(`[Fetched] SCOTUS=${latest.scotus.length} Appeals=${latest.appeals.length} District=${latest.district.length}`);

            // Step 3: Merge with existing caches
            const scotusMerge = mergeCourtItems(scotusCache.ids, latest.scotus);
            const appealsMerge = mergeCourtItems(appealsCache.ids, latest.appeals);
            const districtMerge = mergeCourtItems(districtCache.ids, latest.district);

            console.log(`[Merge] New items: SCOTUS=${scotusMerge.newItems.length} Appeals=${appealsMerge.newItems.length} District=${districtMerge.newItems.length}`);

            // Collect all genuinely new items for AI processing
            allNewItems = [
                ...scotusMerge.newItems,
                ...appealsMerge.newItems,
                ...districtMerge.newItems,
            ];

            // Step 4: AI-process new items (in batches of 17)
            const courtTypeMap = {};
            allNewItems.forEach(item => { courtTypeMap[item.id] = item.courtType; });

            if (allNewItems.length > 0) {
                const BATCH_SIZE = 17;
                const batches = [];
                for (let i = 0; i < allNewItems.length; i += BATCH_SIZE) {
                    batches.push(allNewItems.slice(i, i + BATCH_SIZE));
                }
                console.log(`[AI] ${allNewItems.length} new items → ${batches.length} batches of [${batches.map(b => b.length).join(', ')}]`);

                const results = await Promise.all(
                    batches.map((batch, i) =>
                        processWithAI(batch, lifeTags, interests)
                            .then(r => { console.log(`[AI] Batch ${i + 1}: sent ${batch.length}, got ${r.length}`); return r; })
                            .catch(e => { console.error(`[AI] Batch ${i + 1} failed:`, e.message); return []; })
                    )
                );
                const aiItems = results.flat();

                // Cache each AI result with correct courtType (await to avoid race condition)
                await Promise.all(aiItems.map(item => {
                    if (item.id) {
                        return cacheSummary(item.id, {
                            ...item,
                            courtType: courtTypeMap[item.id] || item.courtType,
                            sponsors: [], locationMatches: [],
                            likes: 0, dislikes: 0,
                        });
                    }
                    return Promise.resolve();
                }));
            }

            // Step 5: Save updated per-court caches
            await Promise.all([
                saveCourtCache('scotus', scotusMerge.mergedIds),
                saveCourtCache('federal_appeals', appealsMerge.mergedIds),
                saveCourtCache('district', districtMerge.mergedIds),
            ]);
        } else {
            console.log('[Cache] All courts fresh, serving from cache');
        }

        // Step 6: Load all cached summaries from all 3 courts
        const allIds = [
            ...scotusCache.ids,
            ...appealsCache.ids,
            ...districtCache.ids,
        ];

        // If we just refreshed, use the updated IDs instead
        let finalIds = allIds;
        if (needsRefresh) {
            // Re-read the caches we just saved (they have updated IDs)
            const [s, a, d] = await Promise.all([
                getCourtCache('scotus'),
                getCourtCache('federal_appeals'),
                getCourtCache('district'),
            ]);
            finalIds = [...s.ids, ...a.ids, ...d.ids];
        }

        // Deduplicate IDs
        finalIds = [...new Set(finalIds)];

        console.log(`[Load] ${finalIds.length} total IDs across all courts`);

        // Load all summaries from Firestore
        const summaries = await Promise.all(finalIds.map(getCachedSummary));
        const items = [];
        finalIds.forEach((id, i) => {
            if (summaries[i]) {
                // Force courtType from the ID pattern
                const courtType = getCourtTypeFromId(id, summaries[i]);
                items.push({ ...summaries[i], courtType });
            }
        });

        console.log(`[Done] ${items.length} valid items returned`);

        return NextResponse.json({ items, hasMore: false });

    } catch (error) {
        console.error('[ERROR]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * Determine courtType for an item. Uses the court cache membership
 * as the source of truth, falling back to the stored courtType.
 */
function getCourtTypeFromId(id, summary) {
    // The courtType should already be correctly set when we cached it,
    // but force it to match the expected frontend values
    const ct = summary.courtType || '';
    if (ct === 'scotus' || ct === 'federal_appeals' || ct === 'district') return ct;
    // Legacy fallback
    if (ct === 'Supreme Court') return 'scotus';
    if (ct === 'Federal Appeals') return 'federal_appeals';
    if (ct === 'District Court') return 'district';
    return 'district';
}
