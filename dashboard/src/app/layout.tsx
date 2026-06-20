import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import AuthProvider from '@/components/AuthProvider'

export const metadata: Metadata = {
  title: 'Modo AI Gateway',
  description: 'The fastest open-source AI gateway',
  icons: { icon: '/logo.svg', shortcut: '/logo.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-font-size="md" suppressHydrationWarning>
      <body className="min-h-screen overflow-x-hidden">
        <ThemeProvider>
          <div className="bg-orb top-[-10%] left-[10%]"
            style={{ width: '700px', height: '700px', background: 'radial-gradient(circle, var(--bg-orb-1) 0%, transparent 65%)' }} />
          <div className="bg-orb bottom-[-5%] right-[5%]"
            style={{ width: '600px', height: '600px', background: 'radial-gradient(circle, var(--bg-orb-2) 0%, transparent 65%)' }} />
          <div className="bg-orb top-[40%] right-[30%]"
            style={{ width: '500px', height: '500px', background: 'radial-gradient(circle, var(--bg-orb-3) 0%, transparent 65%)' }} />
          <div className="fixed inset-0 bg-grid pointer-events-none z-0" />
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
