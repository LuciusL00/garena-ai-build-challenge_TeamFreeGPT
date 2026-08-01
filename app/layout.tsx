import type { ReactNode } from 'react';

export const metadata = {
  title: 'Swarmfall // Adaptive Input Demo',
  description: 'A playable Swarmfall extraction and defense demo.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
