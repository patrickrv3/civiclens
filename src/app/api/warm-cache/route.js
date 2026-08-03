import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { sendPushToAllUsers, sendPushToUser } from '../../lib/firebase-admin';

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
    const startTime = Date.now();
    let eosWarmed = 0;
    let rulingsWarmed = 0;
    let rulingsItems = []; // Store rulings for push notification detection
    const errors = [];
    let billsError = false;
    let eosError = false;
    let rulingsError = false;



    // ── 1. Warm court rulings (most time-sensitive, runs first) ─────────────
    try {
        const host = request.headers.get('host') || 'www.civisly.com';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${host}`;
        const rulingsRes = await fetch(`${baseUrl}/api/court-rulings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-cron': 'true' },
            body: JSON.stringify({ lifeTags: [], interests: [], forceRefresh: true }),
            signal: AbortSignal.timeout(55000), // Allow up to 55s (within our 60s maxDuration)
        });
        if (rulingsRes.ok) {
            const rulingsData = await rulingsRes.json();
            rulingsItems = rulingsData.items || [];
            rulingsWarmed = rulingsItems.length;
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
            '&per_page=10&order=newest&fields[]=document_number&fields[]=title&fields[]=abstract&fields[]=signing_date&fields[]=html_url&fields[]=executive_order_number';
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
                '&per_page=10&order=newest&fields[]=document_number&fields[]=title&fields[]=executive_order_number';
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
                                'New Executive Order',
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

        // Detect NEW court rulings and send push notifications
        if (!rulingsError && rulingsItems.length > 0) {
            try {
                const prevRulingsIndex = await getDoc(doc(db, 'cronHealth', 'lastCourtRulingIds'));
                const prevRulingIds = prevRulingsIndex.exists() ? (prevRulingsIndex.data().ids || []) : [];
                const currentRulingIds = rulingsItems.map(r => r.id);

                // First run: seed IDs without sending notifications
                if (!prevRulingsIndex.exists()) {
                    console.log(`[Push] First run — seeding ${currentRulingIds.length} court ruling IDs (no notifications)`);
                    await setDoc(doc(db, 'cronHealth', 'lastCourtRulingIds'), {
                        ids: currentRulingIds,
                        updatedAt: Date.now(),
                    });
                } else {
                    const newRulings = rulingsItems.filter(r => !prevRulingIds.includes(r.id));

                    if (newRulings.length > 0) {
                        console.log(`[Push] ${newRulings.length} new court rulings detected`);

                        // SCOTUS rulings get individual notifications (rare and significant)
                        const scotusRulings = newRulings.filter(r => r.courtType === 'scotus');
                        for (const ruling of scotusRulings) {
                            const result = await sendPushToAllUsers(
                                'Supreme Court Ruling',
                                ruling.caseName || ruling.shortTitle || 'New Supreme Court ruling',
                                { type: 'court_ruling', id: ruling.id, courtType: 'scotus' }
                            );
                            pushSent += result.totalSent;
                        }

                        // Appeals & District rulings get a batched summary notification
                        const otherRulings = newRulings.filter(r => r.courtType !== 'scotus');
                        if (otherRulings.length > 0) {
                            const appealsCount = otherRulings.filter(r => r.courtType === 'federal_appeals').length;
                            const districtCount = otherRulings.filter(r => r.courtType === 'district').length;
                            const parts = [];
                            if (appealsCount > 0) parts.push(`${appealsCount} appeals`);
                            if (districtCount > 0) parts.push(`${districtCount} district`);
                            const result = await sendPushToAllUsers(
                                'New Court Rulings',
                                `${otherRulings.length} new federal court ruling${otherRulings.length > 1 ? 's' : ''} (${parts.join(', ')})`,
                                { type: 'court_ruling', courtType: 'batch' }
                            );
                            pushSent += result.totalSent;
                        }
                    }

                    // Save current IDs for next comparison
                    await setDoc(doc(db, 'cronHealth', 'lastCourtRulingIds'), {
                        ids: currentRulingIds,
                        updatedAt: Date.now(),
                    });
                }
            } catch (e) {
                console.warn('[Push] Court ruling detection failed:', e.message);
            }
        }
    } catch (e) {
        console.warn('[Push] General alert failed:', e.message);
    }

    // ── 5. Trigger watched-bill status check (non-blocking) ──────────────────
    let watchedCheckResult = null;
    try {
        const host2 = request.headers.get('host') || 'www.civisly.com';
        const protocol2 = host2.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol2}://${host2}`;

        // Only trigger if we have time left (< 50s elapsed)
        if (Date.now() - startTime < 50000) {
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

    // ── Send push alert to admin if there are errors ──────────────────────────
    const ADMIN_UID = 'ojipCKs0EqghCTIsxnOE3BE6Q6l2';
    if (hasErrors) {
        try {
            const errorSummary = errors.map(e => `• ${e}`).join('\n');
            await sendPushToUser(
                ADMIN_UID,
                allFailed ? '🔴 Cron Failed' : '🟡 Cron Partial Failure',
                `EOs: ${eosWarmed}${eosError ? ' ❌' : ' ✅'} | Rulings: ${rulingsWarmed}${rulingsError ? ' ❌' : ' ✅'}\n${errorSummary}`,
                { type: 'admin_alert' },
                'general'
            );
        } catch (e) {
            console.warn('[Cron] Admin push alert failed:', e.message);
        }
    }

    // ── 7. Daily highlight notification ──────────────────────────────────────
    // Picks the most high-profile item across all categories and sends one
    // push notification per day to all users.
    if (Date.now() - startTime < 55000) { // Only if we have time budget
        try {
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const lastHighlightSnap = await getDoc(doc(db, 'cronHealth', 'lastDailyHighlight'));
            const lastDate = lastHighlightSnap.exists() ? lastHighlightSnap.data().date : null;

            if (lastDate !== today) {
                const candidates = [];

                // ── Court rulings (already in memory) ────────────────────────
                for (const r of rulingsItems) {
                    let score = 0;
                    if (r.courtType === 'scotus') score = 60;
                    else if (r.courtType === 'federal_appeals') score = 25;
                    else score = 10;
                    if (r.profileLevel === 'High Profile') score += 15;
                    else if (r.profileLevel === 'Notable') score += 8;
                    if (r.impactLevel === 'High Impact') score += 10;
                    else if (r.impactLevel === 'Moderate Impact') score += 5;

                    candidates.push({
                        id: r.id, score,
                        title: r.shortTitle || r.originalTitle || 'New Court Ruling',
                        body: (r.generalSummary || '').slice(0, 120),
                        emoji: '⚖️',
                    });
                }

                // ── Latest Executive Order (1-2 Firestore reads) ─────────────
                try {
                    const eoSnap = await getDoc(doc(db, 'cronHealth', 'lastEoIds'));
                    if (eoSnap.exists()) {
                        const topEoId = (eoSnap.data().ids || [])[0];
                        if (topEoId) {
                            const eoCached = await getDoc(doc(db, 'billSummaries', topEoId));
                            if (eoCached.exists()) {
                                const eo = eoCached.data();
                                candidates.push({
                                    id: topEoId, score: 50,
                                    title: eo.shortTitle || eo.originalTitle || 'Executive Order',
                                    body: (eo.generalSummary || '').slice(0, 120),
                                    emoji: '📜',
                                });
                            }
                        }
                    }
                } catch (e) { console.warn('[Daily] EO lookup failed:', e.message); }

                // ── Top bill from feed index (1-2 Firestore reads) ───────────
                try {
                    const feedSnap = await getDoc(doc(db, 'feedIndex', 'latestBills'));
                    if (feedSnap.exists()) {
                        const bills = feedSnap.data().bills || [];
                        const statusScore = {
                            'Signed into Law': 55, 'Passed Both Chambers': 45,
                            'Presented to President': 40, 'Passed Senate': 35,
                            'Passed House': 30, 'Reported': 20,
                        };
                        // Find the most significant bill
                        let bestBill = null;
                        let bestScore = 0;
                        for (const b of bills.slice(0, 50)) {
                            const s = statusScore[b.status] || 5;
                            if (s > bestScore) { bestBill = b; bestScore = s; }
                        }
                        if (bestBill) {
                            const billCached = await getDoc(doc(db, 'billSummaries', bestBill.id));
                            if (billCached.exists()) {
                                const data = billCached.data();
                                if (data.impactLevel === 'High Impact') bestScore += 10;
                                candidates.push({
                                    id: bestBill.id, score: bestScore,
                                    title: data.shortTitle || data.originalTitle || bestBill.title,
                                    body: (data.generalSummary || '').slice(0, 120),
                                    emoji: '📋',
                                });
                            }
                        }
                    }
                } catch (e) { console.warn('[Daily] Bill lookup failed:', e.message); }

                // ── Pick the best candidate (avoid yesterday's pick) ─────────
                const lastId = lastHighlightSnap.exists() ? lastHighlightSnap.data().itemId : null;
                candidates.sort((a, b) => b.score - a.score);
                const pick = candidates.find(c => c.id !== lastId) || candidates[0];

                if (pick) {
                    const result = await sendPushToAllUsers(
                        `${pick.emoji} Daily Highlight`,
                        pick.title,
                        { type: 'daily_highlight', id: pick.id }
                    );
                    pushSent += result.totalSent;

                    await setDoc(doc(db, 'cronHealth', 'lastDailyHighlight'), {
                        date: today,
                        itemId: pick.id,
                        itemTitle: pick.title,
                        itemEmoji: pick.emoji,
                        score: pick.score,
                        totalCandidates: candidates.length,
                        sentAt: new Date().toISOString(),
                    });
                    console.log(`[Daily] Sent: ${pick.emoji} ${pick.title} (score: ${pick.score}, candidates: ${candidates.length})`);
                }
            } else {
                console.log('[Daily] Highlight already sent today');
            }
        } catch (e) {
            console.warn('[Daily] Daily highlight failed:', e.message);
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
