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

const CACHE_TTL_MS = 48 * 60 * 60 * 1000;

const BILL_PROMPT = `You are an expert, neutral, nonpartisan civic analyst.
Summarize each bill and return ONLY valid JSON:
{ "bills": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "url": "...", "type": "Bill", "level": "Federal", "date": "...", "generalSummary": "...", "impactLevel": "High Impact|Moderate Impact|Low Impact", "status": "Introduced|In Committee|Passed House|Passed Senate|Passed Both Chambers|Signed into Law|Failed", "latestAction": "...", "tagImpacts": {}, "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

const EO_PROMPT = `You are an expert, neutral, nonpartisan civic analyst.
Summarize each executive order and return ONLY valid JSON:
{ "orders": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "url": "...", "type": "Executive Order", "level": "Federal", "date": "...", "generalSummary": "...", "impactLevel": "High Impact|Moderate Impact|Low Impact", "status": "Signed into Law", "latestAction": "Signed by the President", "tagImpacts": {}, "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

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

// ── GET handler (called by Vercel Cron) ──────────────────────────────────────
export async function GET(request) {
    // Verify this is called by Vercel Cron or our secret token
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
    const typeSlugMap = {
        'HR': 'house-bill', 'S': 'senate-bill', 'HJRES': 'house-joint-resolution',
        'SJRES': 'senate-joint-resolution', 'HCONRES': 'house-concurrent-resolution',
        'SCONRES': 'senate-concurrent-resolution', 'HRES': 'house-resolution', 'SRES': 'senate-resolution',
    };

    let billsWarmed = 0;
    let eosWarmed = 0;
    const errors = [];

    // ── 1. Warm 50 bills (5 pages × 10) ────────────────────────────────────
    for (let page = 0; page < 5; page++) {
        const offset = page * 10;
        try {
            const url = `https://api.congress.gov/v3/bill?api_key=${process.env.CONGRESS_API_KEY}&limit=10&offset=${offset}&format=json`;
            const res = await fetch(url);
            if (!res.ok) { errors.push(`Congress API error at offset ${offset}: ${res.status}`); continue; }
            const data = await res.json();
            const bills = (data.bills || []).sort((a, b) => new Date(b.updateDate) - new Date(a.updateDate));

            const forProcessing = bills.map(b => {
                const congressNum = b.congress || 119;
                const typeUpper = (b.type || 'HR').toUpperCase();
                const slug = typeSlugMap[typeUpper] || 'house-bill';
                return {
                    id: `${congressNum}-${typeUpper.toLowerCase()}-${b.number}`,
                    title: b.title,
                    latestAction: b.latestAction?.text || '',
                    updateDate: b.updateDate,
                    url: `https://www.congress.gov/bill/${congressNum}th-congress/${slug}/${b.number}`,
                };
            });

            // Only process uncached bills
            const cached = await Promise.all(forProcessing.map(b => isCached(b.id)));
            const uncached = forProcessing.filter((_, i) => !cached[i]);

            if (uncached.length > 0) {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: BILL_PROMPT },
                        { role: 'user', content: `Summarize these bills:\n${JSON.stringify(uncached, null, 2)}` },
                    ],
                    response_format: { type: 'json_object' },
                });
                const parsed = JSON.parse(completion.choices[0].message.content);
                const aiItems = parsed.bills || [];
                await Promise.all(aiItems.map(item => item.id ? saveToCache(item) : Promise.resolve()));
                billsWarmed += aiItems.length;
            }
        } catch (err) {
            errors.push(`Bills page ${page} failed: ${err.message}`);
        }
    }

    // ── 2. Warm 10 executive orders ─────────────────────────────────────────
    try {
        const frUrl = 'https://www.federalregister.gov/api/v1/documents.json' +
            '?conditions[type][]=PRESDOCU&conditions[presidential_document_type][]=executive_order' +
            '&per_page=10&order=newest&fields[]=document_number,title,abstract,signing_date,html_url,executive_order_number';
        const frRes = await fetch(frUrl);
        if (frRes.ok) {
            const frData = await frRes.json();
            const orders = (frData.results || []).map(o => ({
                id: `eo-${o.document_number || o.executive_order_number}`,
                title: o.title,
                abstract: o.abstract || '',
                date: o.signing_date || '',
                url: o.html_url || '',
            }));

            const cached = await Promise.all(orders.map(o => isCached(o.id)));
            const uncached = orders.filter((_, i) => !cached[i]);

            if (uncached.length > 0) {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: EO_PROMPT },
                        { role: 'user', content: `Summarize these executive orders:\n${JSON.stringify(uncached, null, 2)}` },
                    ],
                    response_format: { type: 'json_object' },
                });
                const parsed = JSON.parse(completion.choices[0].message.content);
                const aiItems = parsed.orders || [];
                await Promise.all(aiItems.map(item => item.id ? saveToCache(item) : Promise.resolve()));
                eosWarmed += aiItems.length;
            }
        }
    } catch (err) {
        errors.push(`Executive orders failed: ${err.message}`);
    }

    // ── 3. Warm court rulings (trigger the court-rulings API refresh) ────────
    let rulingsWarmed = 0;
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';
        const rulingsRes = await fetch(`${baseUrl}/api/court-rulings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lifeTags: [], interests: [] }),
            signal: AbortSignal.timeout(55000), // Allow up to 55s (within our 60s maxDuration)
        });
        if (rulingsRes.ok) {
            const rulingsData = await rulingsRes.json();
            rulingsWarmed = (rulingsData.items || []).length;
        } else {
            errors.push(`Court rulings API returned ${rulingsRes.status}`);
        }
    } catch (err) {
        errors.push(`Court rulings warm failed: ${err.message}`);
    }

    console.log(`Cache warm complete: ${billsWarmed} bills, ${eosWarmed} EOs, ${rulingsWarmed} rulings warmed. Errors: ${errors.length}`);
    return NextResponse.json({
        success: true,
        billsWarmed,
        eosWarmed,
        rulingsWarmed,
        errors,
        timestamp: new Date().toISOString(),
    });
}
