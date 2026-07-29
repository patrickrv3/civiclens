'use client';

import { useEffect, useState } from 'react';

export default function NotificationToast({ notification, onDismiss, onTap }) {
    const [isVisible, setIsVisible] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);

    useEffect(() => {
        if (!notification) return;

        // Slide in
        requestAnimationFrame(() => setIsVisible(true));

        // Auto-dismiss after 5 seconds
        const timer = setTimeout(() => dismiss(), 5000);
        return () => clearTimeout(timer);
    }, [notification]);

    function dismiss() {
        setIsLeaving(true);
        setTimeout(() => {
            setIsVisible(false);
            setIsLeaving(false);
            onDismiss?.();
        }, 300);
    }

    function handleTap() {
        dismiss();
        onTap?.(notification);
    }

    if (!notification) return null;

    return (
        <div
            onClick={handleTap}
            style={{
                position: 'fixed',
                top: isVisible && !isLeaving ? 'env(safe-area-inset-top, 12px)' : '-100px',
                left: '12px',
                right: '12px',
                zIndex: 99999,
                background: 'rgba(30, 32, 40, 0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRadius: '14px',
                padding: '14px 16px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2)',
                cursor: 'pointer',
                transition: 'top 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
            }}
        >
            {/* App icon */}
            <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '16px',
                fontWeight: '700',
                color: 'white',
            }}>
                C
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: 'rgba(255, 255, 255, 0.95)',
                    lineHeight: '1.3',
                    marginBottom: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {notification.title || 'Civisly'}
                </div>
                <div style={{
                    fontSize: '13px',
                    fontWeight: '400',
                    color: 'rgba(255, 255, 255, 0.7)',
                    lineHeight: '1.35',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                }}>
                    {notification.body || ''}
                </div>
            </div>

            {/* Time indicator */}
            <div style={{
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.4)',
                flexShrink: 0,
                marginTop: '1px',
            }}>
                now
            </div>
        </div>
    );
}
