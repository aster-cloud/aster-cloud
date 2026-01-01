// Root layout - not used for localized pages
// All pages are served through [locale]/layout.tsx
// This file exists only to satisfy Next.js requirements

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
