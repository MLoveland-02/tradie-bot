import './globals.css'

export const metadata = {
  title: 'Tradie Bot',
  description: 'AI Receptionist Dashboard',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">
        {children}
      </body>
    </html>
  )
}
