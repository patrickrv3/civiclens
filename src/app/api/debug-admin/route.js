import { NextResponse } from 'next/server';

/**
 * GET /api/debug-admin
 * Checks if Firebase Admin credentials are loading correctly.
 * Protected by CRON_SECRET.
 */
export async function GET(request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

    return NextResponse.json({
        projectId: projectId || 'MISSING',
        clientEmail: clientEmail || 'MISSING',
        privateKeyExists: !!privateKey,
        privateKeyLength: privateKey?.length || 0,
        privateKeyStartsWith: privateKey?.substring(0, 30) || 'MISSING',
        privateKeyEndsWith: privateKey?.substring(privateKey.length - 30) || 'MISSING',
        privateKeyHasLiteralNewlines: privateKey?.includes('\\n') || false,
        privateKeyHasRealNewlines: privateKey?.includes('\n') || false,
        privateKeyAfterReplace: (() => {
            const k = privateKey?.replace(/\\n/g, '\n');
            return {
                startsWith: k?.substring(0, 31) || 'MISSING',
                length: k?.length || 0,
            };
        })(),
    });
}
