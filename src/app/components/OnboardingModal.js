'use client';

import { useState } from 'react';
import { useProfile } from '../context/ProfileContext';
import styles from './OnboardingModal.module.css';

const LIFE_TAGS = [
    'Full-Time Worker', 'Part-Time Worker', 'Freelancer', 'Unemployed',
    'Retired', 'Renter', 'Homeowner', 'Student', 'Parent',
    'Veteran', 'Small Business Owner', 'Commuter',
    'Healthcare Worker', 'Educator', 'Senior'
];

const TOPIC_INTERESTS = [
    'Economy & Jobs', 'Healthcare', 'Immigration',
    'Education', 'Housing', 'Climate & Environment',
    'Criminal Justice', 'Gun Policy', 'Taxes',
    'Civil Rights', 'Technology & Privacy', 'Foreign Policy',
    'National Security', 'Social Security & Medicare', 'Infrastructure',
    'Labor & Unions', 'Veterans Affairs', 'Agriculture'
];

const TOTAL_STEPS = 4;

export default function OnboardingModal({ isOpen, onClose }) {
    const { profile, updateProfile } = useProfile();

    // Local state for the form so we don't commit it until they click "Save"
    const [step, setStep] = useState(1);
    const [zipCode, setZipCode] = useState(profile.location.zipCode || '');
    const [selectedTags, setSelectedTags] = useState(profile.lifeTags || []);
    const [selectedInterests, setSelectedInterests] = useState(profile.interests || []);
    const [wantsPersonalized, setWantsPersonalized] = useState(profile.wantsPersonalizedImpact ?? true);

    if (!isOpen) return null;

    const toggleTag = (tag) => {
        if (selectedTags.includes(tag)) {
            setSelectedTags(selectedTags.filter(t => t !== tag));
        } else {
            setSelectedTags([...selectedTags, tag]);
        }
    };

    const toggleInterest = (topic) => {
        if (selectedInterests.includes(topic)) {
            setSelectedInterests(selectedInterests.filter(t => t !== topic));
        } else {
            setSelectedInterests([...selectedInterests, topic]);
        }
    };

    const handleSaveAndClose = () => {
        updateProfile({
            hasCompletedOnboarding: true,
            location: { ...profile.location, zipCode },
            lifeTags: selectedTags,
            interests: selectedInterests,
            wantsPersonalizedImpact: wantsPersonalized
        });
        onClose();
        // Reset back to step 1 for the next time it's opened
        setTimeout(() => setStep(1), 300);
    };

    const currentStepProgress = (step / TOTAL_STEPS) * 100;

    return (
        <div className={styles.overlay}>
            <div className={styles.modal} role="dialog" aria-modal="true">

                {/* Header */}
                <div className={styles.header}>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                    <h2 className={styles.title}>Personalize your Feed</h2>
                    <p className={styles.subtitle}>
                        Tell us a bit about yourself so CivicLens can filter the noise.
                    </p>
                </div>

                {/* Progress */}
                <div className={styles.progressWrap}>
                    <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${currentStepProgress}%` }} />
                    </div>
                </div>

                {/* Body */}
                <div className={styles.body}>
                    {step === 1 && (
                        <div className={styles.view}>
                            <div className={styles.inputGroup}>
                                <label className={styles.label} htmlFor="zipcode">What&apos;s your Zip Code?</label>
                                <input
                                    autoFocus
                                    id="zipcode"
                                    type="text"
                                    className={styles.input}
                                    placeholder="e.g. 90210"
                                    value={zipCode}
                                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                    maxLength={5}
                                />
                                <p className={styles.settingDesc} style={{ marginTop: '8px' }}>
                                    We use this to find your local representatives and state-level updates.
                                </p>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className={styles.view}>
                            <label className={styles.label}>Select your Life Tags</label>
                            <p className={styles.settingDesc} style={{ marginBottom: '16px' }}>
                                This helps our AI identify bills and laws that specifically affect your daily life.
                            </p>
                            <div className={styles.tagsGrid}>
                                {LIFE_TAGS.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => toggleTag(tag)}
                                        className={`${styles.tagBtn} ${selectedTags.includes(tag) ? styles.selected : ''}`}
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className={styles.view}>
                            <label className={styles.label}>Topics You Care About</label>
                            <p className={styles.settingDesc} style={{ marginBottom: '16px' }}>
                                Select the policy topics you want to follow. Your feed will prioritize legislation in these areas.
                            </p>
                            <div className={styles.tagsGrid}>
                                {TOPIC_INTERESTS.map(topic => (
                                    <button
                                        key={topic}
                                        onClick={() => toggleInterest(topic)}
                                        className={`${styles.tagBtn} ${selectedInterests.includes(topic) ? styles.selected : ''}`}
                                    >
                                        {topic}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className={styles.view}>
                            <label className={styles.label}>AI Privacy & Settings</label>

                            <div className={styles.settingRow} onClick={() => setWantsPersonalized(!wantsPersonalized)}>
                                <div className={styles.settingInfo}>
                                    <div className={styles.settingTitle}>Personalized &quot;Why it matters&quot;</div>
                                    <div className={styles.settingDesc}>
                                        Allow our AI to use your Life Tags to explain exactly how a bill might affect you personally. Turn off for general neutral summaries only.
                                    </div>
                                </div>
                                <label className={styles.switch} onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={wantsPersonalized}
                                        onChange={(e) => setWantsPersonalized(e.target.checked)}
                                    />
                                    <span className={styles.slider}></span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    {step > 1 && (
                        <button className={styles.btnSkip} onClick={() => setStep(step - 1)} style={{ marginRight: 'auto' }}>
                            Back
                        </button>
                    )}

                    <button className={styles.btnSkip} onClick={onClose}>
                        Skip for now
                    </button>

                    {step < TOTAL_STEPS ? (
                        <button className={styles.btnPrimary} onClick={() => setStep(step + 1)}>
                            Continue
                        </button>
                    ) : (
                        <button className={styles.btnPrimary} onClick={handleSaveAndClose}>
                            Complete Setup
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
}
