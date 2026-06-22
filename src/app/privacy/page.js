import styles from './privacy.module.css';

export const metadata = {
  title: 'Privacy Policy — Civisly',
  description: 'Privacy Policy for Civisly, your personal civic assistant.',
};

export default function PrivacyPolicy() {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: June 21, 2026</p>

        <section className={styles.section}>
          <h2>Introduction</h2>
          <p>
            Civisly (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website at civisly.com and our iOS mobile application (collectively, the &quot;Service&quot;).
          </p>
          <p>
            By using the Service, you agree to the collection and use of information in accordance with this policy.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Information We Collect</h2>

          <h3>Information You Provide</h3>
          <ul>
            <li><strong>Account Information:</strong> When you create an account, we collect your email address and a password (or authentication credentials if you sign in with Google).</li>
            <li><strong>Profile Information:</strong> You may voluntarily provide your zip code, life situation tags (e.g., &quot;Homeowner,&quot; &quot;Student&quot;), and policy interests (e.g., &quot;Healthcare,&quot; &quot;Education&quot;) to personalize your experience.</li>
            <li><strong>Bill Watching:</strong> When you choose to watch a bill for updates, we store that preference in your account.</li>
            <li><strong>AI Assistant Interactions:</strong> Questions you ask the AI assistant are sent to our AI provider to generate responses. We do not permanently store your conversation history.</li>
          </ul>

          <h3>Information Collected Automatically</h3>
          <ul>
            <li><strong>Device Information:</strong> We may collect information about your device type, operating system, and browser type.</li>
            <li><strong>Usage Data:</strong> We may collect information about how you interact with the Service, such as pages viewed and features used.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, maintain, and improve the Service</li>
            <li>Personalize your legislative feed based on your location, life situation, and interests</li>
            <li>Generate AI-powered summaries and personalized impact assessments</li>
            <li>Send you notifications about bills you are watching</li>
            <li>Process subscription payments</li>
            <li>Respond to your inquiries and provide customer support</li>
            <li>Protect against fraudulent or unauthorized activity</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Third-Party Services</h2>
          <p>We use the following third-party services to operate the Service:</p>
          <ul>
            <li><strong>Firebase (Google):</strong> Authentication and database storage. Subject to <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s Privacy Policy</a>.</li>
            <li><strong>OpenAI:</strong> AI-powered summaries and assistant features. Your questions are processed by OpenAI&apos;s API. Subject to <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer">OpenAI&apos;s Privacy Policy</a>.</li>
            <li><strong>Stripe:</strong> Payment processing for web subscriptions. Subject to <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe&apos;s Privacy Policy</a>.</li>
            <li><strong>Vercel:</strong> Web hosting. Subject to <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">Vercel&apos;s Privacy Policy</a>.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Data Storage and Security</h2>
          <p>
            Your data is stored securely using Firebase (Google Cloud infrastructure). We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.
          </p>
          <p>
            However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your information, we cannot guarantee its absolute security.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is active or as needed to provide you the Service. If you delete your account, we will delete your personal data within 30 days, except where we are required to retain it for legal or regulatory purposes.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Your Rights</h2>
          <p>Depending on your location, you may have the following rights:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
            <li><strong>Correction:</strong> Request correction of inaccurate personal data.</li>
            <li><strong>Deletion:</strong> Request deletion of your personal data.</li>
            <li><strong>Portability:</strong> Request a portable copy of your data.</li>
            <li><strong>Opt-out:</strong> You can reset your profile and preferences at any time through the Settings page.</li>
          </ul>
          <p>
            To exercise any of these rights, please contact us at the email address below.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Children&apos;s Privacy</h2>
          <p>
            The Service is not directed to individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete such information promptly.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date. Your continued use of the Service after any changes constitutes your acceptance of the updated policy.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or our data practices, please contact us at:
          </p>
          <p className={styles.contactEmail}>
            <a href="mailto:support@civisly.com">support@civisly.com</a>
          </p>
        </section>

        <div className={styles.backLink}>
          <a href="/">← Back to Civisly</a>
        </div>
      </div>
    </div>
  );
}
