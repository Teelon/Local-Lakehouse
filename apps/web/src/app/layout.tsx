import React from 'react'

export const metadata = {
  title: 'Local Lakehouse (LLH) | Self-Hosted Lakehouse Platform',
  description: 'Fast, secure local lakehouse with DuckDB, RustFS, and Payload CMS',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className="dark" lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
            @layer base {
              html, body {
                margin: 0;
                padding: 0;
                background-color: #09090b;
                color: #f4f4f5;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              }
              body {
                overscroll-behavior: none;
              }
            }
            ::-webkit-scrollbar {
              width: 6px;
              height: 6px;
            }
            ::-webkit-scrollbar-track {
              background: transparent;
            }
            ::-webkit-scrollbar-thumb {
              background: #27272a;
              border-radius: 3px;
            }
            ::-webkit-scrollbar-thumb:hover {
              background: #3f3f46;
            }
            .material-symbols-outlined {
              font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
              display: inline-block;
              vertical-align: middle;
              line-height: 1;
              user-select: none;
            }
          `,
          }}
        />
        <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
            tailwind.config = {
              darkMode: "class",
              theme: {
                extend: {
                  colors: {
                    app: {
                      bg: '#09090b',
                      surface: '#0d0d11',
                      panel: '#121216',
                      elevated: '#18181c',
                      border: '#222227',
                      muted: '#27272a',
                    },
                    surface: "#09090b",
                    "surface-subtle": "#121215",
                    "surface-elevated": "#18181b",
                    "border-subtle": "#222227",
                    "border-strong": "#3f3f46",
                    "text-primary": "#f4f4f5",
                    "text-secondary": "#a1a1aa",
                    "text-muted": "#71717a",
                    brand: "#e4e4e7"
                  },
                  fontFamily: {
                    sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                    mono: ['JetBrains Mono', 'monospace'],
                  }
                }
              }
            };
          `,
          }}
        />
      </head>
      <body className="bg-app-bg text-zinc-100 antialiased h-screen overflow-hidden text-[13px]">
        {children}
      </body>
    </html>
  )
}

