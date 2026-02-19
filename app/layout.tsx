import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Research Agent',
  description: 'Minimal search interface for research',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
