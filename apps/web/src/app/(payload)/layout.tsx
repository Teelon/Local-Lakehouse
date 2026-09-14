import React from 'react'
import '@payloadcms/ui/styles.css'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="payload-admin-wrapper">
      {children}
    </div>
  )
}
