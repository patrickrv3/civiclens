import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
        let elections = [];

        if (apiKey) {
            // Try Google Civic Information API
            const url = `https://www.googleapis.com/civicinfo/v2/elections?key=${apiKey}`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                elections = (data.elections || [])
                    .filter(e => e.id !== '2000') // Filter out the test election
                    .map(e => ({
                        id: e.id,
                        name: e.name,
                        date: e.electionDay,
                        ocdDivisionId: e.ocdDivisionId || '',
                        level: detectLevel(e.name, e.ocdDivisionId || ''),
                    }));
            }
        }

        // If API returned no results or no key, use curated fallback data
        if (elections.length === 0) {
            elections = getFallbackElections();
        }

        // Sort by date (soonest first)
        elections.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Filter out past elections
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        elections = elections.filter(e => new Date(e.date) >= today);

        return NextResponse.json({ elections });
    } catch (error) {
        console.error('Elections API error:', error);
        // Return fallback data on error
        return NextResponse.json({ elections: getFallbackElections() });
    }
}

function detectLevel(name, ocdId) {
    const lower = (name + ' ' + ocdId).toLowerCase();
    if (lower.includes('local') || lower.includes('city') || lower.includes('county') || lower.includes('municipal')) {
        return 'local';
    }
    if (lower.includes('state') || lower.includes('governor') || lower.includes('legislature')) {
        return 'state';
    }
    return 'federal';
}

function getFallbackElections() {
    return [
        {
            id: 'midterm-2026',
            name: '2026 U.S. Midterm Elections',
            date: '2026-11-03',
            level: 'federal',
        },
        {
            id: 'primary-2026',
            name: '2026 Primary Elections',
            date: '2026-06-02',
            level: 'state',
        },
        {
            id: 'local-spring-2026',
            name: '2026 Local Spring Elections',
            date: '2026-04-07',
            level: 'local',
        },
    ];
}
