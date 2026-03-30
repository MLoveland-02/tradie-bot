'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredAuth, apiFetch } from '../../lib/api'

// ── Schedule helpers ──────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Every 30 minutes from 6:00am to 9:00pm
const TIME_OPTIONS = (() => {
  const times = []
  for (let h = 6; h <= 21; h++) {
    const period = h < 12 ? 'am' : 'pm'
    const h12 = h === 12 ? 12 : h > 12 ? h - 12 : h
    times.push(`${h12}:00${period}`)
    if (h < 21) times.push(`${h12}:30${period}`)
  }
  return times
})()

// Mon–Fri open by default, Sat–Sun closed
const DEFAULT_SCHEDULE = DAYS.map((_, i) => ({
  open: i < 5,
  openTime: '8:00am',
  closeTime: '6:00pm',
}))

function scheduleToString(schedule) {
  return schedule
    .map((day, i) => (day.open ? `${DAYS[i]} ${day.openTime}-${day.closeTime}` : null))
    .filter(Boolean)
    .join(', ')
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = ['Basic Info', 'Services & Hours', 'Booking Settings']

const INITIAL = {
  // Step 1
  name: '',
  owner_phone: '',
  service_area: '',
  tone: 'Professional',
  // Step 2 — opening_hours pre-filled from the default schedule
  services: '',
  opening_hours: scheduleToString(DEFAULT_SCHEDULE),
  pricing_info: '',
  // Step 3
  booking_enabled: true,
  booking_start_hour: 9,
  booking_end_hour: 17,
  booking_buffer_minutes: 15,
  average_job_value: '',
  urgent_keywords: '',
  high_value_keywords: '',
}

function validate(step, fields) {
  switch (step) {
    case 0:
      if (!fields.name.trim())         return 'Business name is required'
      if (!fields.owner_phone.trim())  return 'Owner phone is required'
      if (!fields.service_area.trim()) return 'Service area is required'
      return null
    case 1:
      if (!fields.services.trim())     return 'Services are required'
      if (!fields.opening_hours.trim()) return 'Please mark at least one day as open'
      return null
    default:
      return null
  }
}

// ── Shared input styles ───────────────────────────────────────────────────────

const inputCls =
  'w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors'

const labelCls = 'block text-sm font-medium text-gray-300 mb-1.5'

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [fields, setFields] = useState(INITIAL)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const { accessToken, expiresAt } = getStoredAuth()
    if (!accessToken || (expiresAt && expiresAt < Date.now() / 1000)) {
      router.replace('/')
    }
  }, [router])

  function set(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function handleNext() {
    const err = validate(step, fields)
    if (err) { setError(err); return }
    setError('')
    setStep((s) => s + 1)
  }

  function handleBack() {
    setError('')
    setStep((s) => s - 1)
  }

  async function handleSubmit() {
    setError('')
    setSubmitting(true)

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
        setError(data.error || 'Setup failed, please try again')
        return
      }

      router.replace('/dashboard')
    } catch {
      setError('Could not connect to server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto px-4 pb-10">
      <div className="pt-12 pb-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="font-bold text-lg tracking-tight">Tradie Bot</span>
        </div>
        <h1 className="text-2xl font-bold">Set up your business</h1>
        <p className="text-gray-400 text-sm mt-1">Takes about 2 minutes</p>
      </div>

      <ProgressBar step={step} total={STEPS.length} />

      <p className="text-xs font-semibold text-orange-500 uppercase tracking-widest mt-5 mb-4">
        Step {step + 1} — {STEPS[step]}
      </p>

      <div className="flex-1 space-y-5">
        {step === 0 && <Step1 fields={fields} set={set} />}
        {step === 1 && <Step2 fields={fields} set={set} />}
        {step === 2 && <Step3 fields={fields} set={set} />}
      </div>

      {error && (
        <p className="mt-4 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3 mt-6">
        {step > 0 && (
          <button
            onClick={handleBack}
            className="flex-1 border border-gray-700 text-gray-300 hover:text-white rounded-xl py-3.5 font-semibold transition-colors"
          >
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            className="flex-1 bg-orange-500 hover:bg-orange-400 text-white rounded-xl py-3.5 font-semibold transition-colors"
          >
            Next
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-3.5 font-semibold transition-colors"
          >
            {submitting ? 'Saving…' : 'Finish setup'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ step, total }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
            i <= step ? 'bg-orange-500' : 'bg-gray-800'
          }`}
        />
      ))}
    </div>
  )
}

// ── Step 1 — Basic Info ───────────────────────────────────────────────────────

function Step1({ fields, set }) {
  return (
    <>
      <div>
        <label className={labelCls}>Business name <Required /></label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. Smith Plumbing"
          value={fields.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls}>Your mobile number <Required /></label>
        <input
          type="tel"
          className={inputCls}
          placeholder="e.g. +44 7700 900000"
          value={fields.owner_phone}
          onChange={(e) => set('owner_phone', e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1.5">Used to alert you about urgent leads</p>
      </div>

      <div>
        <label className={labelCls}>Service area <Required /></label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. North London, Essex"
          value={fields.service_area}
          onChange={(e) => set('service_area', e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls}>Tone of voice <Required /></label>
        <select
          className={inputCls}
          value={fields.tone}
          onChange={(e) => set('tone', e.target.value)}
        >
          <option value="Professional">Professional</option>
          <option value="Friendly">Friendly</option>
          <option value="Casual">Casual</option>
        </select>
      </div>
    </>
  )
}

// ── Step 2 — Services & Hours ─────────────────────────────────────────────────

function Step2({ fields, set }) {
  return (
    <>
      <div>
        <label className={labelCls}>Services offered <Required /></label>
        <textarea
          rows={3}
          className={inputCls}
          placeholder="e.g. Boiler repair, annual service, power flushing"
          value={fields.services}
          onChange={(e) => set('services', e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls}>Opening hours <Required /></label>
        <ScheduleBuilder onChange={(val) => set('opening_hours', val)} />
      </div>

      <div>
        <label className={labelCls}>
          Pricing info{' '}
          <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <textarea
          rows={2}
          className={inputCls}
          placeholder="e.g. Call-out from £80, parts extra"
          value={fields.pricing_info}
          onChange={(e) => set('pricing_info', e.target.value)}
        />
      </div>
    </>
  )
}

// ── Schedule builder ──────────────────────────────────────────────────────────

const selectCls =
  'flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors'

function ScheduleBuilder({ onChange }) {
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE)

  function update(index, patch) {
    const next = schedule.map((day, i) => (i === index ? { ...day, ...patch } : day))
    setSchedule(next)
    onChange(scheduleToString(next))
  }

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden divide-y divide-gray-800/80">
      {DAYS.map((day, i) => {
        const { open, openTime, closeTime } = schedule[i]
        return (
          <div key={day} className="flex items-center gap-3 px-4 py-3">
            {/* Custom checkbox */}
            <button
              type="button"
              onClick={() => update(i, { open: !open })}
              aria-label={open ? `Mark ${day} as closed` : `Mark ${day} as open`}
              className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                open
                  ? 'bg-orange-500 border-orange-500'
                  : 'bg-transparent border-gray-600'
              }`}
            >
              {open && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M1.5 5l2.5 2.5 4.5-4.5" />
                </svg>
              )}
            </button>

            {/* Day name */}
            <span
              className={`w-8 text-sm font-semibold shrink-0 transition-colors ${
                open ? 'text-white' : 'text-gray-600'
              }`}
            >
              {day}
            </span>

            {/* Time dropdowns or closed label */}
            {open ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <select
                  value={openTime}
                  onChange={(e) => update(i, { openTime: e.target.value })}
                  className={selectCls}
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                <span className="text-gray-600 text-xs shrink-0">to</span>

                <select
                  value={closeTime}
                  onChange={(e) => update(i, { closeTime: e.target.value })}
                  className={selectCls}
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="text-gray-600 text-sm">Closed</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 3 — Booking Settings ─────────────────────────────────────────────────

function Step3({ fields, set }) {
  return (
    <>
      <div className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-4">
        <div>
          <p className="font-medium text-sm">Enable online bookings</p>
          <p className="text-xs text-gray-500 mt-0.5">Customers can book directly via SMS</p>
        </div>
        <button
          type="button"
          onClick={() => set('booking_enabled', !fields.booking_enabled)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            fields.booking_enabled ? 'bg-orange-500' : 'bg-gray-700'
          }`}
        >
          <span
            className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              fields.booking_enabled ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {fields.booking_enabled && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Start hour</label>
            <input
              type="number"
              min={0} max={23}
              className={inputCls}
              value={fields.booking_start_hour}
              onChange={(e) => set('booking_start_hour', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>End hour</label>
            <input
              type="number"
              min={0} max={23}
              className={inputCls}
              value={fields.booking_end_hour}
              onChange={(e) => set('booking_end_hour', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Buffer (min)</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={fields.booking_buffer_minutes}
              onChange={(e) => set('booking_buffer_minutes', e.target.value)}
            />
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>
          Average job value (£){' '}
          <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <input
          type="number"
          min={0}
          className={inputCls}
          placeholder="e.g. 350"
          value={fields.average_job_value}
          onChange={(e) => set('average_job_value', e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1.5">Used to estimate revenue on your dashboard</p>
      </div>

      <div>
        <label className={labelCls}>
          Urgent keywords{' '}
          <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. no heating, emergency, leak"
          value={fields.urgent_keywords}
          onChange={(e) => set('urgent_keywords', e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1.5">Comma separated — triggers an alert to your phone</p>
      </div>

      <div>
        <label className={labelCls}>
          High value keywords{' '}
          <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. extension, new bathroom, renovation"
          value={fields.high_value_keywords}
          onChange={(e) => set('high_value_keywords', e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1.5">Comma separated — highlighted on your dashboard</p>
      </div>
    </>
  )
}

function Required() {
  return <span className="text-orange-500">*</span>
}
