'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const isLogin   = pathname === '/login' || pathname === '/login/'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('gw-dashboard-token')
    if (!token && !isLogin) {
      router.replace('/login')
    } else if (token && isLogin) {
      router.replace('/')
    } else {
      setReady(true)
    }
  }, [pathname, isLogin, router])

  if (!ready) return null

  if (isLogin) return <>{children}</>

  return (
    <>
      <Sidebar />
      <main className="relative z-10 ml-56 min-h-screen">
        <TopBar />
        <div className="px-8 pt-8 pb-8">{children}</div>
      </main>
    </>
  )
}
