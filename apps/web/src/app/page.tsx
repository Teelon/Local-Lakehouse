'use client'

import React, { useState } from 'react'

export default function LakehouseApp() {
  // Tenant & Ingestion State
  const [tenantId, setTenantId] = useState('tenant_acme')
  const [tableName, setTableName] = useState('customers')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  
  // Pipeline Progress
  const [isProcessing, setIsProcessing] = useState(false)
  const [ingestResult, setIngestResult] = useState<{
    success: boolean
    message: string
    table_name?: string
    row_count?: number
    columns?: string[]
    raw_s3_uri?: string
    parquet_s3_uri?: string
  } | null>(null)

  // SQL Query Studio State
  const [query, setQuery] = useState('SELECT * FROM tenant_acme_customers WHERE monthly_spend > 300 ORDER BY monthly_spend DESC')
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [queryResult, setQueryResult] = useState<{
    columns: string[]
    rows: any[][]
    row_count: number
  } | null>(null)

  // Fast sample loader helper
  const handleLoadSampleData = () => {
    const csvContent = `customer_id,customer_name,country,signup_date,plan_tier,monthly_spend
1001,Acme Analytics,USA,2026-01-15,Enterprise,1250.00
1002,Nordic Data Labs,Norway,2026-02-01,Pro,350.00
1003,Apex FinTech,UK,2026-02-18,Enterprise,2100.00
1004,Kyoto Systems,Japan,2026-03-05,Starter,49.00
1005,Berlin Cloudworks,Germany,2026-03-12,Pro,450.00`
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const sampleFile = new File([blob], 'sample_customers.csv', { type: 'text/csv' })
    setSelectedFile(sampleFile)
    setTableName('customers')
  }

  // Handle Form Submit: Ingest File -> Worker Pipeline -> DuckDB
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile) {
      alert('Please select or drop a dataset file first.')
      return
    }

    setIsProcessing(true)
    setIngestResult(null)

    const formData = new FormData()
    formData.append('tenant_id', tenantId)
    formData.append('table_name', tableName)
    formData.append('file', selectedFile)

    try {
      const res = await fetch('/api/pipeline/ingest', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Pipeline execution failed')
      }
      setIngestResult({
        success: true,
        message: data.message || `Committed ${data.row_count} rows into table '${data.table_name}'!`,
        table_name: data.table_name,
        row_count: data.row_count,
        columns: data.columns,
        raw_s3_uri: data.raw_s3_uri,
        parquet_s3_uri: data.parquet_s3_uri,
      })
      // Preset query to query the new table
      setQuery(`SELECT * FROM ${data.table_name} LIMIT 50`)
    } catch (err: any) {
      setIngestResult({
        success: false,
        message: err.message,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle Execute SQL Query
  const handleRunQuery = async () => {
    if (!query.trim()) return
    setQueryLoading(true)
    setQueryError(null)

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute query')
      }
      setQueryResult(data)
    } catch (err: any) {
      setQueryError(err.message)
    } finally {
      setQueryLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0b0f17', color: '#f1f5f9', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      {/* Top Navbar */}
      <nav style={{ borderBottom: '1px solid #1e293b', background: '#0f172a', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 12px #38bdf8' }} />
          <span style={{ fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-0.02em', color: '#ffffff' }}>Local Lakehouse MVP 1</span>
          <span style={{ fontSize: '0.75rem', background: '#1e293b', color: '#94a3b8', padding: '0.2rem 0.5rem', borderRadius: '4px', marginLeft: '0.5rem' }}>
            Single Node
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.85rem', alignItems: 'center' }}>
          <a
            href="http://localhost:9001"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', fontWeight: 500 }}
            title="Open RustFS Storage Console (lakehouse_storage_admin)"
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            RustFS Console &rarr;
          </a>
          <span style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8' }} />
            DuckDB Engine Ready
          </span>
          <a href="/admin" target="_blank" style={{ color: '#94a3b8', textDecoration: 'none' }}>Payload Admin &rarr;</a>
        </div>
      </nav>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        {/* Intro */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#ffffff' }}>
            Visual Ingestion &amp; Query Studio
          </h1>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.95rem' }}>
            Upload raw data files directly from your browser. The Python worker sanitizes schemas and commits them to the local lakehouse, where they are immediately queryable via DuckDB.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '2rem' }}>
          {/* PANEL 1: INGESTION UI */}
          <div style={{ background: '#111827', borderRadius: '12px', border: '1px solid #1f2937', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: '#f3f4f6' }}>
                1. Ingest Dataset
              </h2>
              <button
                type="button"
                onClick={handleLoadSampleData}
                style={{
                  background: '#1f2937',
                  border: '1px solid #374151',
                  color: '#93c5fd',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                + Load Sample Customers (CSV)
              </button>
            </div>

            <form onSubmit={handleIngest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#9ca3af', marginBottom: '0.35rem' }}>
                    Tenant Scope
                  </label>
                  <input
                    type="text"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#1f2937',
                      border: '1px solid #374151',
                      color: '#f9fafb',
                      padding: '0.6rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.88rem',
                      boxSizing: 'border-box'
                    }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#9ca3af', marginBottom: '0.35rem' }}>
                    Target Table Name
                  </label>
                  <input
                    type="text"
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#1f2937',
                      border: '1px solid #374151',
                      color: '#f9fafb',
                      padding: '0.6rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.88rem',
                      boxSizing: 'border-box'
                    }}
                    required
                  />
                </div>
              </div>

              {/* Drag & Drop File Zone */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#9ca3af', marginBottom: '0.35rem' }}>
                  Dataset File (CSV, Parquet, or JSON)
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    if (e.dataTransfer.files?.[0]) setSelectedFile(e.dataTransfer.files[0])
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? '#38bdf8' : '#374151'}`,
                    background: dragOver ? 'rgba(56, 189, 248, 0.05)' : '#182234',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border 0.2s, background 0.2s',
                  }}
                  onClick={() => document.getElementById('file-upload-input')?.click()}
                >
                  <input
                    id="file-upload-input"
                    type="file"
                    accept=".csv,.parquet,.json,.ndjson"
                    style={{ display: 'none' }}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                  {selectedFile ? (
                    <div>
                      <div style={{ color: '#38bdf8', fontWeight: 600, fontSize: '0.95rem' }}>📄 {selectedFile.name}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        {(selectedFile.size / 1024).toFixed(1)} KB — Click to change file
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: '#e2e8f0', fontSize: '0.9rem', fontWeight: 500 }}>
                        Click to select or drag and drop file here
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.3rem' }}>
                        Supports .csv, .parquet, .json, .ndjson
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isProcessing || !selectedFile}
                style={{
                  background: isProcessing ? '#1d4ed8' : '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.92rem',
                  cursor: isProcessing || !selectedFile ? 'not-allowed' : 'pointer',
                  opacity: !selectedFile ? 0.6 : 1,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginTop: '0.5rem'
                }}
              >
                {isProcessing ? '⚡ Processing & Committing to Lakehouse...' : '🚀 Ingest & Commit Table'}
              </button>
            </form>

            {/* Ingestion Status Notification */}
            {ingestResult && (
              <div style={{
                borderRadius: '8px',
                padding: '1.1rem',
                fontSize: '0.88rem',
                border: `1px solid ${ingestResult.success ? '#065f46' : '#991b1b'}`,
                background: ingestResult.success ? 'rgba(6, 95, 70, 0.2)' : 'rgba(153, 27, 27, 0.2)',
                color: ingestResult.success ? '#34d399' : '#f87171'
              }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.95rem' }}>
                  {ingestResult.success ? '✅ Ingestion & RustFS Commit Successful' : '❌ Pipeline Error'}
                </div>
                <div>{ingestResult.message}</div>
                {ingestResult.raw_s3_uri && (
                  <div style={{ marginTop: '0.65rem', fontSize: '0.8rem', color: '#cbd5e1', wordBreak: 'break-all' }}>
                    <strong>Raw S3 Object (RustFS):</strong> <br />
                    <code style={{ color: '#38bdf8', background: '#0f172a', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                      {ingestResult.raw_s3_uri}
                    </code>
                  </div>
                )}
                {ingestResult.parquet_s3_uri && (
                  <div style={{ marginTop: '0.45rem', fontSize: '0.8rem', color: '#cbd5e1', wordBreak: 'break-all' }}>
                    <strong>Committed Parquet (RustFS):</strong> <br />
                    <code style={{ color: '#a7f3d0', background: '#0f172a', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                      {ingestResult.parquet_s3_uri}
                    </code>
                  </div>
                )}
                {ingestResult.columns && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1' }}>
                    <strong>Sanitized Columns:</strong> {ingestResult.columns.join(', ')}
                  </div>
                )}
                {ingestResult.success && (
                  <div style={{ marginTop: '0.85rem', paddingTop: '0.65rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.8rem' }}>
                    <a
                      href="http://localhost:9001"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#38bdf8', textDecoration: 'underline', fontWeight: 500 }}
                    >
                      Inspect in RustFS Web Console (port 9001) &rarr;
                    </a>
                    <span style={{ color: '#94a3b8', marginLeft: '0.5rem' }}>(User: lakehouse_storage_admin)</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PANEL 2: SYSTEM ARCHITECTURE CONTEXT */}
          <div style={{ background: '#111827', borderRadius: '12px', border: '1px solid #1f2937', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: '#f3f4f6' }}>
              Lakehouse Ingestion Steps (What Happens Under the Hood)
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ background: '#182234', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #38bdf8' }}>
                <strong style={{ color: '#38bdf8' }}>Step 1: Ingestion API</strong>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8' }}>
                  Next.js receives your raw file and delegates processing to the FastAPI worker.
                </p>
              </div>

              <div style={{ background: '#182234', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #818cf8' }}>
                <strong style={{ color: '#818cf8' }}>Step 2: Cleaning &amp; Sanitization</strong>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8' }}>
                  <code>cleaner.py</code> normalizes special characters, lowercases columns, and detects schemas safely.
                </p>
              </div>

              <div style={{ background: '#182234', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #34d399' }}>
                <strong style={{ color: '#34d399' }}>Step 3: DuckLake Table Commit</strong>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8' }}>
                  The data is committed under tenant prefix namespace: <code>{tenantId}_{tableName}</code> in DuckDB storage.
                </p>
              </div>

              <div style={{ background: '#182234', padding: '0.85rem', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                <strong style={{ color: '#f59e0b' }}>Step 4: Interactive Querying</strong>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8' }}>
                  Your SQL query runs directly against the newly committed table with analytical speed.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM SECTION: SQL QUERY STUDIO */}
        <section style={{ marginTop: '2rem', background: '#111827', borderRadius: '12px', border: '1px solid #1f2937', padding: '1.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: '#f3f4f6' }}>
                2. Retrieve &amp; Query (DuckDB SQL Studio)
              </h2>
              <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
                Run ad-hoc SQL queries against your committed tables.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunQuery}
              disabled={queryLoading}
              style={{
                background: '#10b981',
                color: '#ffffff',
                border: 'none',
                padding: '0.6rem 1.25rem',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: queryLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              {queryLoading ? 'Executing...' : '▶ Run Query'}
            </button>
          </div>

          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              background: '#090d16',
              color: '#e2e8f0',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: '0.92rem',
              padding: '0.85rem',
              borderRadius: '8px',
              border: '1px solid #374151',
              boxSizing: 'border-box',
              outline: 'none',
              resize: 'vertical'
            }}
          />

          {queryError && (
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(220, 38, 38, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#f87171', fontSize: '0.88rem' }}>
              <strong>Query Error:</strong> {queryError}
            </div>
          )}

          {/* RESULTS TABLE */}
          {queryResult && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Returned <strong>{queryResult.row_count}</strong> record(s)
                </span>
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid #1f2937', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#182234', borderBottom: '1px solid #1f2937' }}>
                      {queryResult.columns.map((col) => (
                        <th key={col} style={{ padding: '0.75rem 1rem', color: '#38bdf8', fontWeight: 600 }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.length === 0 ? (
                      <tr>
                        <td colSpan={queryResult.columns.length || 1} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          0 rows matching query filter.
                        </td>
                      </tr>
                    ) : (
                      queryResult.rows.map((row, idx) => (
                        <tr key={idx} style={{ background: idx % 2 === 0 ? '#0f172a' : '#111827', borderBottom: '1px solid #1e293b' }}>
                          {row.map((cell, cidx) => (
                            <td key={cidx} style={{ padding: '0.65rem 1rem', color: '#cbd5e1' }}>
                              {String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
