import { NextResponse } from 'next/server';
import { getAdminDb } from '../../lib/firebase-admin';

export const maxDuration = 10;

// RevenueCat webhook events documentation:
// https://www.revenuecat.com/docs/integrations/webhooks
export async function POST(request) {
    try {
        // Verify webhook authorization
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`) {
            console.warn('[RC Webhook] Unauthorized request');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const event = body.event;

        if (!event) {
            return NextResponse.json({ error: 'No event in body' }, { status: 400 });
        }

        const eventType = event.type;
        const appUserId = event.app_user_id;

        console.log(`[RC Webhook] Event: ${eventType} for user: ${appUserId}`);

        // Skip anonymous RevenueCat IDs — we only care about identified users (Firebase UIDs)
        if (!appUserId || appUserId.startsWith('$RCAnonymousID:')) {
            console.log('[RC Webhook] Skipping anonymous user');
            return NextResponse.json({ success: true });
        }

        const db = getAdminDb();
        const subRef = db.collection('users').doc(appUserId).collection('subscription').doc('pro');

        // Events that mean the user has active access
        const activeEvents = [
            'INITIAL_PURCHASE',
            'RENEWAL',
            'UNCANCELLATION',
            'NON_RENEWING_PURCHASE',
            'PRODUCT_CHANGE',
        ];

        // Events that mean the user lost access
        const inactiveEvents = [
            'CANCELLATION',
            'EXPIRATION',
            'BILLING_ISSUE',
            'SUBSCRIPTION_PAUSED',
        ];

        if (activeEvents.includes(eventType)) {
            await subRef.set({
                status: 'active',
                plan: 'pro',
                store: 'app_store',
                rcEventType: eventType,
                productId: event.product_id || null,
                expirationDate: event.expiration_at_ms || null,
                activatedAt: Date.now(),
                updatedAt: Date.now(),
            }, { merge: true });
            console.log(`[RC Webhook] Set user ${appUserId} to ACTIVE`);
        } else if (inactiveEvents.includes(eventType)) {
            await subRef.set({
                status: 'canceled',
                rcEventType: eventType,
                updatedAt: Date.now(),
            }, { merge: true });
            console.log(`[RC Webhook] Set user ${appUserId} to CANCELED`);
        } else {
            console.log(`[RC Webhook] Ignoring event type: ${eventType}`);
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[RC Webhook] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
