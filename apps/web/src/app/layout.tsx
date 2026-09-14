import React from 'react'

export const metadata = {
  title: 'Local Lakehouse Platform',
  description: 'Self-hostable Lakehouse Control Plane',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
