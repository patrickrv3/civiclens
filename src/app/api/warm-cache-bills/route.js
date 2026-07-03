import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export const maxDuration = 60;

// ── Firebase init ────────────────────────────────────────────────────────────
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

const BILL_PROMPT = `You are an expert, neutral, nonpartisan civic analyst.
Summarize each bill and return ONLY valid JSON:
{ "bills": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "url": "...", "type": "Bill", "level": "Federal", "date": "...", "generalSummary": "...", "impactLevel": "High Impact|Moderate Impact|Low Impact", "status": "Introduced|In Committee|Passed House|Passed Senate|Passed Both Chambers|Signed into Law|Failed", "latestAction": "...", "tagImpacts": {}, "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

const typeSlugMap = {
    'HR': 'house-bill', 'S': 'senate-bill',
    'HJRES': 'house-joint-resolution', 'SJRES': 'senate-joint-resolution',
    'HCONRES': 'house-concurrent-resolution', 'SCONRES': 'senate-concurrent-resolution',
    'HRES': 'house-resolution', 'SRES': 'senate-resolution',
};

const introPatterns = [
    'read twice and referred',
    'introduced in',
    'referred to',
    'sponsor introductory remarks',
    'reserved for',
];

async function isCached(id) {
    try {
        const snap = await getDoc(doc(db, 'billSummaries', id));
        if (!snap.exists()) return false;
        return (Date.now() - (snap.data().cachedAt || 0)) < CACHE_TTL_MS;
    } catch { return false; }
}

async function saveToCache(item) {
    try {
        await setDoc(doc(db, 'billSummaries', item.id), { ...item, cachedAt: Date.now() });
    } catch (err) {
        console.warn('Cache write failed for', item.id, err.message);
    }
}

// Fetch a single page from the Congress API
async function fetchBillPage(billType, offset) {
    const url = `https://api.congress.gov/v3/bill/119/${billType}?api_key=${process.env.CONGRESS_API_KEY}&limit=250&offset=${offset}&format=json`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return [];
        const data = await res.json();
        return data.bills || [];
    } catch (err) {
        console.warn(`Failed to fetch ${billType} offset=${offset}:`, err.message);
        return [];
    }
}

