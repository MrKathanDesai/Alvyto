import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';

import { RoomProvider } from '@/contexts/RoomContext';

export const metadata: Metadata = {
  title: 'Exam Room EMR | Medical Consultation Recorder',
  description: 'A calm, predictable single-room workspace for doctors to record patient consultations, view live transcription, and review AI-generated visit summaries.',
  keywords: ['EMR', 'medical records', 'transcription', 'AI', 'healthcare', 'consultation'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AuthProvider>
          <RoomProvider>
            {children}
          </RoomProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
