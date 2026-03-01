export const mockCivicItems = [
    {
        id: 'bill-hr-4291',
        type: 'Bill',
        level: 'Federal',
        date: 'Introduced 2 days ago',
        title: 'Affordable Housing Investment Act of 2026',
        impactLevel: 'High Impact',
        generalSummary: 'This bill would create a $50 billion federal fund to subsidize the construction of middle-income rental housing in high-growth cities.',
        tagImpacts: {
            'Renter': 'As a renter, this could increase the supply of affordable apartments in your area over the next 3-5 years, potentially stabilizing your rent costs.',
            'Homeowner': 'This bill may affect local zoning laws in your area to allow for more multi-family housing units near single-family neighborhoods.',
            'Parent': 'Increased housing supply often leads to shifts in local school district funding and enrollment numbers.'
        },
        sponsors: ['Rep. Jane Doe (D-NY)', 'Rep. John Smith (R-TX)'],
        locationMatches: [], // Empty means it applies nationally
        likes: 12450,
        dislikes: 3820
    },
    {
        id: 'exec-clean-energy',
        type: 'Executive',
        level: 'Federal',
        date: 'Signed yesterday',
        title: 'Executive Order on Clean Energy Infrastructure',
        impactLevel: 'Moderate Impact',
        generalSummary: 'Directs the Department of Energy to fast-track permits for wind and solar projects on public lands and offers new tax incentives for residential solar panel installations.',
        tagImpacts: {
            'Homeowner': 'If you are planning to upgrade your home, you will now be eligible for up to 40% back on solar installations through updated tax credits.',
            'Small Business Owner': 'New federal grants will be available next quarter for businesses transitioning to renewable energy sources.',
            'Commuter': 'Funding is directed towards expanding EV charging stations along major interstate highways.'
        },
        sponsors: [],
        locationMatches: [],
        likes: 8900,
        dislikes: 4100
    },
    {
        id: 'law-data-privacy',
        type: 'Law',
        level: 'State',
        date: 'Enacted last week',
        title: 'Consumer Data Privacy Protection Act',
        impactLevel: 'High Impact',
        generalSummary: 'Requires companies to obtain explicit opt-in consent before selling user data and grants citizens the right to request deletion of their personal information.',
        tagImpacts: {
            'Small Business Owner': 'If your business collects customer data via a website, you have 90 days to update your privacy policy and implement a consent banner to avoid fines.',
            'Freelancer': 'You must ensure any third-party tools you use for client management comply with the new data deletion request workflows.'
        },
        sponsors: ['State Sen. Alex Rivera'],
        locationMatches: ['CA', 'NY', 'WA', '90210'], // Simulated state-level match
        likes: 24500,
        dislikes: 1200
    },
    {
        id: 'court-tenant-rights',
        type: 'Court',
        level: 'Local',
        date: 'Decided 3 days ago',
        title: 'City Supreme Court Rules on Eviction Moratoriums',
        impactLevel: 'Moderate Impact',
        generalSummary: 'The court ruled that the temporary pandemic-era eviction moratoriums can no longer be extended by city council without a specific public health emergency declaration.',
        tagImpacts: {
            'Renter': 'If you were relying on the city\'s extended eviction protections, those are now void. Standard 30-day eviction notice rules apply immediately.',
            'Homeowner': 'If you rent out a portion of your property, you may now proceed with standard eviction proceedings for non-payment of rent.'
        },
        sponsors: [],
        locationMatches: ['90210', 'Los Angeles', 'Austin'],
        likes: 5600,
        dislikes: 8900
    },
    {
        id: 'bill-student-loan',
        type: 'Bill',
        level: 'Federal',
        date: 'In Committee',
        title: 'Higher Education Interest Rate Cap Act',
        impactLevel: 'High Impact',
        generalSummary: 'Caps the interest rate on all new federally backed student loans at 3% and allows existing borrowers to refinance at the new capped rate.',
        tagImpacts: {
            'Student': 'You will be able to lock in a 3% interest rate for your remaining semesters, significantly lowering your lifelong repayment amount.',
            'Parent': 'If you hold Parent PLUS loans, you will be eligible to refinance those loans down to the 3% cap during the open enrollment period next year.'
        },
        sponsors: ['Sen. Elizabeth Warren (D-MA)'],
        locationMatches: [],
        likes: 45000,
        dislikes: 15400
    }
];
