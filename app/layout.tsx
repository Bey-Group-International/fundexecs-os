export const metadata = {
  title: 'FundExecs OS',
  description: 'AI-native private-market command center'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
