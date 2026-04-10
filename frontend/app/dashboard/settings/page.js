'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredAuth, clearAuth, apiFetch } from '../../../lib/api'
import DashboardNav from '../../../components/DashboardNav'
import ScheduleBuilder from '../../../components/ScheduleBuilder'

const inputCls =
  'w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors'

const labelCls = 'block text-sm font-medium text-gray-300 mb-1.5'

const EMPTY = {
  name: '',
  owner_phone: '',
  service_area: '',
  tone: 'Professional',
  services: '',
  opening_hours: '',
  pricing_info: '',
  average_job_value: '',
  urgent_keywords: '',
  high_value_keywords: '',
  booking_enabled: true,
  booking_start_hour: 9,
  booking_end_hour: 17,
  booking_buffer_minutes: 15,
  voice_preference: 'nova',
}

export default function SettingsPage() {
  const router = useRouter()
  const [fields, setFields] = useState(EMPTY)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const { accessToken, expiresAt } = getStoredAuth()
    if (!accessToken || (expiresAt && expiresAt < Date.now() / 1000)) {
      router.replace('/')
      return
    }

    apiFetch('/admin/business/profile')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((profile) => {
        setFields({
          name:                   profile.name                   ?? '',
          owner_phone:            profile.owner_phone            ?? '',
          service_area:           profile.service_area           ?? '',
          tone:                   profile.tone                   ?? 'Professional',
          services:               profile.services               ?? '',
          opening_hours:          profile.opening_hours          ?? '',
          pricing_info:           profile.pricing_info           ?? '',
          average_job_value:      profile.average_job_value      ?? '',
          urgent_keywords:        profile.urgent_keywords        ?? '',
          high_value_keywords:    profile.high_value_keywords    ?? '',
          booking_enabled:        profile.booking_enabled        ?? true,
          booking_start_hour:     profile.booking_start_hour     ?? 9,
          booking_end_hour:       profile.booking_end_hour       ?? 17,
          booking_buffer_minutes: profile.booking_buffer_minutes ?? 15,
          voice_preference:       profile.voice_preference       ?? 'nova',
        })
        setProfileLoaded(true)
      })
      .catch(() => {
        // Show form with defaults if profile fetch fails
        setProfileLoaded(true)
      })
  }, [router])

  function set(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }))
    setError('')
    setSuccess(false)
  }

  async function handleSave() {
    setError('')
    setSuccess(false)
    setSaving(true)

    const payload = {
      ...fields,
      booking_start_hour:     Number(fields.booking_start_hour),
      booking_end_hour:       Number(fields.booking_end_hour),
      booking_buffer_minutes: Number(fields.booking_buffer_minutes),
      average_job_value: fields.average_job_value ? Number(fields.average_job_value) : undefined,
    }

    try {
      const res = await apiFetch('/admin/business/setup', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Save failed, please try again')
        return
      }

      setSuccess(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('Could not connect to server')
    } finally {
      setSaving(false)
    }
  }

  function handleTabChange(tab) {
    if (tab !== 'settings') router.push('/dashboard')
  }

  function handleSignOut() {
    clearAuth()
    router.replace('/')
  }

  if (!profileLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-orange-500 animate-spin" />
      </div>
    )
  }

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
          <span className="font-bold text-base tracking-tight">Settings</span>
        </div>
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-28 px-4 py-5 space-y-6">
        {success && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-green-400 text-sm">
            Changes saved successfully.
          </div>
        )}

        {/* ── Business ── */}
        <Section title="Business">
          <div>
            <label className={labelCls}>Business name</label>
            <input type="text" className={inputCls} value={fields.name}
              onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Owner phone</label>
            <input type="tel" className={inputCls} placeholder="+44 7700 900000"
              value={fields.owner_phone} onChange={(e) => set('owner_phone', e.target.value)} />
            <p className="text-xs text-gray-500 mt-1.5">Used to alert you about urgent leads</p>
          </div>
          <div>
            <label className={labelCls}>Service area</label>
            <input type="text" className={inputCls} placeholder="e.g. North London, Essex"
              value={fields.service_area} onChange={(e) => set('service_area', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Tone of voice</label>
            <select className={inputCls} value={fields.tone} onChange={(e) => set('tone', e.target.value)}>
              <option value="Professional">Professional</option>
              <option value="Friendly">Friendly</option>
              <option value="Casual">Casual</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>AI call voice</label>
            <select className={inputCls} value={fields.voice_preference} onChange={(e) => set('voice_preference', e.target.value)}>
              <option value="nova">Nova — warm &amp; natural (default)</option>
              <option value="alloy">Alloy — neutral &amp; balanced</option>
              <option value="echo">Echo — deep &amp; authoritative</option>
              <option value="shimmer">Shimmer — clear &amp; expressive</option>
            </select>
            <p className="text-xs text-gray-500 mt-1.5">Voice used when the AI answers phone calls</p>
          </div>
        </Section>

        {/* ── Services & Hours ── */}
        <Section title="Services &amp; Hours">
          <div>
            <label className={labelCls}>Services offered</label>
            <textarea rows={3} className={inputCls} placeholder="e.g. Boiler repair, annual service"
              value={fields.services} onChange={(e) => set('services', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Opening hours</label>
            {/* key forces ScheduleBuilder to re-mount with the correct initialValue
                once the profile has loaded — without this it would init from empty string */}
            <ScheduleBuilder
              key={fields.opening_hours || 'default'}
              initialValue={fields.opening_hours}
              onChange={(val) => set('opening_hours', val)}
            />
          </div>
          <div>
            <label className={labelCls}>Pricing info <span className="text-gray-500 font-normal">(optional)</span></label>
            <textarea rows={2} className={inputCls} placeholder="e.g. Call-out from £80, parts extra"
              value={fields.pricing_info} onChange={(e) => set('pricing_info', e.target.value)} />
          </div>
        </Section>

        {/* ── Leads ── */}
        <Section title="Lead Detection">
          <div>
            <label className={labelCls}>Urgent keywords <span className="text-gray-500 font-normal">(optional)</span></label>
            <input type="text" className={inputCls} placeholder="e.g. no heating, emergency, leak"
              value={fields.urgent_keywords} onChange={(e) => set('urgent_keywords', e.target.value)} />
            <p className="text-xs text-gray-500 mt-1.5">Comma separated — triggers an alert to your phone</p>
          </div>
          <div>
            <label className={labelCls}>High value keywords <span className="text-gray-500 font-normal">(optional)</span></label>
            <input type="text" className={inputCls} placeholder="e.g. extension, new bathroom, renovation"
              value={fields.high_value_keywords} onChange={(e) => set('high_value_keywords', e.target.value)} />
            <p className="text-xs text-gray-500 mt-1.5">Comma separated — highlighted on your dashboard</p>
          </div>
        </Section>

        {/* ── Bookings ── */}
        <Section title="Bookings">
          <div className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-4">
            <div>
              <p className="font-medium text-sm">Enable online bookings</p>
              <p className="text-xs text-gray-500 mt-0.5">Customers can book directly via SMS</p>
            </div>
            <button
              type="button"
              onClick={() => set('booking_enabled', !fields.booking_enabled)}
              className={`relative w-12 h-6 rounded-full transition-colors ${fields.booking_enabled ? 'bg-orange-500' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${fields.booking_enabled ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>

          {fields.booking_enabled && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Start hour</label>
                <input type="number" min={0} max={23} className={inputCls}
                  value={fields.booking_start_hour} onChange={(e) => set('booking_start_hour', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>End hour</label>
                <input type="number" min={0} max={23} className={inputCls}
                  value={fields.booking_end_hour} onChange={(e) => set('booking_end_hour', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Buffer (min)</label>
                <input type="number" min={0} className={inputCls}
                  value={fields.booking_buffer_minutes} onChange={(e) => set('booking_buffer_minutes', e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Average job value (£) <span className="text-gray-500 font-normal">(optional)</span></label>
            <input type="number" min={0} className={inputCls} placeholder="e.g. 350"
              value={fields.average_job_value} onChange={(e) => set('average_job_value', e.target.value)} />
            <p className="text-xs text-gray-500 mt-1.5">Used to estimate revenue on your dashboard</p>
          </div>
        </Section>

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </main>

      <DashboardNav activeTab="settings" onTabChange={handleTabChange} />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold text-orange-500 uppercase tracking-widest">{title}</h2>
      {children}
    </div>
  )
}
