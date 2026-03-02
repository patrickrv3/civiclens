'use client';

import styles from './RepCard.module.css';

const ExternalLinkIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
);

const MapPinIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
);

const CalendarIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
);

const ClockIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
);

export default function RepCard({ member }) {
    const partyClass = member.party === 'D' ? styles.cardDem
        : member.party === 'R' ? styles.cardRep
            : styles.cardInd;

    const partyBadgeClass = member.party === 'D' ? styles.partyD
        : member.party === 'R' ? styles.partyR
            : styles.partyI;

    const initials = member.name
        ?.split(',')[0]
        ?.split(' ')
        .map(w => w[0])
        .join('')
        .substring(0, 2) || '?';

    const districtLabel = member.chamber === 'Senate'
        ? member.state
        : member.district ? `${member.state}-${member.district}` : `${member.state} At-Large`;

    const servingSince = member.startYear ? `Serving since ${member.startYear}` : '';

    return (
        <div className={`${styles.card} ${partyClass}`}>
            {member.photo ? (
                <img
                    src={member.photo}
                    alt={member.name}
                    className={styles.photo}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                />
            ) : null}
            <div className={styles.photoPlaceholder} style={member.photo ? { display: 'none' } : {}}>
                {initials}
            </div>

            <div className={styles.info}>
                <div className={styles.nameRow}>
                    <span className={styles.name}>{member.name}</span>
                    <span className={`${styles.partyBadge} ${partyBadgeClass}`}>
                        {member.partyFull}
                    </span>
                    <span className={styles.chamberBadge}>
                        {member.chamber}
                    </span>
                </div>

                <div className={styles.details}>
                    <span className={styles.detail}>
                        <MapPinIcon />
                        {districtLabel}
                    </span>
                    {servingSince && (
                        <span className={styles.detail}>
                            <CalendarIcon />
                            {servingSince}
                        </span>
                    )}
                </div>

                {member.termEnd && (
                    <div className={styles.termEnd}>
                        <ClockIcon />
                        Term ends {member.termEnd}
                    </div>
                )}

                <div className={styles.actions}>
                    <a
                        href={member.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.actionBtn}
                    >
                        <ExternalLinkIcon />
                        Congress.gov Profile
                    </a>
                </div>
            </div>
        </div>
    );
}
