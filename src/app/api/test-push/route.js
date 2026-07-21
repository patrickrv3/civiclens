import { NextResponse } from 'next/server';
import { getAdminDb, sendPushToUser } from '../../lib/firebase-admin';

/**
 * POST /api/test-push
 * Sends a test push notification to the authenticated user.
 * Protected by CRON_SECRET to prevent abuse.
 */
export async function POST(request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { uid } = await request.json();
        if (!uid) {
            return NextResponse.json({ error: 'uid required' }, { status: 400 });
        }

        const result = await sendPushToUser(
            uid,
            '🔔 Test Notification',
            'Push notifications are working! You\'ll receive alerts for bill updates, court rulings, and executive orders.',
            { type: 'test' }
        );

        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        console.error('[TestPush] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
