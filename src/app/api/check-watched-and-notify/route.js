import { NextResponse } from 'next/server';
import { getAdminDb, sendPushToUser, sendPushToAllUsers } from '../../lib/firebase-admin';

export const maxDuration = 60;

/**
 * POST /api/check-watched-and-notify
 *
 * Server-side cron job that:
 * 1. Finds all users with watched bills
 * 2. Checks each unique bill for status changes via Congress.gov / OpenStates
 * 3. Sends push notifications to users whose watched bills changed status
 *
 * Called by the daily warm-cache cron or directly by Vercel cron.
 * Protected by CRON_SECRET.
 */

const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY;

// Status progression order (same as check-bill-status/route.js)
const STATUS_ORDER = [
    'Introduced',
    'In Committee',
    'Passed House',
    'Passed Senate',
    'Passed Both Chambers',
    'Signed into Law',
    'Failed',
];

function mapCongressStatus(actions) {
    const text = actions.map(a => (a.text || '').toLowerCase()).join(' | ');
    if (text.includes('became public law') || text.includes('signed by president')) return 'Signed into Law';
    if (text.includes('passed senate') && text.includes('passed house')) return 'Passed Both Chambers';
    if (text.includes('passed senate') || text.includes('passed/agreed to in senate')) return 'Passed Senate';
    if (text.includes('passed house') || text.includes('passed/agreed to in house')) return 'Passed House';
    if (text.includes('committee') || text.includes('referred to')) return 'In Committee';
    return 'Introduced';
}

function mapOpenStatesStatus(actions) {
    const text = actions.map(a => (a.description || '').toLowerCase()).join(' | ');
    if (text.includes('signed') || text.includes('chaptered') || text.includes('enacted')) return 'Signed into Law';
    if (text.includes('passed second') && text.includes('passed third')) return 'Passed Both Chambers';
    if (text.includes('passed senate')) return 'Passed Senate';
    if (text.includes('passed house') || text.includes('passed assembly')) return 'Passed House';
    if (text.includes('committee')) return 'In Committee';
    return 'Introduced';
}

async function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export async function POST(request) {
    // Verify authorization
    const authHeader = request.headers.get('authorization');
    const isInternalCron = request.headers.get('x-internal-cron') === 'true';
    if (!isInternalCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminDb = getAdminDb();
    const startTime = Date.now();
    const results = { usersChecked: 0, billsChecked: 0, notificationsSent: 0, errors: [] };

    try {
        // 1. Get all watched bills across all users
        const watchedSnap = await adminDb.collectionGroup('watchedBills').get();

        if (watchedSnap.empty) {
            return NextResponse.json({ ...results, message: 'No watched bills found' });
        }

        // 2. Build a map: billId -> { bill info, userIds[] }
        const billMap = {}; // billId -> { billIdentifier, level, state, status, users: [{uid, docRef}] }
        const userSet = new Set();

        watchedSnap.docs.forEach(docSnap => {
            const data = docSnap.data();
            const uid = docSnap.ref.parent.parent.id;
            userSet.add(uid);

            // Skip court rulings (they start with "court-") — handle separately if needed
            if (data.id?.startsWith('court-')) return;

            if (!billMap[data.id]) {
                billMap[data.id] = {
                    billIdentifier: data.billIdentifier || data.id,
                    level: data.level || 'Federal',
                    state: data.state || null,
                    currentStatus: data.status || 'Introduced',
                    users: [],
                };
            }
            billMap[data.id].users.push({ uid, docRef: docSnap.ref, storedStatus: data.status || 'Introduced' });
        });

        results.usersChecked = userSet.size;
        const billIds = Object.keys(billMap);
        results.billsChecked = billIds.length;

        // 3. Check each unique bill for status changes (rate-limited)
        const changedBills = [];

        for (const billId of billIds) {
            // Respect Vercel 60s timeout — stop if we're running low on time
            if (Date.now() - startTime > 50000) {
                results.errors.push(`Timeout guard: stopped after checking ${changedBills.length} bills`);
                break;
            }

            const bill = billMap[billId];
            let newStatus = null;

            try {
                if (bill.level === 'Federal') {
                    // Parse bill identifier: "hr-1234" -> type=hr, number=1234
                    const parts = bill.billIdentifier.split('-');
                    const type = parts[0];
                    const number = parts[parts.length - 1];

                    if (type && number) {
                        const actionsUrl = `https://api.congress.gov/v3/bill/119/${type}/${number}/actions?api_key=${CONGRESS_API_KEY}&limit=10`;
                        const res = await fetch(actionsUrl, { signal: AbortSignal.timeout(8000) });
                        if (res.ok) {
                            const data = await res.json();
                            newStatus = mapCongressStatus(data.actions || []);
                        }
                    }
                } else if (bill.level === 'State' && bill.state) {
                    // OpenStates API for state bills
                    const query = `query { bill(jurisdiction: "${bill.state}", session: "2025", identifier: "${bill.billIdentifier}") { actions { description } } }`;
                    const res = await fetch('https://v3.openstates.org/graphql', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-KEY': OPENSTATES_API_KEY,
                        },
                        body: JSON.stringify({ query }),
                        signal: AbortSignal.timeout(8000),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        newStatus = mapOpenStatesStatus(data.data?.bill?.actions || []);
                    }
                }

                if (newStatus) {
                    const newIdx = STATUS_ORDER.indexOf(newStatus);

                    // Check each user's stored status against the new status
                    for (const userEntry of bill.users) {
                        const oldIdx = STATUS_ORDER.indexOf(userEntry.storedStatus);
                        if (newIdx > oldIdx && newIdx !== -1) {
                            changedBills.push({
                                billId,
                                billTitle: billMap[billId].users[0]?.storedStatus, // We'll fix title below
                                oldStatus: userEntry.storedStatus,
                                newStatus,
                                uid: userEntry.uid,
                                docRef: userEntry.docRef,
                            });
                        }
                    }
                }
            } catch (err) {
                results.errors.push(`Failed to check ${billId}: ${err.message}`);
            }

            // Rate limit: wait 200ms between API calls
            await delay(200);
        }

        // 4. Send notifications for changed bills
        for (const change of changedBills) {
            try {
                // Get the bill title from Firestore
                const watchedDoc = await change.docRef.get();
                const billData = watchedDoc.data() || {};
                const title = billData.shortTitle || billData.title || change.billId;

                // Update the stored status
                await change.docRef.update({ status: change.newStatus });

                // Create an in-app notification
                await adminDb.collection('users').doc(change.uid).collection('notifications').add({
                    billId: change.billId,
                    billTitle: title,
                    oldStatus: change.oldStatus,
                    newStatus: change.newStatus,
                    type: 'bill',
                    createdAt: new Date(),
                    read: false,
                });

                // Send push notification
                const pushResult = await sendPushToUser(
                    change.uid,
                    title,
                    `Status changed: ${change.oldStatus} → ${change.newStatus}`,
                    { billId: change.billId, type: 'watched_bill' },
                    'watched'
                );
                results.notificationsSent += pushResult.sent;
            } catch (err) {
                results.errors.push(`Failed to notify ${change.uid} for ${change.billId}: ${err.message}`);
            }
        }

        console.log(`[WatchedCheck] Done: ${results.usersChecked} users, ${results.billsChecked} bills, ${results.notificationsSent} push sent`);
        return NextResponse.json(results);

    } catch (err) {
        console.error('[WatchedCheck] Fatal error:', err);
        results.errors.push(`Fatal: ${err.message}`);
        return NextResponse.json(results, { status: 500 });
    }
}
