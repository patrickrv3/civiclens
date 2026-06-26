'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import AppShell from './components/AppShell';
import styles from './page.module.css';
import { useProfile } from './context/ProfileContext';
import { useAuth } from './context/AuthContext';
import { useSubscription } from './context/SubscriptionContext';
import FeedCard from './components/FeedCard';
import UpgradeModal from './components/UpgradeModal';
import { getApiBase } from './lib/apiUrl';

/* Inline icons for the dashboard */
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export default function Home() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [activeTab, setActiveTab] = useState('All');
  const [sortBy, setSortBy] = useState('impact'); // 'impact' | 'recent'
  const [feedItems, setFeedItems] = useState([]);
  const [stateFeedItems, setStateFeedItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingMoreState, setIsLoadingMoreState] = useState(false);
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [stateHasMore, setStateHasMore] = useState(false);
  const [stateNextPage, setStateNextPage] = useState(2);
  const [stateInfo, setStateInfo] = useState(null);
  const hasLoadedOnce = useRef(false);
  const hasLoadedState = useRef(false);
  const sentinelRef = useRef(null);
  const isLoadingMoreRef = useRef(false);
  const isLoadingMoreStateRef = useRef(false);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Layer 1: Fetch the base feed ONCE on mount (Congress bills + Executive Orders + OpenAI summaries)
  useEffect(() => {
    async function fetchBaseFeed() {
      setIsLoading(true);
      setError(null);
      try {
        const payload = {
          lifeTags: profile?.lifeTags || [],
          interests: profile?.interests || [],
          offset: 0,
          sortBy, // tell the API which mode so it uses correct batch size + ordering
        };

        // Fetch bills and executive orders in parallel — EO fetch is fully isolated
        const base = getApiBase();
        const [feedRes, eoRes] = await Promise.all([
          fetch(`${base}/api/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          fetch(`${base}/api/executive-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => null), // Network-level failure is non-fatal
        ]);

        // Safely parse feed response — Vercel sometimes returns HTML error pages
        let feedData;
        try {
          const feedText = await feedRes.text();
          feedData = JSON.parse(feedText);
        } catch {
          console.error('Feed response was not valid JSON — Vercel may have returned an error page');
          throw new Error('Server temporarily unavailable. Please pull to refresh.');
        }
        if (!feedRes.ok) throw new Error(feedData.error || 'Failed to fetch feed');

        // Safely parse EOs — any failure here is non-fatal
        let eoItems = [];
        try {
          if (eoRes && eoRes.ok) {
            const eoData = await eoRes.json();
            eoItems = eoData.items || [];
          }
        } catch {
          console.warn('Executive orders parse failed — feed will show bills only');
        }

        const impactOrd = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
        // Merge and pre-sort by impact so filteredItems never re-sorts and causes scroll jumps
        const allFederal = [...(feedData.items || []), ...eoItems].sort(
          (a, b) => (impactOrd[a.impactLevel] ?? 3) - (impactOrd[b.impactLevel] ?? 3)
        );

        setFeedItems(allFederal);
        setHasMore(feedData.hasMore || false);
        setNextOffset(feedData.nextOffset || 0);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
    fetchBaseFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs ONCE on mount

  // Scroll anchor — captures scroll at the exact moment new items are about to be painted
  const scrollAnchorY = useRef(null);

  // Load more bills — used by IntersectionObserver
  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMore) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const response = await fetch(`${getApiBase()}/api/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lifeTags: profile?.lifeTags || [],
          interests: profile?.interests || [],
          offset: nextOffset,
          sortBy, // pass current filter so server uses correct batch size + ordering
        }),
      });
      let data;
      try {
        const text = await response.text();
        data = JSON.parse(text);
      } catch {
        console.error('loadMore: response was not valid JSON');
        throw new Error('Server temporarily unavailable');
      }
      if (!response.ok) {
        console.error('loadMore API error:', data.error || response.status);
        throw new Error(data.error || `Feed API returned ${response.status}`);
      }
      // Capture scroll RIGHT before React batches the new items into the DOM
      scrollAnchorY.current = window.scrollY;
      // Append raw — filteredItems handles global sort so ordering is always correct
      setFeedItems(prev => [...prev, ...(data.items || [])]);
      setHasMore(data.hasMore || false);
      setNextOffset(data.nextOffset || 0);
    } catch (err) {
      console.warn('Failed to load more:', err.message);
    } finally {
      setIsLoadingMore(false);
      isLoadingMoreRef.current = false;
    }
  }, [hasMore, nextOffset, profile?.lifeTags, profile?.interests, sortBy]);

  // Immediately after new items paint, restore scroll so viewport doesn't shift
  useLayoutEffect(() => {
    if (scrollAnchorY.current !== null) {
      window.scrollTo({ top: scrollAnchorY.current, behavior: 'instant' });
      scrollAnchorY.current = null;
    }
    // Fires for both federal and state feed appends
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedItems.length, stateFeedItems.length]);

  // Load more state bills — declared BEFORE IntersectionObserver to avoid TDZ
  const loadMoreState = useCallback(async () => {
    if (isLoadingMoreStateRef.current || !stateHasMore) return;
    if (!profile?.location?.zipCode) return;
    isLoadingMoreStateRef.current = true;
    setIsLoadingMoreState(true);
    try {
      const response = await fetch(`${getApiBase()}/api/state-feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipCode: profile.location.zipCode, page: stateNextPage, perPage: 15 }),
      });
      const data = await response.json();
      if (!response.ok) return;
      scrollAnchorY.current = window.scrollY;
      // Append raw — filteredItems handles global sort so ordering is always correct
      setStateFeedItems(prev => [...prev, ...(data.items || [])]);
      setStateHasMore(data.hasMore || false);
      setStateNextPage(p => p + 1);
    } catch (err) {
      console.warn('Failed to load more state bills:', err);
    } finally {
      setIsLoadingMoreState(false);
      isLoadingMoreStateRef.current = false;
    }
  }, [stateHasMore, stateNextPage, profile?.location?.zipCode]);

  // IntersectionObserver: auto-load when sentinel enters viewport (tab-aware)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (activeTab === 'State & Local') {
          if (stateHasMore && !isLoadingMoreStateRef.current) loadMoreState();
        } else {
          if (hasMore && !isLoadingMoreRef.current) loadMore();
        }
      },
      { rootMargin: '0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, stateHasMore, loadMoreState, activeTab]);


  // Layer 2: Fast re-personalize tag impacts when profile tags change
  useEffect(() => {
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      return; // Skip first render — base feed already handles initial tags
    }
    if (feedItems.length === 0) return;

    async function rePersonalize() {
      setIsPersonalizing(true);
      try {
        const response = await fetch(`${getApiBase()}/api/personalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bills: feedItems,
            lifeTags: profile?.lifeTags || []
          }),
        });
        const data = await response.json();
        if (!response.ok) return;

        const impacts = data.impacts || {};
        setFeedItems(prev => prev.map(item => ({
          ...item,
          tagImpacts: impacts[item.id] || item.tagImpacts || {}
        })));
      } catch (err) {
        console.warn("Personalization update failed:", err);
      } finally {
        setIsPersonalizing(false);
      }
    }
    rePersonalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.lifeTags]);

  // Fetch state bills on mount (alongside federal bills) when zip code is available
  useEffect(() => {
    if (hasLoadedState.current) return;
    if (!profile?.location?.zipCode) return;

    async function fetchStateFeed() {
      setIsLoadingState(true);
      try {
        const response = await fetch(`${getApiBase()}/api/state-feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zipCode: profile.location.zipCode, page: 1, perPage: 15 }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch state feed');
        // Pre-sort at load time so re-renders never reposition items above the viewport
        const sorted = (data.items || []).sort((a, b) =>
          (stateImpactOrder[a.impactLevel] ?? 3) - (stateImpactOrder[b.impactLevel] ?? 3)
        );
        setStateFeedItems(sorted);
        setStateHasMore(data.hasMore || false);
        setStateNextPage(2);
        setStateInfo({ state: data.state, stateName: data.stateName });
        hasLoadedState.current = true;
      } catch (err) {
        console.warn('State feed error:', err);
      } finally {
        setIsLoadingState(false);
      }
    }
    fetchStateFeed();
  }, [profile?.location?.zipCode]);

  // (loadMoreState moved above IntersectionObserver — see above)

  const impactOrder = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
  // Separate const so it can be referenced inside fetchStateFeed useEffect
  const stateImpactOrder = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };

  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  const canSeeState = isPro || isNative;

  const filteredItems = (() => {
    let items;
    if (activeTab === 'Federal') {
      items = feedItems.filter(item => item.level === 'Federal');
    } else if (activeTab === 'State & Local') {
      items = [...stateFeedItems];
    } else {
      // "All Updates" — only include state bills if Pro or native
      items = canSeeState
        ? [...feedItems, ...stateFeedItems]
        : [...feedItems];
    }
    // Always sort the full combined list so new batches land in the correct position
    if (sortBy === 'recent') {
      return items.sort((a, b) => new Date(b.latestActionDate || b.updateDate || b.date || 0) - new Date(a.latestActionDate || a.updateDate || a.date || 0));
    }
    // High Impact filter: globally sort entire list — prevents new-batch High Impact
    // items from appearing below Moderate/Low items from earlier batches
    return items.sort((a, b) => (impactOrder[a.impactLevel] ?? 3) - (impactOrder[b.impactLevel] ?? 3));
  })();

  return (
    <AppShell>
      {/* Hero greeting */}
      <section className={styles.heroSection}>
        <h2 className={styles.greeting}>
          Good evening, <span className={styles.greetingAccent}>welcome to Civisly</span>
        </h2>
        <p className={styles.subtitle}>
          Here&apos;s what&apos;s happening in government that affects you today.
        </p>
        <div className={styles.dateChip}>
          <CalendarIcon />
          {today}
        </div>
      </section>

      {/* Recent Activity (Dynamic Feed) */}
      <section>
        <header className={styles.sectionHeader}>
          <div>
            <h3 className={styles.sectionTitle}>Your Personalized Feed</h3>
            {isPersonalizing && (
              <p style={{ fontSize: '0.8rem', color: 'var(--cl-primary-500)', marginTop: '4px', fontWeight: 500 }}>
                ✨ Updating personalization...
              </p>
            )}
          </div>

          <div className={styles.feedControls}>
            <div className={styles.feedTabs}>
              <button
                className={`${styles.tabBtn} ${activeTab === 'All' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('All')}
              >
                All Updates
              </button>
              <button
                className={`${styles.tabBtn} ${activeTab === 'Federal' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('Federal')}
              >
                Federal
              </button>
              <button
                className={`${styles.tabBtn} ${activeTab === 'State & Local' ? styles.tabActive : ''}`}
                onClick={() => {
                  const native = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
                  if (!native && !isPro) { setShowUpgradeModal(true); return; }
                  setActiveTab('State & Local');
                }}
              >
                State &amp; Local {!isPro && !(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) && <span style={{ fontSize: '0.7rem', marginLeft: '4px' }}>🔒</span>}
              </button>
            </div>

            <div className={styles.sortControl}>
              <span className={styles.sortLabel}>Sort:</span>
              <button
                className={`${styles.sortBtn} ${sortBy === 'impact' ? styles.sortBtnActive : ''}`}
                onClick={() => setSortBy('impact')}
                title="Sort by impact level"
              >
                ⚡ High Impact
              </button>
              <button
                className={`${styles.sortBtn} ${sortBy === 'recent' ? styles.sortBtnActive : ''}`}
                onClick={() => setSortBy('recent')}
                title="Sort by most recent"
              >
                🕐 Most Recent
              </button>
            </div>
          </div>
        </header>

        {/* Pro upsell banner — show on 'All Updates' for non-Pro web users */}
        {activeTab === 'All' && !canSeeState && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)',
            border: '1px solid #c7d2fe',
            borderRadius: '12px',
            marginBottom: '16px',
            fontSize: '0.88rem',
            color: '#4338ca',
            lineHeight: 1.45,
          }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🏛️</span>
            <span>
              Showing <strong>federal bills only</strong>.
              <button
                onClick={() => setShowUpgradeModal(true)}
                style={{
                  background: 'none', border: 'none', color: '#4f46e5',
                  fontWeight: 700, cursor: 'pointer', textDecoration: 'underline',
                  fontSize: 'inherit', padding: '0 0 0 4px',
                }}
              >
                Upgrade to Pro
              </button> to unlock State & Local legislation.
            </span>
          </div>
        )}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#666' }}>
            <div style={{
              display: 'inline-block', width: '40px', height: '40px',
              border: '4px solid #f3f3f3', borderTop: '4px solid var(--cl-primary-500)',
              borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '16px'
            }}></div>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <p>Fetching the latest legislation from Congress and generating AI summaries...</p>
            <p style={{ fontSize: '0.85em', color: '#999', marginTop: '8px' }}>This takes a few seconds.</p>
          </div>
        ) : (activeTab === 'State & Local' && isLoadingState) ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#666' }}>
            <div style={{
              display: 'inline-block', width: '40px', height: '40px',
              border: '4px solid #f3f3f3', borderTop: '4px solid #8b5cf6',
              borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '16px'
            }}></div>
            <p>Fetching state legislation{stateInfo ? ` from ${stateInfo.stateName}` : ''}...</p>
            <p style={{ fontSize: '0.85em', color: '#999', marginTop: '8px' }}>Powered by OpenStates</p>
          </div>
        ) : error ? (
          <div style={{ padding: '24px', background: '#fee2e2', color: '#b91c1c', borderRadius: '8px', border: '1px solid #f87171' }}>
            <strong>Error loading feed:</strong> {error}
          </div>
        ) : filteredItems.length > 0 ? (
          <div className={styles.feedList}>
            {(user ? filteredItems : filteredItems.slice(0, 10)).map(item => (
              <FeedCard key={item.id} item={item} profile={profile} />
            ))}

            {/* Paywall — show after 10 cards for logged-out users */}
            {!user && filteredItems.length > 0 && (
              <div style={{
                position: 'relative',
                marginTop: '8px',
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: '0 4px 24px rgba(99,102,241,0.10)',
              }}>
                {/* Blurred ghost card */}
                <div style={{
                  filter: 'blur(5px)',
                  opacity: 0.45,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  padding: '24px',
                  background: '#fff',
                  borderRadius: '16px',
                  border: '1px solid #e5e7eb',
                }}>
                  <div style={{ height: '12px', background: '#e5e7eb', borderRadius: '8px', width: '60%', marginBottom: '12px' }} />
                  <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '8px', width: '85%', marginBottom: '8px' }} />
                  <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '8px', width: '70%', marginBottom: '8px' }} />
                  <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '8px', width: '50%' }} />
                </div>

                {/* CTA overlay */}
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(to bottom, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.97) 40%)',
                  padding: '32px 24px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>🔒</div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1e1b4b', marginBottom: '6px' }}>You&apos;ve reached the preview limit</div>
                  <div style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: '20px', maxWidth: '300px' }}>
                    Sign up for free to unlock unlimited legislation updates, personalized alerts, and your civic dashboard.
                  </div>
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('civiclens:openAuth'))}
                    style={{
                      padding: '11px 28px', borderRadius: '12px',
                      background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                      color: '#fff', fontWeight: 700, fontSize: '0.9rem',
                      border: 'none', cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
                      transition: 'all 0.2s',
                    }}
                  >
                    Sign Up Free →
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#666' }}>
            <p>No civic updates found for this filter.</p>
            {activeTab === 'State & Local' && !profile?.location?.zipCode && (
              <p style={{ fontSize: '0.85em', color: '#999', marginTop: '8px' }}>Add your zip code in Settings to see state legislation.</p>
            )}
          </div>
        )}

        {/* Infinite scroll sentinel — visible for both federal and state tabs */}
        {user && (hasMore || stateHasMore) && <div ref={sentinelRef} style={{ height: '1px' }} />}

        {user && (isLoadingMore || isLoadingMoreState) && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#555' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'var(--cl-primary-500)',
                animation: 'bounce 1.4s ease-in-out infinite both',
                animationDelay: '0s'
              }}></div>
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'var(--cl-primary-500)',
                animation: 'bounce 1.4s ease-in-out infinite both',
                animationDelay: '0.2s'
              }}></div>
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'var(--cl-primary-500)',
                animation: 'bounce 1.4s ease-in-out infinite both',
                animationDelay: '0.4s'
              }}></div>
            </div>
            <style>{`
              @keyframes bounce {
                0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
                40% { transform: scale(1); opacity: 1; }
              }
            `}</style>
            <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>Loading more legislation...</p>
          </div>
        )}
      </section>

      {/* CTA Banner (Hidden if profile exists) */}
      {!profile.hasCompletedOnboarding && (
        <div className={styles.ctaBanner}>
          <div className={styles.ctaContent}>
            <div className={styles.ctaTitle}>Set up your profile to get personalized updates</div>
            <div className={styles.ctaText}>
              Tell us where you live and what matters to you. We&apos;ll filter the noise and show only what&apos;s relevant.
            </div>
          </div>
          <button className={styles.ctaButton} onClick={() => alert('Please use the sidebar to open the profile setup.')}>Get Started</button>
        </div>
      )}
      {showUpgradeModal && !(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) && <UpgradeModal onClose={() => setShowUpgradeModal(false)} />}
    </AppShell>
  );
}
