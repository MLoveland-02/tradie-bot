'use client'

export const NAV_TABS = [
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
  {
    id: 'settings',
    label: 'Settings',
    icon: (active) => (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2 : 1.5}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2 : 1.5}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function DashboardNav({ activeTab, onTabChange }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gray-900 border-t border-gray-800 flex">
      {NAV_TABS.map((tab) => {
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
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
  )
}