// ── GET handler (called by Vercel Cron) ──────────────────────────────────────
export async function GET(request) {
    const startTime = Date.now();

    // Auth check
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
    const errors = [];
    let totalScanned = 0;
    let billsWarmed = 0;

    try {
        // ── 1. Fetch bills from all types in parallel batches ────────────────
        // 20 total API calls, fetched in 4 batches of 5 to respect rate limits
        const billTypes = [
            { type: 's', pages: 8 },     // S.1 – S.2000
            { type: 'hr', pages: 8 },    // H.R.1 – H.R.2000
            { type: 'hjres', pages: 2 }, // H.J.Res.1 – H.J.Res.500
            { type: 'sjres', pages: 2 }, // S.J.Res.1 – S.J.Res.500
        ];

        // Build all fetch tasks
        const fetchTasks = [];
        for (const { type, pages } of billTypes) {
            for (let page = 0; page < pages; page++) {
                fetchTasks.push({ type, offset: page * 250 });
            }
        }

        // Execute in batches of 5 parallel calls
        let allRawBills = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < fetchTasks.length; i += BATCH_SIZE) {
            const batch = fetchTasks.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
                batch.map(t => fetchBillPage(t.type, t.offset))
            );
            for (const bills of results) {
                allRawBills = allRawBills.concat(bills);
            }
        }

        totalScanned = allRawBills.length;
        console.log(`[warm-cache-bills] Scanned ${totalScanned} raw bills`);

        // ── 2. Filter for meaningful action ──────────────────────────────────
        const meaningfulBills = allRawBills
            .filter(b => {
                const title = (b.title || '').toLowerCase();
                if (title.includes('reserved for')) return false;
                const action = (b.latestAction?.text || '').toLowerCase();
                return !introPatterns.some(p => action.includes(p));
            })
            .sort((a, b) => {
                const dateA = new Date(a.latestAction?.actionDate || '2000-01-01');
                const dateB = new Date(b.latestAction?.actionDate || '2000-01-01');
                return dateB - dateA;
            })
            .slice(0, 100); // Keep top 100

        console.log(`[warm-cache-bills] ${meaningfulBills.length} bills after filter (from ${totalScanned})`);

        // ── 3. Build the feed index ──────────────────────────────────────────
        const indexBills = meaningfulBills.map(b => {
            const congressNum = b.congress || 119;
            const typeUpper = (b.type || 'HR').toUpperCase();
            const slug = typeSlugMap[typeUpper] || 'house-bill';
            return {
                id: `${congressNum}-${typeUpper.toLowerCase()}-${b.number}`,
                type: typeUpper,
                number: b.number,
                congress: congressNum,
                title: b.title,
                latestAction: b.latestAction?.text || '',
                latestActionDate: b.latestAction?.actionDate || '',
                updateDate: b.updateDate || '',
                url: `https://www.congress.gov/bill/${congressNum}th-congress/${slug}/${b.number}`,
            };
        });

        // Write the index to Firestore
        await setDoc(doc(db, 'feedIndex', 'latestBills'), {
            bills: indexBills,
            updatedAt: new Date().toISOString(),
            totalScanned,
            totalAfterFilter: indexBills.length,
        });

        console.log(`[warm-cache-bills] Feed index saved with ${indexBills.length} bills`);

        // ── 4. AI-summarize uncached bills ───────────────────────────────────
        const cacheChecks = await Promise.all(indexBills.map(b => isCached(b.id)));
        const uncached = indexBills.filter((_, i) => !cacheChecks[i]);

        console.log(`[warm-cache-bills] ${uncached.length} uncached, ${indexBills.length - uncached.length} already cached`);

        if (uncached.length > 0) {
            // Process in chunks of 10
            const CHUNK_SIZE = 10;
            for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
                // Check remaining time — stop if under 10 seconds
                if (Date.now() - startTime > 50000) {
                    console.warn(`[warm-cache-bills] Running low on time, stopping AI at ${billsWarmed} bills`);
                    break;
                }

                const chunk = uncached.slice(i, i + CHUNK_SIZE);
                try {
                    const completion = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: BILL_PROMPT },
                            { role: 'user', content: `Summarize these bills:\n${JSON.stringify(chunk, null, 2)}` },
                        ],
                        response_format: { type: 'json_object' },
                    }, { signal: AbortSignal.timeout(30000) });

                    let parsed;
                    try {
                        parsed = JSON.parse(completion.choices[0].message.content);
                    } catch {
                        console.warn('[warm-cache-bills] Failed to parse AI response');
                        continue;
                    }

                    const aiItems = parsed.bills || [];
                    // Enrich with actual dates from index
                    const uncachedById = new Map(chunk.map(u => [u.id, u]));
                    const enriched = aiItems.map(item => {
                        const src = uncachedById.get(item.id);
                        if (src) {
                            return {
                                ...item,
                                introducedDate: item.date || '',
                                date: src.latestActionDate || item.date || '',
                                latestActionDate: src.latestActionDate,
                            };
                        }
                        return item;
                    });

                    await Promise.all(enriched.map(item =>
                        item.id ? saveToCache(item) : Promise.resolve()
                    ));
                    billsWarmed += enriched.length;
                } catch (err) {
                    errors.push(`AI chunk ${i} failed: ${err.message}`);
                }
            }
        }
    } catch (err) {
        errors.push(`Fatal error: ${err.message}`);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[warm-cache-bills] Done in ${durationMs}ms: ${billsWarmed} warmed, ${errors.length} errors`);

    // Log health to Firestore
    try {
        await setDoc(doc(db, 'cronHealth', 'latestBills'), {
            success: errors.length === 0,
            totalScanned,
            billsWarmed,
            errors,
            durationMs,
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        console.warn('[warm-cache-bills] Health log failed:', e.message);
    }

    return NextResponse.json({
        success: errors.length === 0,
        totalScanned,
        billsWarmed,
        errors,
        durationMs,
    }, errors.length > 0 && billsWarmed === 0 ? { status: 500 } : {});
}
