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

const SYSTEM_PROMPT = `You are an expert, neutral, nonpartisan civic analyst.
Your job is to read executive order summaries and output a JSON array.
For each order, provide:
- shortTitle: A very short, punchy plain-English title (max 6-8 words).
- originalTitle: The exact original title provided.
- generalSummary: A simple, plain-English summary of what the order does. Maximum 2 sentences.
- impactLevel: One of "High Impact", "Moderate Impact", or "Low Impact".
- status: Always "Signed into Law" for executive orders.
- tagImpacts: A JSON object where keys are the specific Life Tags provided, and values are a 1-sentence explanation of why this order matters to someone with that tag. Only include tags with a genuine impact.

Return ONLY valid JSON in the format:
{ "orders": [ { "id": "...", "shortTitle": "...", "originalTitle": "...", "url": "...", "type": "Executive Order", "level": "Federal", "date": "...", "generalSummary": "...", "impactLevel": "...", "status": "Signed into Law", "latestAction": "Signed by the President", "tagImpacts": {}, "sponsors": [], "locationMatches": [], "likes": 0, "dislikes": 0 } ] }`;

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
        console.warn('EO cache write failed:', err.message);
    }
}

export async function POST(request) {
    try {
        const { lifeTags, interests } = await request.json();

        // Fetch recent executive orders from the Federal Register (free, no key needed)
        const frParams = new URLSearchParams();
        frParams.append('conditions[type][]', 'PRESDOCU');
        frParams.append('conditions[presidential_document_type][]', 'executive_order');
        frParams.append('per_page', '10');
        frParams.append('order', 'newest');
        frParams.append('fields[]', 'document_number');
        frParams.append('fields[]', 'title');
        frParams.append('fields[]', 'abstract');
        frParams.append('fields[]', 'signing_date');
        frParams.append('fields[]', 'html_url');
        frParams.append('fields[]', 'executive_order_number');
        const frUrl = `https://www.federalregister.gov/api/v1/documents.json?${frParams.toString()}`;

        const frRes = await fetch(frUrl);
        if (!frRes.ok) {
            const errText = await frRes.text();
            console.error(`Federal Register API error: ${frRes.status} - ${errText.substring(0, 200)}`);
            throw new Error(`Federal Register API error: ${frRes.status}`);
        }
        const frData = await frRes.json();
        const orders = frData.results || [];

        // Shape raw orders for lookup
        const ordersForProcessing = orders.map(o => ({
            id: `eo-${o.document_number || o.executive_order_number}`,
            title: o.title,
            abstract: o.abstract || '',
            date: o.signing_date || '',
            url: o.html_url || '',
            eoNumber: o.executive_order_number,
        }));

        // Check Firestore cache in parallel
        const cacheResults = await Promise.all(
            ordersForProcessing.map(o => getCachedSummary(o.id))
        );

        const cachedItems = [];
        const uncached = [];

        ordersForProcessing.forEach((order, i) => {
            if (cacheResults[i]) {
                cachedItems.push({ ...cacheResults[i], url: order.url });
            } else {
                uncached.push(order);
            }
        });

        let aiItems = [];
        if (uncached.length > 0) {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
            const interestsText = interests?.length
                ? `\n\nThe user is interested in: ${interests.join(', ')}.`
                : '';
            const userPrompt = `Summarize these executive orders and generate tagImpacts for Life Tags: ${(lifeTags || []).join(', ') || 'None'}.${interestsText}\n\nOrders:\n${JSON.stringify(uncached, null, 2)}`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                response_format: { type: 'json_object' },
            });

            const parsed = JSON.parse(completion.choices[0].message.content);
            aiItems = parsed.orders || [];

            // Cache fire-and-forget
            aiItems.forEach(item => {
                if (item.id) {
                    cacheSummary(item.id, {
                        id: item.id,
                        shortTitle: item.shortTitle,
                        originalTitle: item.originalTitle,
                        generalSummary: item.generalSummary,
                        impactLevel: item.impactLevel,
                        status: 'Signed into Law',
                        latestAction: 'Signed by the President',
                        type: 'Executive Order',
                        level: 'Federal',
                        date: item.date || '',
                        sponsors: [],
                        locationMatches: [],
                        likes: 0,
                        dislikes: 0,
                    });
                }
            });
        }

        // Merge cached + AI results preserving order
        const allById = new Map();
        [...cachedItems, ...aiItems].forEach(item => {
            if (item.id) allById.set(item.id, item);
        });
        const items = ordersForProcessing
            .map(o => allById.get(o.id))
            .filter(Boolean);

        return NextResponse.json({ items });

    } catch (error) {
        console.error('Executive orders API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
