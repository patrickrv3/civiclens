'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './AIAssistant.module.css';
import { useProfile } from '../context/ProfileContext';

const SendIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
);

const SparkleIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);

const SUGGESTED_QUESTIONS = [
    "What major bills are being debated in Congress right now?",
    "How does the federal budget affect everyday citizens?",
    "Explain how a bill becomes a law in simple terms",
    "What are my rights as a renter in the US?",
    "How do tax changes affect small business owners?",
    "What is the filibuster and how does it work?",
];

// Simple markdown-like rendering for AI responses
function renderAIText(text) {
    // Split into paragraphs
    const paragraphs = text.split('\n\n');
    return paragraphs.map((para, i) => {
        // Handle bullet points
        if (para.includes('\n- ') || para.startsWith('- ')) {
            const lines = para.split('\n');
            const items = [];
            let intro = null;
            lines.forEach((line, j) => {
                if (line.startsWith('- ')) {
                    items.push(<li key={j} dangerouslySetInnerHTML={{ __html: boldify(line.slice(2)) }} />);
                } else if (line.trim()) {
                    intro = <p key={'intro-' + j} dangerouslySetInnerHTML={{ __html: boldify(line) }} />;
                }
            });
            return (
                <div key={i}>
                    {intro}
                    <ul>{items}</ul>
                </div>
            );
        }
        // Regular paragraph — handle **bold**
        return <p key={i} dangerouslySetInnerHTML={{ __html: boldify(para.replace(/\n/g, '<br/>')) }} />;
    });
}

function boldify(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

export default function AIAssistant({ initialQuestion, onQuestionConsumed }) {
    const { profile } = useProfile();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const hasHandledInitialRef = useRef(false);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Handle initial question from "Ask AI" button on feed cards
    useEffect(() => {
        if (initialQuestion && !hasHandledInitialRef.current) {
            hasHandledInitialRef.current = true;
            sendMessage(initialQuestion);
            if (onQuestionConsumed) onQuestionConsumed();
        }
    }, [initialQuestion]);

    async function sendMessage(text) {
        const userMessage = text || input.trim();
        if (!userMessage || isStreaming) return;

        setInput('');
        const newMessages = [...messages, { role: 'user', content: userMessage }];
        setMessages(newMessages);
        setIsStreaming(true);

        // Add a placeholder for the AI response
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: newMessages,
                    profile: {
                        zipCode: profile?.zipCode,
                        lifeTags: profile?.lifeTags,
                        interests: profile?.interests,
                    }
                }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to get response');
            }

            // Read the SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') break;
                        try {
                            const parsed = JSON.parse(data);
                            accumulatedContent += parsed.content;
                            // Update the last message (AI placeholder) with accumulated content
                            setMessages(prev => {
                                const updated = [...prev];
                                updated[updated.length - 1] = {
                                    role: 'assistant',
                                    content: accumulatedContent
                                };
                                return updated;
                            });
                        } catch {
                            // Skip malformed JSON chunks
                        }
                    }
                }
            }
        } catch (err) {
            setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    role: 'assistant',
                    content: `Sorry, I encountered an error: ${err.message}. Please try again.`
                };
                return updated;
            });
        } finally {
            setIsStreaming(false);
            inputRef.current?.focus();
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    const isEmpty = messages.length === 0;

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h2 className={styles.title}>AI Research Assistant</h2>
                <p className={styles.subtitle}>
                    Ask me anything about laws, bills, policies, or how government affects you.
                </p>
            </div>

            {/* Messages */}
            <div className={styles.messages}>
                {isEmpty ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>
                            <SparkleIcon />
                        </div>
                        <h3 className={styles.emptyTitle}>What would you like to know?</h3>
                        <p className={styles.emptyText}>
                            I can explain any law, bill, or policy in plain English — personalized to your situation.
                            Try one of the suggestions below or ask your own question.
                        </p>
                        <div className={styles.suggestions}>
                            {SUGGESTED_QUESTIONS.map((q, i) => (
                                <button
                                    key={i}
                                    className={styles.suggestionChip}
                                    onClick={() => sendMessage(q)}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {messages.map((msg, i) => (
                            <div key={i} className={`${styles.message} ${msg.role === 'user' ? styles.messageUser : ''}`}>
                                <div className={`${styles.avatar} ${msg.role === 'user' ? styles.avatarUser : styles.avatarAI}`}>
                                    {msg.role === 'user' ? 'You' : 'AI'}
                                </div>
                                <div className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAI}`}>
                                    {msg.role === 'assistant' ? (
                                        msg.content ? (
                                            renderAIText(msg.content)
                                        ) : (
                                            <div className={styles.typing}>
                                                <div className={styles.typingDot}></div>
                                                <div className={styles.typingDot}></div>
                                                <div className={styles.typingDot}></div>
                                            </div>
                                        )
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>

            {/* Input bar */}
            <div className={styles.inputBar}>
                <div className={styles.inputWrapper}>
                    <input
                        ref={inputRef}
                        type="text"
                        className={styles.input}
                        placeholder="Ask about any law, bill, or policy..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isStreaming}
                    />
                    <button
                        className={styles.sendBtn}
                        onClick={() => sendMessage()}
                        disabled={!input.trim() || isStreaming}
                    >
                        <SendIcon />
                    </button>
                </div>
                <p className={styles.inputHint}>
                    Civisly AI is nonpartisan and may occasionally make mistakes. Verify important information.
                </p>
            </div>
        </div>
    );
}
