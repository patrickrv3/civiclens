import './globals.css';
import { ProfileProvider } from './context/ProfileContext';

export const metadata = {
  title: 'CivicLens — Your Personal Civic Assistant',
  description: 'AI-powered civic assistant that helps you understand how government actions affect your life. Personalized, plain-English, action-oriented.',
  keywords: ['civic', 'government', 'bills', 'laws', 'representatives', 'AI', 'civic tech'],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ProfileProvider>
          {children}
        </ProfileProvider>
      </body>
    </html>
  );
}
