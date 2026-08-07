import './globals.css';
import { AuthProvider } from './context/AuthContext';
import { ProfileProvider } from './context/ProfileContext';
import { WatchedBillsProvider } from './context/WatchedBillsContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { CourtRulingsProvider } from './context/CourtRulingsContext';
import { PushNotificationProvider } from './context/PushNotificationContext';
import SplashHider from './components/SplashHider';

export const metadata = {
  title: 'Civisly — Your Personal Civic Assistant',
  description: 'AI-powered civic assistant that helps you understand how government actions affect your life. Personalized, plain-English, action-oriented.',
  keywords: ['civic', 'government', 'bills', 'laws', 'representatives', 'AI', 'civic tech'],
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SplashHider />
          <PushNotificationProvider>
            <ProfileProvider>
              <SubscriptionProvider>
                <WatchedBillsProvider>
                  <CourtRulingsProvider>
                  {children}
                  </CourtRulingsProvider>
                </WatchedBillsProvider>
              </SubscriptionProvider>
            </ProfileProvider>
          </PushNotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}


