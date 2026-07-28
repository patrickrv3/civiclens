'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [stateError, setStateError] = useState(null);
  const [stateRetryCount, setStateRetryCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [stateHasMore, setStateHasMore] = useState(false);
  const [stateNextPage, setStateNextPage] = useState(2);
  const [stateInfo, setStateInfo] = useState(null);

  const hasLoadedState = useRef(false);
  const sentinelRef = useRef(null);
  const isLoadingMoreRef = useRef(false);
  const isLoadingMoreStateRef = useRef(false);
  const [showFeedInfo, setShowFeedInfo] = useState(false);

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

        // Fetch bills and executive orders in parallel — EO is non-blocking
        // If EO takes > 5s, show federal bills immediately and merge EOs when ready
        const base = getApiBase();
        const feedPromise = fetch(`${base}/api/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const eoPromise = fetch(`${base}/api/executive-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => null);

        // Wait for federal feed — this is required
        const feedRes = await feedPromise;

        // Race EO against a 5-second timeout — don't block the page
        const eoRes = await Promise.race([
          eoPromise,
          new Promise(resolve => setTimeout(() => resolve(null), 5000)),
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
        // Merge and sort based on the active sort mode
        const allFederal = [...(feedData.items || []), ...eoItems].sort(
          sortBy === 'recent'
            ? (a, b) => new Date(b.latestActionDate || b.updateDate || b.date || 0) - new Date(a.latestActionDate || a.updateDate || a.date || 0)
            : (a, b) => (impactOrd[a.impactLevel] ?? 3) - (impactOrd[b.impactLevel] ?? 3)
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

  // Re-sort items when user toggles sort mode
  useEffect(() => {
    const impactOrd = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
    const sorter = sortBy === 'recent'
      ? (a, b) => new Date(b.latestActionDate || b.updateDate || b.date || 0) - new Date(a.latestActionDate || a.updateDate || a.date || 0)
      : (a, b) => (impactOrd[a.impactLevel] ?? 3) - (impactOrd[b.impactLevel] ?? 3);
    if (feedItems.length > 0) {
      setFeedItems(prev => [...prev].sort(sorter));
    }
    if (stateFeedItems.length > 0) {
      setStateFeedItems(prev => [...prev].sort(sorter));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

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
      // Append new items at the END — do NOT re-sort here.
      // The filteredItems block handles display sorting, but only rearranges
      // within the initial batch. New items are appended in server order.
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
      let data;
      try {
        const text = await response.text();
        data = JSON.parse(text);
      } catch {
        console.error('loadMoreState: response was not valid JSON');
        return;
      }
      if (!response.ok) return;
      // Append new items at end — scroll position preserved naturally
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


  // Layer 2: Personalize tag impacts — runs on initial load AND when lifeTags change
  // Only triggers when user has lifeTags AND wants personalization.
  // The personalize API caches by lifeTag hash, so shared tag combos = no AI cost.
  useEffect(() => {
    if (feedItems.length === 0) return;
    if (!profile?.wantsPersonalizedImpact) return;
    if (!profile?.lifeTags || profile.lifeTags.length === 0) return;

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
  }, [profile?.lifeTags, profile?.wantsPersonalizedImpact, feedItems.length]);

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
        setStateError(err.message || 'Failed to load state legislation');
      } finally {
        setIsLoadingState(false);
      }
    }
    fetchStateFeed();
  }, [profile?.location?.zipCode, stateRetryCount]);

  // (loadMoreState moved above IntersectionObserver — see above)

  const impactOrder = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
  // Separate const so it can be referenced inside fetchStateFeed useEffect
  const stateImpactOrder = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };

  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  const canSeeState = isPro || isNative;

  const filteredItems = (() => {
    const impactOrd = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
    const sorter = sortBy === 'recent'
      ? (a, b) => new Date(b.latestActionDate || b.updateDate || b.date || 0) - new Date(a.latestActionDate || a.updateDate || a.date || 0)
      : (a, b) => (impactOrd[a.impactLevel] ?? 3) - (impactOrd[b.impactLevel] ?? 3);

    if (activeTab === 'Federal') {
      return feedItems.filter(item => item.level === 'Federal');
    } else if (activeTab === 'State & Local') {
      return [...stateFeedItems];
    } else {
      // "All Updates" — merge federal + state, then sort together
      const merged = canSeeState
        ? [...feedItems, ...stateFeedItems]
        : [...feedItems];
      return merged.sort(sorter);
    }
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
              <button
                onClick={() => setShowFeedInfo(prev => !prev)}
                title="About this feed"
                style={{
                  background: 'none', border: '1px solid var(--cl-border, #333)',
                  borderRadius: '50%', width: '26px', height: '26px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--cl-text-secondary, #999)',
                  fontSize: '0.75rem', fontWeight: 600, fontStyle: 'italic',
                  flexShrink: 0, marginLeft: '4px',
                }}
              >
                i
              </button>
            </div>

            {showFeedInfo && (
              <div
                onClick={() => setShowFeedInfo(false)}
                style={{
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                  zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '24px',
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'var(--cl-card-bg, #1a1a2e)', border: '1px solid var(--cl-border, #333)',
                    borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '380px',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                    fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--cl-text-primary, #e0e0e0)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <strong style={{ fontSize: '1rem' }}>ℹ️ About this feed</strong>
                    <button onClick={() => setShowFeedInfo(false)} style={{ background: 'none', border: 'none', color: 'var(--cl-text-secondary, #999)', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px' }}>✕</button>
                  </div>
                  {(activeTab === 'Federal' || activeTab === 'All') && (
                    <p style={{ margin: '0 0 12px 0' }}>
                      <strong>Federal:</strong> We show bills that have progressed beyond initial introduction — meaning they&apos;ve been voted on, reported out of committee, or have advanced through at least one chamber. Bills that were only introduced and referred are filtered out.
                    </p>
                  )}
                  {(activeTab === 'State & Local' || activeTab === 'All') && (
                    <p style={{ margin: '0 0 12px 0' }}>
                      <strong>State &amp; Local:</strong> We show the most recently updated legislation in your state. This includes bills at all stages — from newly introduced to signed into law — sorted by latest activity.
                    </p>
                  )}
                  <p style={{ margin: 0, color: 'var(--cl-text-secondary, #888)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                    All summaries are generated by AI and may not capture every detail. Tap any bill to view the full text.
                  </p>
                </div>
              </div>
            )}
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
            {/* Legislature recess indicator for State & Local tab */}
            {activeTab === 'State & Local' && stateFeedItems.length > 0 && (() => {
              const newestDate = stateFeedItems.reduce((latest, item) => {
                const d = new Date(item.latestActionDate || item.date || 0);
                return d > latest ? d : latest;
              }, new Date(0));
              const daysSince = Math.floor((Date.now() - newestDate.getTime()) / (1000 * 60 * 60 * 24));
              if (daysSince > 14) {
                const formattedDate = newestDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '12px 16px', marginBottom: '12px',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.06))',
                    border: '1px solid rgba(139,92,246,0.2)',
                    borderRadius: '12px', fontSize: '0.85rem', color: 'var(--cl-text-secondary, #666)',
                  }}>
                    <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>🏛️</span>
                    <div>
                      <strong style={{ color: 'var(--cl-text-primary, #333)' }}>Legislature in recess</strong>
                      <span style={{ marginLeft: '4px' }}>
                        — Last legislative activity was {formattedDate}. Bills below reflect the most recent session activity.
                      </span>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
            {filteredItems.map(item => (
              <FeedCard key={item.id} item={item} profile={profile} />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#666' }}>
            {activeTab === 'State & Local' && stateError ? (
              <>
                <p style={{ color: '#ef4444' }}>Failed to load state legislation.</p>
                <p style={{ fontSize: '0.85em', color: '#999', marginTop: '8px' }}>{stateError}</p>
                <button onClick={() => { setStateError(null); hasLoadedState.current = false; setStateRetryCount(c => c + 1); }} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: '8px', background: 'var(--cl-primary-500)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>Retry</button>
              </>
            ) : (
              <>
                <p>No civic updates found for this filter.</p>
                {activeTab === 'State & Local' && !profile?.location?.zipCode && (
                  <p style={{ fontSize: '0.85em', color: '#999', marginTop: '8px' }}>Add your zip code in Settings to see state legislation.</p>
                )}
              </>
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
