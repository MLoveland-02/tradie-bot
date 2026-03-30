'use client'

import { useState } from 'react'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Every 30 minutes from 6:00am to 9:00pm
export const TIME_OPTIONS = (() => {
  const times = []
  for (let h = 6; h <= 21; h++) {
    const period = h < 12 ? 'am' : 'pm'
    const h12 = h === 12 ? 12 : h > 12 ? h - 12 : h
    times.push(`${h12}:00${period}`)
    if (h < 21) times.push(`${h12}:30${period}`)
  }
  return times
})()

export const DEFAULT_SCHEDULE = DAYS.map((_, i) => ({
  open: i < 5, // Mon–Fri open, Sat–Sun closed
  openTime: '8:00am',
  closeTime: '6:00pm',
}))

export function scheduleToString(schedule) {
  return schedule
    .map((day, i) => (day.open ? `${DAYS[i]} ${day.openTime}-${day.closeTime}` : null))
    .filter(Boolean)
    .join(', ')
}

// Parse "Mon 8:00am-6:00pm, Fri 9:00am-5:00pm" back into a schedule array
export function parseSchedule(hoursString) {
  const schedule = DAYS.map((_, i) => ({
    open: false,
    openTime: '8:00am',
    closeTime: '6:00pm',
  }))

  if (!hoursString) return schedule

  for (const entry of hoursString.split(', ')) {
    const match = entry.trim().match(/^(\w{3})\s+(.+?)-(.+)$/)
    if (!match) continue
    const [, dayName, openTime, closeTime] = match
    const idx = DAYS.indexOf(dayName)
    if (idx !== -1) schedule[idx] = { open: true, openTime, closeTime }
  }

  return schedule
}

const selectCls =
  'flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors'

// initialValue: existing opening_hours string to pre-populate (optional)
// onChange: called with the new hours string on every change
export default function ScheduleBuilder({ onChange, initialValue }) {
  const [schedule, setSchedule] = useState(() =>
    initialValue ? parseSchedule(initialValue) : DEFAULT_SCHEDULE
  )

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
                open ? 'bg-orange-500 border-orange-500' : 'bg-transparent border-gray-600'
              }`}
            >
              {open && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M1.5 5l2.5 2.5 4.5-4.5" />
                </svg>
              )}
            </button>

            {/* Day name */}
            <span className={`w-8 text-sm font-semibold shrink-0 transition-colors ${open ? 'text-white' : 'text-gray-600'}`}>
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
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-gray-600 text-xs shrink-0">to</span>
                <select
                  value={closeTime}
                  onChange={(e) => update(i, { closeTime: e.target.value })}
                  className={selectCls}
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
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
