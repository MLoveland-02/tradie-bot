'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredAuth, clearAuth, apiFetch } from '../../lib/api'
import CallsTab from '../../components/CallsTab'
import BookingsTab from '../../components/BookingsTab'
import AnalyticsTab from '../../components/AnalyticsTab'

const TABS = [
  {
    id: 'calls',
    label: 'Calls',
    icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5}
          d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
  {
    id: 'bookings',
    label: 'Bookings',
    icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 0 : 1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
]

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

      // Redirect to onboarding if the business profile is incomplete.
      // "Incomplete" = services is blank, meaning the owner never finished setup.
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
        // Network error — let them through to the dashboard rather than
        // bouncing them on every load
      }

      setReady(true)
    }
    checkAuth()
  }, [router])

  function handleSignOut() {
    clearAuth()
    router.replace('/')
  }

  if (!ready) return null

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      {/* Header */}
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

      {/* Tab content — scrollable, padded above the fixed nav */}
      <main className="flex-1 overflow-y-auto pb-24">
        {activeTab === 'calls'     && <CallsTab />}
        {activeTab === 'bookings'  && <BookingsTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gray-900 border-t border-gray-800 flex safe-bottom">
        {TABS.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                active ? 'text-orange-500' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.icon(active)}
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
