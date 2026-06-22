import styles from './support.module.css';

export const metadata = {
  title: 'Support — Civisly',
  description: 'Get help with Civisly, your personal civic assistant.',
};

export default function Support() {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Support</h1>
        <p className={styles.subtitle}>We&apos;re here to help. Find answers below or reach out to us directly.</p>

        <section className={styles.section}>
          <h2>Contact Us</h2>
          <div className={styles.contactCard}>
            <div className={styles.contactItem}>
              <div className={styles.contactIcon}>📧</div>
              <div>
                <div className={styles.contactLabel}>Email Support</div>
                <a href="mailto:support@civisly.com" className={styles.contactLink}>support@civisly.com</a>
                <p className={styles.contactNote}>We typically respond within 24 hours.</p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Frequently Asked Questions</h2>

          <div className={styles.faqList}>
            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>What is Civisly?</summary>
              <p className={styles.faqAnswer}>
                Civisly is an AI-powered civic assistant that helps you understand how government actions affect your life. We provide personalized, plain-English summaries of federal and state legislation, executive orders, and more — tailored to your location and interests.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>How do I create an account?</summary>
              <p className={styles.faqAnswer}>
                Tap the &quot;Sign In / Sign Up&quot; button at the bottom of the app. You can create an account using your email address and a password. On the web version, you can also sign up with Google.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>I signed up with Google on the website. How do I log in on the app?</summary>
              <p className={styles.faqAnswer}>
                If you created your account using Google Sign-In on civisly.com, you&apos;ll need to set a password to log in on the iOS app. On the Sign In screen, tap &quot;Forgot Password?&quot; and enter the email associated with your Google account. We&apos;ll send you a link to set a password, and then you can log in with your email and new password.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>How do I personalize my feed?</summary>
              <p className={styles.faqAnswer}>
                Go to Settings (in the sidebar menu) and set your zip code, life situation tags (like &quot;Homeowner&quot; or &quot;Student&quot;), and policy interests (like &quot;Healthcare&quot; or &quot;Education&quot;). Your feed will automatically update to show legislation that&apos;s most relevant to you.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>What does the AI Assistant do?</summary>
              <p className={styles.faqAnswer}>
                The AI Assistant lets you ask questions about any bill, law, or government action in plain English. You can ask things like &quot;How does this bill affect homeowners?&quot; or &quot;What does this executive order mean for small businesses?&quot; and get a clear, understandable answer.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>How do I watch a bill for updates?</summary>
              <p className={styles.faqAnswer}>
                On any bill card in your feed, tap the &quot;Watch&quot; button (bell icon). You&apos;ll receive notifications when the bill&apos;s status changes — like if it passes a vote, moves to committee, or gets signed into law.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>How do I reset my profile?</summary>
              <p className={styles.faqAnswer}>
                Go to Settings → scroll to the bottom → tap &quot;Reset All Preferences.&quot; This will clear your zip code, life tags, and interests so you can start fresh.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>How do I delete my account?</summary>
              <p className={styles.faqAnswer}>
                To delete your account and all associated data, please email us at <a href="mailto:support@civisly.com">support@civisly.com</a> with the subject &quot;Account Deletion Request.&quot; We will process your request within 30 days.
              </p>
            </details>

            <details className={styles.faq}>
              <summary className={styles.faqQuestion}>Is my data secure?</summary>
              <p className={styles.faqAnswer}>
                Yes. Your data is stored securely using Firebase (Google Cloud infrastructure) with encryption at rest and in transit. We never sell your personal information. For full details, see our <a href="/privacy">Privacy Policy</a>.
              </p>
            </details>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Report a Bug</h2>
          <p className={styles.text}>
            Found something that doesn&apos;t work as expected? We&apos;d love to hear about it so we can fix it. Please email us at <a href="mailto:support@civisly.com">support@civisly.com</a> with:
          </p>
          <ul className={styles.list}>
            <li>A description of the issue</li>
            <li>What you expected to happen</li>
            <li>Your device and app version</li>
            <li>Screenshots, if possible</li>
          </ul>
        </section>

        <div className={styles.backLink}>
          <a href="/">← Back to Civisly</a>
        </div>
      </div>
    </div>
  );
}
