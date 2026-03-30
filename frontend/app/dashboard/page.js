'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredAuth, clearAuth, apiFetch } from '../../lib/api'
import CallsTab from '../../components/CallsTab'
import BookingsTab from '../../components/BookingsTab'
import AnalyticsTab from '../../components/AnalyticsTab'
import DashboardNav from '../../components/DashboardNav'

export default function DashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('calls')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function checkAuth() {
      const { accessToken, expiresAt } = getStoredAuth()
      if (!accessToken || (expiresAt && expiresAt < Date.now() / 1000)) {
        router.replace('/')
        return
      }

      try {
        const res = await apiFetch('/admin/business/profile')
        if (res.ok) {
          const profile = await res.json()
          if (!profile.services) {
            router.replace('/onboarding')
            return
          }
        }
      } catch {
        // Network error — let them through
      }

      setReady(true)
    }
    checkAuth()
  }, [router])

  function handleTabChange(tab) {
    if (tab === 'settings') {
      router.push('/dashboard/settings')
    } else {
      setActiveTab(tab)
    }
  }

  function handleSignOut() {
    clearAuth()
    router.replace('/')
  }

  if (!ready) return null

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-gray-950 sticky top-0 z-10 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="font-bold text-base tracking-tight">Tradie Bot</span>
        </div>
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">
        {activeTab === 'calls'     && <CallsTab />}
        {activeTab === 'bookings'  && <BookingsTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </main>

      <DashboardNav activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  )
}
