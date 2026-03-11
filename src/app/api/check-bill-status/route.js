import { NextResponse } from 'next/server';

const STATUS_ORDER = [
    'Introduced', 'In Committee', 'Passed House', 'Passed Senate',
    'Passed Both Chambers', 'Signed into Law', 'Failed'
];

function mapCongressStatus(actions) {
    if (!actions || actions.length === 0) return 'Introduced';
    const text = actions.map(a => (a.text || '').toLowerCase()).join(' ');
    if (text.includes('became public law') || text.includes('signed by president')) return 'Signed into Law';
    if (text.includes('passed senate') && text.includes('passed house')) return 'Passed Both Chambers';
    if (text.includes('passed senate')) return 'Passed Senate';
    if (text.includes('passed house') || text.includes('on passage')) return 'Passed House';
    if (text.includes('committee')) return 'In Committee';
    return 'Introduced';
}

function mapOpenStatesStatus(actionText) {
    const lower = (actionText || '').toLowerCase();
    if (lower.includes('signed') || lower.includes('chaptered') || lower.includes('enacted')) return 'Signed into Law';
    if (lower.includes('passed') && lower.includes('senate') && lower.includes('assembly')) return 'Passed Both Chambers';
    if (lower.includes('passed senate') || lower.includes('passed in senate')) return 'Passed Senate';
    if (lower.includes('passed assembly') || lower.includes('passed house') || lower.includes('ayes')) return 'Passed House';
    if (lower.includes('committee') || lower.includes('referred')) return 'In Committee';
    return 'Introduced';
}

async function checkFederalBill(billIdentifier) {
    const apiKey = process.env.CONGRESS_API_KEY;
    if (!apiKey) return null;

    // billIdentifier is like "hr1234" or "s567" or "state-CA-SB123"
    // For federal bills, format is type+number e.g. "hr-1234"
    const match = billIdentifier.match(/^([a-z]+)-?(\d+)$/i);
    if (!match) return null;

    const [, type, number] = match;
    const url = `https://api.congress.gov/v3/bill/119/${type}/${number}/actions?limit=5&api_key=${apiKey}`;

    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return mapCongressStatus(data.actions || []);
    } catch {
        return null;
    }
}

async function checkStateBill(billIdentifier, state) {
    const apiKey = process.env.OPENSTATES_API_KEY;
    if (!apiKey || !state) return null;

    // billIdentifier for state bills is like "state-CA-SB123"
    // OpenStates needs the openstates bill ID, which we don't store, so use the bill identifier
    const idPart = billIdentifier.replace(/^state-[A-Z]+-/, '');
    const url = `https://v3.openstates.org/bills?jurisdiction=${state}&identifier=${encodeURIComponent(idPart)}&include=actions&apikey=${apiKey}`;

    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const bill = data.results?.[0];
        if (!bill) return null;
        return mapOpenStatesStatus(bill.latest_action_description || '');
    } catch {
        return null;
    }
}

export async function POST(request) {
    try {
        const { bills } = await request.json();
        if (!bills || bills.length === 0) {
            return NextResponse.json({ results: [] });
        }

        const results = await Promise.allSettled(
            bills.map(async (bill) => {
                let currentStatus = null;

                if (bill.level === 'State' && bill.state) {
                    currentStatus = await checkStateBill(bill.billIdentifier, bill.state);
                } else {
                    currentStatus = await checkFederalBill(bill.billIdentifier);
                }

                if (!currentStatus) {
                    // Can't determine status — no change reported
                    return {
                        id: bill.id,
                        title: bill.title || bill.id,
                        oldStatus: bill.status,
                        currentStatus: bill.status,
                        changed: false,
                    };
                }

                const oldIdx = STATUS_ORDER.indexOf(bill.status);
                const newIdx = STATUS_ORDER.indexOf(currentStatus);
                const changed = newIdx > oldIdx; // Only flag as changed if status advanced

                return {
                    id: bill.id,
                    title: bill.title || bill.id,
                    oldStatus: bill.status,
                    currentStatus,
                    changed,
                };
            })
        );

        return NextResponse.json({
            results: results
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value),
        });

    } catch (error) {
        console.error('check-bill-status error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
