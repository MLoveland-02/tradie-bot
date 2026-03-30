'use client'

import { useState, useEffect } from 'react'
import { apiFetch, getStoredAuth } from '../lib/api'

const STATS = [
  {
    key: 'conversations',
    label: 'Conversations',
    format: (v) => v,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z" />
      </svg>
    ),
    accent: 'text-blue-400 bg-blue-500/10',
  },
  {
    key: 'bookings',
    label: 'Bookings',
    format: (v) => v,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    accent: 'text-green-400 bg-green-500/10',
  },
  {
    key: 'missed_calls',
    label: 'Missed Calls',
    format: (v) => v,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
    accent: 'text-orange-400 bg-orange-500/10',
  },
  {
    key: 'urgent_leads',
    label: 'Urgent Leads',
    format: (v) => v,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
    accent: 'text-red-400 bg-red-500/10',
  },
  {
    key: 'high_value_leads',
    label: 'High Value',
    format: (v) => v,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ),
    accent: 'text-yellow-400 bg-yellow-500/10',
  },
  {
    key: 'estimated_revenue',
    label: 'Est. Revenue',
    format: (v) =>
      new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v),
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    accent: 'text-emerald-400 bg-emerald-500/10',
    wide: true,
  },
]

export default function AnalyticsTab() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { businessId } = getStoredAuth()
      try {
        const res = await apiFetch(`/admin/stats/${businessId}`)
        if (!res.ok) throw new Error('Failed to load')
        setStats(await res.json())
      } catch {
        setError('Could not load stats')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorMessage message={error} />
  if (!stats)  return null

  return (
    <div className="px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        {STATS.map(({ key, label, format, icon, accent, wide }) => (
          <div
            key={key}
            className={`bg-gray-900 rounded-xl p-4 ${wide ? 'col-span-2' : ''}`}
          >
            <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${accent} mb-3`}>
              {icon}
            </div>
            <p className="text-2xl font-bold tracking-tight">{format(stats[key] ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center items-center py-20">
      <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-orange-500 animate-spin" />
    </div>
  )
}

function ErrorMessage({ message }) {
  return (
    <div className="mx-4 mt-8 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm text-center">
      {message}
    </div>
  )
}
