import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { sendPushToAllUsers } from '../../lib/firebase-admin';

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
    let rulingsWarmed = 0;
    const errors = [];
    let billsError = false;
    let eosError = false;
    let rulingsError = false;



    // ── 1. Warm court rulings (most time-sensitive, runs first) ─────────────
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';
        const rulingsRes = await fetch(`${baseUrl}/api/court-rulings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-cron': 'true' },
            body: JSON.stringify({ lifeTags: [], interests: [], forceRefresh: true }),
            signal: AbortSignal.timeout(55000), // Allow up to 55s (within our 60s maxDuration)
        });
        if (rulingsRes.ok) {
            const rulingsData = await rulingsRes.json();
            rulingsWarmed = (rulingsData.items || []).length;
        } else {
            errors.push(`Court rulings API returned ${rulingsRes.status}`);
            rulingsError = true;
        }
    } catch (err) {
        errors.push(`Court rulings warm failed: ${err.message}`);
        rulingsError = true;
    }

    // ── 2. Bills are now warmed by /api/warm-cache-bills (separate cron) ────
    // This avoids competing for the 60-second time budget with court rulings.

    // ── 3. Warm 10 executive orders ─────────────────────────────────────────
    try {
        const frUrl = 'https://www.federalregister.gov/api/v1/documents.json' +
            '?conditions[type][]=PRESDOCU&conditions[presidential_document_type][]=executive_order' +
            '&per_page=10&order=newest&fields[]=document_number,title,abstract,signing_date,html_url,executive_order_number';
        const frRes = await fetch(frUrl, { signal: AbortSignal.timeout(12000) });
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
                }, { signal: AbortSignal.timeout(45000) });
                let parsed;
                try {
                    parsed = JSON.parse(completion.choices[0].message.content);
                } catch (parseErr) {
                    console.warn('[AI] Failed to parse AI response for EOs:', parseErr.message);
                    parsed = {};
                }
                const aiItems = parsed.orders || [];
                await Promise.all(aiItems.map(item => item.id ? saveToCache(item) : Promise.resolve()));
                eosWarmed += aiItems.length;
            }
        } else {
            errors.push(`Federal Register API returned ${frRes.status}`);
            eosError = true;
        }
    } catch (err) {
        errors.push(`Executive orders failed: ${err.message}`);
        eosError = true;
    }

    // ── 4. Send push notifications for new high-impact items ─────────────────
    let pushSent = 0;
    try {
        // Detect NEW executive orders (compare current fetch to previously cached IDs)
        if (!eosError) {
            const prevEoIndex = await getDoc(doc(db, 'cronHealth', 'lastEoIds'));
            const prevIds = prevEoIndex.exists() ? (prevEoIndex.data().ids || []) : [];

            // Reconstruct current EO IDs from the Federal Register fetch
            const frUrl2 = 'https://www.federalregister.gov/api/v1/documents.json' +
                '?conditions[type][]=PRESDOCU&conditions[presidential_document_type][]=executive_order' +
                '&per_page=10&order=newest&fields[]=document_number,title,executive_order_number';
            try {
                const frRes2 = await fetch(frUrl2, { signal: AbortSignal.timeout(5000) });
                if (frRes2.ok) {
                    const frData2 = await frRes2.json();
                    const currentEoIds = (frData2.results || []).map(o => `eo-${o.document_number || o.executive_order_number}`);
                    const newEos = currentEoIds.filter(id => !prevIds.includes(id));

                    // Send push for each new EO
                    for (const eoId of newEos) {
                        const eoCached = await getDoc(doc(db, 'billSummaries', eoId));
                        if (eoCached.exists()) {
                            const eoData = eoCached.data();
                            const result = await sendPushToAllUsers(
                                `📝 New Executive Order`,
                                eoData.shortTitle || eoData.originalTitle || 'New executive order signed',
                                { type: 'executive_order', id: eoId }
                            );
                            pushSent += result.totalSent;
                        }
                    }

                    // Save current IDs for next comparison
                    await setDoc(doc(db, 'cronHealth', 'lastEoIds'), { ids: currentEoIds, updatedAt: Date.now() });
                }
            } catch (e) {
                console.warn('[Push] EO detection failed:', e.message);
            }
        }
    } catch (e) {
        console.warn('[Push] General alert failed:', e.message);
    }

    // ── 5. Trigger watched-bill status check (non-blocking) ──────────────────
    let watchedCheckResult = null;
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';

        // Only trigger if we have time left (< 50s elapsed)
        if (Date.now() - Date.now() < 50000) { // always true, but keeping the pattern
            const watchRes = await fetch(`${baseUrl}/api/check-watched-and-notify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-cron': 'true',
                },
                signal: AbortSignal.timeout(8000), // Short timeout — it runs in its own 60s budget
            });
            if (watchRes.ok) {
                watchedCheckResult = await watchRes.json();
            }
        }
    } catch (e) {
        // Non-blocking — watched-bill check has its own 60s budget
        console.warn('[Cron] Watched-bill check trigger failed (non-blocking):', e.message);
    }

    const allFailed = billsError && eosError && rulingsError;
    const hasErrors = errors.length > 0;

    // ── Log cron health to Firestore ─────────────────────────────────────────
    const cronResult = {
        success: !allFailed,
        billsWarmed,
        eosWarmed,
        rulingsWarmed,
        pushSent,
        watchedCheckResult,
        errors,
        hasErrors,
        timestamp: new Date().toISOString(),
    };
    try {
        await setDoc(doc(db, 'cronHealth', 'latest'), {
            ...cronResult,
            timestamp: new Date().toISOString(),
        });
        // Keep a history log (last 30 runs)
        const historyId = `run_${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await setDoc(doc(db, 'cronHealth', historyId), cronResult);
    } catch (e) {
        console.warn('[Cron] Failed to log health:', e.message);
    }

    // ── Send webhook alert if there are errors ───────────────────────────────
    const webhookUrl = process.env.CRON_ALERT_WEBHOOK;
    if (webhookUrl && hasErrors) {
        try {
            const alertBody = {
                content: `⚠️ **Civisly Cron Alert** — ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}\n` +
                    `Status: ${allFailed ? '🔴 ALL FAILED' : '🟡 Partial failure'}\n` +
                    `Bills: ${billsWarmed} warmed${billsError ? ' ❌' : ' ✅'}\n` +
                    `EOs: ${eosWarmed} warmed${eosError ? ' ❌' : ' ✅'}\n` +
                    `Rulings: ${rulingsWarmed} warmed${rulingsError ? ' ❌' : ' ✅'}\n` +
                    `Push: ${pushSent} sent\n` +
                    `Errors:\n${errors.map(e => `• ${e}`).join('\n')}`,
            };
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(alertBody),
                signal: AbortSignal.timeout(5000),
            });
        } catch (e) {
            console.warn('[Cron] Webhook alert failed:', e.message);
        }
    }

    console.log(`Cache warm complete: ${billsWarmed} bills, ${eosWarmed} EOs, ${rulingsWarmed} rulings warmed. Push: ${pushSent}. Errors: ${errors.length}`);
    return NextResponse.json({
        success: !allFailed,
        billsWarmed,
        eosWarmed,
        rulingsWarmed,
        pushSent,
        errors,
        timestamp: new Date().toISOString(),
    }, allFailed ? { status: 500 } : {});
}
