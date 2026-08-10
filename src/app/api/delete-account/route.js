import { NextResponse } from 'next/server';
import { getAdminDb } from '../../lib/firebase-admin';

export const maxDuration = 30;

export async function POST(request) {
    try {
        const { uid } = await request.json();
        if (!uid) {
            return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
        }

        const db = getAdminDb();
        const userRef = db.collection('users').doc(uid);

        // Delete all subcollections
        const subcollections = ['devices', 'notifications', 'watchedBills'];
        for (const sub of subcollections) {
            const snap = await userRef.collection(sub).get();
            const batch = db.batch();
            snap.docs.forEach(doc => batch.delete(doc.ref));
            if (!snap.empty) await batch.commit();
        }

        // Delete the user document itself
        await userRef.delete();

        // Also clean up any cached bill summaries that reference this user
        // (none currently, but future-proof)

        console.log(`[Account] Deleted all data for user ${uid}`);
        return NextResponse.json({ success: true, deleted: uid });
    } catch (error) {
        console.error('[Account] Delete failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
