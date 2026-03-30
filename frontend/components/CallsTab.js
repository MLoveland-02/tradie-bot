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

const PRIORITY_STYLES = {
  urgent:     { border: 'border-l-red-500',    badge: 'bg-red-500/20 text-red-400',    label: 'Urgent' },
  high_value: { border: 'border-l-orange-500', badge: 'bg-orange-500/20 text-orange-400', label: 'High value' },
  angry:      { border: 'border-l-red-600',    badge: 'bg-red-600/20 text-red-400',    label: 'Angry' },
}

const STATUS_STYLES = {
  open:        'bg-gray-700 text-gray-300',
  booked:      'bg-green-500/20 text-green-400',
  missed_call: 'bg-orange-500/20 text-orange-400',
}

export default function CallsTab() {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { businessId } = getStoredAuth()
      try {
        const res = await apiFetch(`/admin/conversations/${businessId}`)
        if (!res.ok) throw new Error('Failed to load')
        setConversations(await res.json())
      } catch {
        setError('Could not load conversations')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorMessage message={error} />
  if (conversations.length === 0) return <EmptyState message="No conversations yet" />

  return (
    <div className="space-y-3 px-4 py-4">
      {conversations.map((conv) => {
        const p = PRIORITY_STYLES[conv.priority]
        return (
          <div
            key={conv.id}
            className={`bg-gray-900 rounded-xl p-4 border-l-4 ${p ? p.border : 'border-l-gray-800'}`}
          >
            <div className="flex justify-between items-start gap-2">
              <span className="font-semibold text-sm tracking-wide">{conv.customer_phone}</span>
              <span className="text-xs text-gray-500 shrink-0">{formatTime(conv.last_message_at)}</span>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[conv.status] || STATUS_STYLES.open}`}>
                {conv.status?.replace('_', ' ')}
              </span>
              {p && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.badge}`}>
                  {p.label}
                </span>
              )}
            </div>

            {conv.last_message_preview && (
              <p className="text-sm text-gray-400 mt-2 line-clamp-1">{conv.last_message_preview}</p>
            )}
          </div>
        )
      })}
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

function EmptyState({ message }) {
  return (
    <div className="text-center py-20 text-gray-500 text-sm">{message}</div>
  )
}
