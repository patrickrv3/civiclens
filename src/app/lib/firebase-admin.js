import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// Singleton Firebase Admin initialization
function initAdmin() {
    if (getApps().length === 0) {
        initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
                clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        });
    }
}

export function getAdminDb() {
    initAdmin();
    return getFirestore();
}

export function getAdminMessaging() {
    initAdmin();
    return getMessaging();
}

/**
 * Send a push notification to a specific user.
 * Reads device tokens from users/{uid}/devices/ and sends via FCM.
 * Automatically cleans up stale tokens that FCM rejects.
 *
 * @param {string} uid - Firebase user ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} data - Optional data payload for deep linking
 * @param {string} category - 'watched' | 'general' (for filtering by user preferences)
 * @returns {object} { sent: number, failed: number, cleaned: number }
 */
export async function sendPushToUser(uid, title, body, data = {}, category = 'general') {
    const db = getAdminDb();
    const messaging = getAdminMessaging();

    // Check user's notification preferences
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data() || {};
    const prefs = userData.notificationPreferences || { watchedBills: true, general: true };

    // Respect user preferences
    if (category === 'watched' && !prefs.watchedBills) return { sent: 0, failed: 0, cleaned: 0 };
    if (category === 'general' && !prefs.general) return { sent: 0, failed: 0, cleaned: 0 };

    // Get all device tokens for this user
    const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();

    if (devicesSnap.empty) {
        return { sent: 0, failed: 0, cleaned: 0 };
    }

    const tokens = [];
    const tokenDocRefs = {};

    devicesSnap.docs.forEach(doc => {
        const deviceData = doc.data();
        if (deviceData.enabled && deviceData.token) {
            tokens.push(deviceData.token);
            tokenDocRefs[deviceData.token] = doc.ref;
        }
    });

    if (tokens.length === 0) {
        return { sent: 0, failed: 0, cleaned: 0 };
    }

    // Build the notification message
    const message = {
        notification: { title, body },
        data: { ...data, category },
        tokens,
        apns: {
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1,
                },
            },
        },
    };

    let sent = 0;
    let failed = 0;
    let cleaned = 0;

    try {
        const response = await messaging.sendEachForMulticast(message);
        sent = response.successCount;
        failed = response.failureCount;

        // Clean up stale tokens
        if (response.failureCount > 0) {
            const cleanupPromises = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (
                        errorCode === 'messaging/registration-token-not-registered' ||
                        errorCode === 'messaging/invalid-registration-token'
                    ) {
                        const staleToken = tokens[idx];
                        const ref = tokenDocRefs[staleToken];
                        if (ref) {
                            cleanupPromises.push(ref.delete());
                            cleaned++;
                        }
                    }
                    console.warn(`[Push] Failed to send to token ${idx}: ${resp.error?.code}`);
                }
            });

            if (cleanupPromises.length > 0) {
                await Promise.all(cleanupPromises);
                console.log(`[Push] Cleaned up ${cleaned} stale tokens for user ${uid}`);
            }
        }
    } catch (error) {
        console.error(`[Push] Error sending to user ${uid}:`, error.message);
        failed = tokens.length;
    }

    return { sent, failed, cleaned };
}

/**
 * Send a push notification to ALL users with push enabled.
 * Used for general high-impact alerts (new SCOTUS ruling, major bill, etc.)
 *
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} data - Optional data payload
 * @returns {object} { totalUsers: number, totalSent: number, totalFailed: number }
 */
export async function sendPushToAllUsers(title, body, data = {}) {
    const db = getAdminDb();

    // Get all users who have device tokens
    const usersSnap = await db.collectionGroup('devices')
        .where('enabled', '==', true)
        .get();

    // Group tokens by user UID
    const userTokens = {};
    usersSnap.docs.forEach(doc => {
        const uid = doc.ref.parent.parent.id;
        if (!userTokens[uid]) userTokens[uid] = [];
        userTokens[uid].push(doc.data().token);
    });

    const userIds = Object.keys(userTokens);
    let totalSent = 0;
    let totalFailed = 0;

    // Send to each user (respects individual preferences)
    for (const uid of userIds) {
        const result = await sendPushToUser(uid, title, body, data, 'general');
        totalSent += result.sent;
        totalFailed += result.failed;
    }

    return { totalUsers: userIds.length, totalSent, totalFailed };
}
