'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { storeSession, getStoredAuth, apiFetch } from '../../lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL

const inputCls =
  'w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors'

export default function SignupPage() {
  const router = useRouter()
  const [fields, setFields] = useState({
    business_name: '',
    email: '',
    password: '',
    confirm_password: '',
    twilio_number: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const { accessToken, expiresAt } = getStoredAuth()
    if (accessToken && expiresAt > Date.now() / 1000) {
      router.replace('/dashboard')
    }
  }, [router])

  function set(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (fields.password !== fields.confirm_password) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fields.email,
          password: fields.password,
          business_name: fields.business_name,
          twilio_number: fields.twilio_number,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Signup failed')
        return
      }

      // Store session — signup doesn't return business_id so fetch it separately
      storeSession(data.session)

      try {
        const profileRes = await apiFetch('/admin/business/profile')
        if (profileRes.ok) {
          const profile = await profileRes.json()
          localStorage.setItem('business_id', profile.id)
        }
      } catch {
        // Non-fatal — business_id will be populated on next login
      }

      router.replace('/onboarding')
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="text-gray-400 text-sm mt-1">Get started with Tradie Bot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Business name</label>
            <input
              type="text"
              required
              className={inputCls}
              placeholder="e.g. Smith Plumbing"
              value={fields.business_name}
              onChange={(e) => set('business_name', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              className={inputCls}
              placeholder="you@example.com"
              value={fields.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              className={inputCls}
              placeholder="••••••••"
              value={fields.password}
              onChange={(e) => set('password', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Confirm password</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              className={inputCls}
              placeholder="••••••••"
              value={fields.confirm_password}
              onChange={(e) => set('confirm_password', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Twilio number</label>
            <input
              type="text"
              required
              className={inputCls}
              placeholder="+447700000000"
              value={fields.twilio_number}
              onChange={(e) => set('twilio_number', e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1.5">The Twilio number SMS messages are sent from</p>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link href="/" className="text-orange-500 hover:text-orange-400 font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
