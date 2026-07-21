import { NextResponse } from 'next/server';
import { getAdminDb, getAdminMessaging } from '../../lib/firebase-admin';

/**
 * POST /api/test-push
 * Sends a test push notification with verbose debugging.
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

        const db = getAdminDb();
        const messaging = getAdminMessaging();

        // Get device tokens
        const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();
        const devices = devicesSnap.docs.map(d => ({
            id: d.id,
            token: d.data().token?.substring(0, 30) + '...',
            enabled: d.data().enabled,
            platform: d.data().platform,
        }));

        if (devicesSnap.empty) {
            return NextResponse.json({ error: 'No devices found', uid, devices });
        }

        const tokens = devicesSnap.docs
            .filter(d => d.data().enabled && d.data().token)
            .map(d => d.data().token);

        if (tokens.length === 0) {
            return NextResponse.json({ error: 'No enabled tokens', uid, devices });
        }

        // Send directly with full error details
        const message = {
            notification: {
                title: '🔔 Test from Civisly',
                body: 'Push notifications are working!',
            },
            data: { type: 'test' },
            tokens,
            apns: {
                payload: {
                    aps: { sound: 'default', badge: 1 },
                },
            },
        };

        const response = await messaging.sendEachForMulticast(message);

        const details = response.responses.map((resp, i) => ({
            success: resp.success,
            messageId: resp.messageId || null,
            error: resp.error ? {
                code: resp.error.code,
                message: resp.error.message,
            } : null,
        }));

        return NextResponse.json({
            success: response.successCount > 0,
            successCount: response.successCount,
            failureCount: response.failureCount,
            devices,
            details,
        });
    } catch (err) {
        console.error('[TestPush] Error:', err);
        return NextResponse.json({
            error: err.message,
            code: err.code,
            stack: err.stack?.split('\n').slice(0, 3),
        }, { status: 500 });
    }
}
