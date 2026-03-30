'use client'

import { useState, useEffect } from 'react'
import { apiFetch, getStoredAuth } from '../lib/api'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const diffMin = Math.floor((Date.now() - d) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function BookingsTab() {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { businessId } = getStoredAuth()
      try {
        const res = await apiFetch(`/admin/conversations/${businessId}`)
        if (!res.ok) throw new Error('Failed to load')
        const all = await res.json()
        setBookings(all.filter((c) => c.status === 'booked'))
      } catch {
        setError('Could not load bookings')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorMessage message={error} />
  if (bookings.length === 0) return <EmptyState />

  return (
    <div className="space-y-3 px-4 py-4">
      {bookings.map((conv) => (
        <div key={conv.id} className="bg-gray-900 rounded-xl p-4 border-l-4 border-l-green-500">
          <div className="flex justify-between items-start gap-2">
            <div className="flex items-center gap-2">
              {/* green dot */}
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="font-semibold text-sm tracking-wide">{conv.customer_phone}</span>
            </div>
            <span className="text-xs text-gray-500 shrink-0">{formatTime(conv.last_message_at)}</span>
          </div>

          {conv.last_message_preview && (
            <p className="text-sm text-gray-400 mt-2 line-clamp-2 pl-4">{conv.last_message_preview}</p>
          )}
        </div>
      ))}
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
        <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-gray-500 text-sm">No bookings yet</p>
    </div>
  )
}
