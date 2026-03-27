import './globals.css';
import { AuthProvider } from './context/AuthContext';
import { ProfileProvider } from './context/ProfileContext';
import { WatchedBillsProvider } from './context/WatchedBillsContext';
import { SubscriptionProvider } from './context/SubscriptionContext';

export const metadata = {
  title: 'Civisly — Your Personal Civic Assistant',
  description: 'AI-powered civic assistant that helps you understand how government actions affect your life. Personalized, plain-English, action-oriented.',
  keywords: ['civic', 'government', 'bills', 'laws', 'representatives', 'AI', 'civic tech'],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ProfileProvider>
            <SubscriptionProvider>
              <WatchedBillsProvider>
                {children}
              </WatchedBillsProvider>
            </SubscriptionProvider>
          </ProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}


