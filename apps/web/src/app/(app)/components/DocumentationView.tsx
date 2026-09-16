'use client'

import React, { useState, useMemo } from 'react'

interface DocumentationViewProps {
  tenantId?: string
  onNavigateToUpload?: () => void
  onNavigateToSql?: (initialQuery?: string) => void
}

interface DocSection {
  id: string
  title: string
  subtitle: string
  category: 'core' | 'architecture' | 'api' | 'ops'
  icon: string
  keywords: string[]
}

const SECTIONS: DocSection[] = [
  {
    id: 'ingestion-silver',
    title: 'Ingestion & Raw-to-Silver Pipeline',
    subtitle: 'Step-by-step lifecycle of how raw datasets transform into queryable Silver tables',
    category: 'core',
    icon: 'transform',
    keywords: ['ingestion', 'raw', 'silver', 'pipeline', 'cleaner', 'committer', 'csv', 'parquet', 'json', 'ducklake', 'sts'],
  },
  {
    id: 'medallion',
    title: 'Medallion Architecture',
    subtitle: 'Understanding the Bronze, Silver, and Gold data layers in Local Lakehouse',
    category: 'architecture',
    icon: 'layers',
    keywords: ['medallion', 'bronze', 'silver', 'gold', 'views', 'materialized', 'lineage'],
  },
  {
    id: 'storage-isolation',
    title: 'Storage & Multi-Tenant Isolation',
    subtitle: 'S3 bucket paths, STS temporary credentials, and schema namespace security',
    category: 'architecture',
    icon: 'security',
    keywords: ['storage', 's3', 'rustfs', 'sts', 'isolation', 'tenant', 'security', 'prefix'],
  },
  {
    id: 'ducklake-catalog',
    title: 'DuckLake Catalog & Query Engine',
    subtitle: 'DuckDB in-process analytics, atomic commits, and PostgreSQL metadata catalog',
    category: 'architecture',
    icon: 'database',
    keywords: ['ducklake', 'duckdb', 'catalog', 'postgres', 'transactions', 'snapshots', 'engine'],
  },
  {
    id: 'api-reference',
    title: 'REST API Reference',
    subtitle: 'Complete endpoint specs for ingestion, queries, views, and datasets',
    category: 'api',
    icon: 'api',
    keywords: ['api', 'curl', 'endpoints', 'upload', 'query', 'gold', 'delete', 'rest'],
  },
  {
    id: 'quickstart-ops',
    title: 'Quickstart & Operations',
    subtitle: 'Docker Compose bootstrap, service ports, healthchecks, and data reset',
    category: 'ops',
    icon: 'rocket_launch',
    keywords: ['quickstart', 'docker', 'compose', 'ports', 'health', 'reset', 'teardown'],
  },
]

export default function DocumentationView({
  tenantId = 'tenant_acme',
  onNavigateToUpload,
  onNavigateToSql,
}: DocumentationViewProps) {
  const [activeSectionId, setActiveSectionId] = useState<string>('ingestion-silver')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [activeTabFormat, setActiveTabFormat] = useState<'csv' | 'json' | 'parquet'>('csv')

  const copyToClipboard = (key: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => {
      setCopiedKey(null)
    }, 2000)
  }

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return SECTIONS
    const q = searchQuery.toLowerCase().trim()
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.includes(q))
    )
  }, [searchQuery])

  const activeSection = SECTIONS.find((s) => s.id === activeSectionId) || SECTIONS[0]

  return (
    <main className="flex-1 flex flex-col bg-app-bg min-w-0 overflow-hidden select-text">
      {/* SUB-HEADER BREADCRUMB */}
      <header className="h-12 border-b border-app-border bg-app-surface/95 backdrop-blur z-20 flex items-center justify-between px-6 shrink-0 select-none">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="text-zinc-500">Workspace</span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-100 font-medium flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-indigo-400">menu_book</span>
            Documentation
          </span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-300 font-mono text-[11px]">{activeSection.title}</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigateToUpload?.()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">upload</span>
            <span>Ingest Data</span>
          </button>
          <button
            onClick={() => onNavigateToSql?.(`SELECT * FROM ${tenantId}_silver LIMIT 10;`)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-[14px]">terminal</span>
            <span>SQL Studio</span>
          </button>
        </div>
      </header>

      {/* DOCUMENTATION BODY */}
      <div className="flex-1 flex overflow-hidden">
        {/* DOCS SUB-SIDEBAR */}
        <aside className="w-64 border-r border-app-border bg-app-surface/40 flex flex-col shrink-0 select-none">
          {/* SEARCH BAR */}
          <div className="p-3 border-b border-app-border">
            <div className="flex items-center rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 focus-within:border-indigo-500/70 transition-colors">
              <span className="material-symbols-outlined text-[15px] text-zinc-500 mr-1.5">search</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search topics, formats, APIs..."
                className="bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none w-full font-sans"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-zinc-500 hover:text-zinc-300">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>
          </div>

          {/* SECTION NAV LIST */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1 text-[10px] font-mono tracking-wider uppercase text-zinc-500 font-semibold">
              Guides & Reference
            </div>
            {filteredSections.map((sec) => {
              const isActive = sec.id === activeSectionId
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSectionId(sec.id)}
                  className={`w-full text-left px-2.5 py-2 rounded flex items-start gap-2.5 transition-all ${
                    isActive
                      ? 'bg-zinc-800/90 text-zinc-100 font-medium border border-zinc-700/60 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 border border-transparent'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[17px] shrink-0 mt-0.5 ${
                      isActive ? 'text-indigo-400' : 'text-zinc-500'
                    }`}
                  >
                    {sec.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs truncate leading-tight">{sec.title}</div>
                    <div className="text-[10px] text-zinc-500 truncate mt-0.5 font-normal">
                      {sec.subtitle}
                    </div>
                  </div>
                </button>
              )
            })}
            {filteredSections.length === 0 && (
              <div className="p-4 text-center text-xs text-zinc-500">
                No documentation topics match &quot;{searchQuery}&quot;
              </div>
            )}
          </div>

          {/* VERSION / FOOTER */}
          <div className="p-3 border-t border-app-border text-[11px] text-zinc-500 flex items-center justify-between font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Local Lakehouse v1.0</span>
            </span>
            <a
              href="https://github.com/Teelon/Local-Lakehouse"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
            >
              GitHub
              <span className="material-symbols-outlined text-[11px]">open_in_new</span>
            </a>
          </div>
        </aside>

        {/* MAIN DOCUMENTATION CONTENT */}
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* SECTION 1: INGESTION & RAW TO SILVER */}
            {activeSectionId === 'ingestion-silver' && (
              <div className="space-y-8 animate-fadeIn">
                {/* HERO HEADER */}
                <div className="border-b border-app-border pb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      Core Pipeline
                    </span>
                    <span className="text-zinc-500 text-xs">·</span>
                    <span className="text-zinc-400 text-xs font-mono">Format: CSV, Parquet, JSON</span>
                  </div>
                  <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                    Data Ingestion: How Raw Data Turns Into Silver
                  </h1>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                    Local Lakehouse automates the full transformation lifecycle from raw, unvalidated files
                    landing in object storage to atomic, typed, and queryable Parquet tables registered in
                    the DuckLake catalog.
                  </p>
                </div>

                {/* INTERACTIVE VISUAL PIPELINE FLOW */}
                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-indigo-400">schema</span>
                      End-to-End Ingestion Flow Architecture
                    </h2>
                    <span className="text-[11px] text-zinc-500 font-mono">Automatic Pipeline Execution</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-center text-xs">
                    {/* Stage 1 */}
                    <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-between relative group hover:border-zinc-700 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center font-mono text-xs font-bold mb-2">
                        1
                      </div>
                      <div className="font-medium text-zinc-200">Raw Upload</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">STS Scoped S3</div>
                      <div className="text-[10px] text-blue-400/90 mt-1 font-mono">tenants/{tenantId}/raw/</div>
                    </div>

                    {/* Stage 2 */}
                    <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-between relative group hover:border-zinc-700 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-mono text-xs font-bold mb-2">
                        2
                      </div>
                      <div className="font-medium text-zinc-200">Payload CMS</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">State: &apos;uploaded&apos;</div>
                      <div className="text-[10px] text-indigo-400/90 mt-1 font-mono">Datasets Collection</div>
                    </div>

                    {/* Stage 3 */}
                    <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-between relative group hover:border-zinc-700 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center font-mono text-xs font-bold mb-2">
                        3
                      </div>
                      <div className="font-medium text-zinc-200">Jobs Queue</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">Async Dispatch</div>
                      <div className="text-[10px] text-purple-400/90 mt-1 font-mono">task: ingest-file</div>
                    </div>

                    {/* Stage 4 */}
                    <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-between relative group hover:border-zinc-700 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center font-mono text-xs font-bold mb-2">
                        4
                      </div>
                      <div className="font-medium text-zinc-200">FastAPI Cleaner</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">Sanitize & Normalize</div>
                      <div className="text-[10px] text-amber-400/90 mt-1 font-mono">IngestionCleaner</div>
                    </div>

                    {/* Stage 5 */}
                    <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-between relative group hover:border-zinc-700 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-mono text-xs font-bold mb-2">
                        5
                      </div>
                      <div className="font-medium text-zinc-200">DuckLake Commit</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">ACID Parquet Write</div>
                      <div className="text-[10px] text-emerald-400/90 mt-1 font-mono">ducklake_catalog</div>
                    </div>

                    {/* Stage 6 */}
                    <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-between relative group hover:border-zinc-700 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center font-mono text-xs font-bold mb-2">
                        6
                      </div>
                      <div className="font-medium text-zinc-200">Silver View</div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">Live DuckDB Query</div>
                      <div className="text-[10px] text-teal-400/90 mt-1 font-mono">{tenantId}_silver.*</div>
                    </div>
                  </div>
                </div>

                {/* DETAILED 6-STEP BREAKDOWN */}
                <div className="space-y-6">
                  <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                    <span className="material-symbols-outlined text-indigo-400 text-[18px]">list_alt</span>
                    Deep-Dive: The 6 Transformation Stages
                  </h2>

                  {/* Step 1 */}
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-mono flex items-center justify-center font-bold">
                          1
                        </span>
                        Raw Landing via STS-Scoped Object Storage
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-500">Security & Durability</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      When a tenant uploads data (CSV, Parquet, or JSON), the Control Plane requests
                      temporary credentials via AWS STS. The write is strictly restricted to the tenant&apos;s
                      designated raw directory prefix:
                    </p>
                    <div className="p-3 rounded bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-blue-300 flex items-center justify-between">
                      <code>s3://lakehouse-bucket/tenants/{tenantId}/raw/&#123;timestamp&#125;_&#123;filename&#125;</code>
                      <button
                        onClick={() =>
                          copyToClipboard('s3-raw', `s3://lakehouse-bucket/tenants/${tenantId}/raw/`)
                        }
                        className="text-zinc-500 hover:text-zinc-300 ml-2"
                        title="Copy S3 URI pattern"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copiedKey === 's3-raw' ? 'check' : 'content_copy'}
                        </span>
                      </button>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      <strong>Why Raw Landing?</strong> It ensures an immutable audit trail. The raw file is
                      never modified or mutated in place. If schema rules or transformation logic change in the
                      future, the raw source can always be re-ingested.
                    </div>
                  </div>

                  {/* Step 2 & 3 */}
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-xs font-mono flex items-center justify-center font-bold">
                          2-3
                        </span>
                        Metadata Tracking & Asynchronous Queueing
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-500">Control Plane & Jobs</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Once the raw file is persisted, Next.js calls{' '}
                      <code className="text-zinc-200">DatasetRepository.createSilverDataset()</code> in Payload CMS.
                      A new record is inserted in the <code className="text-zinc-200">datasets</code> collection with
                      status <code className="text-amber-400">uploaded</code>.
                    </p>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Payload&apos;s <code className="text-zinc-200">afterChange</code> hook detects the status and
                      immediately enqueues a background task:
                    </p>
                    <div className="p-3 rounded bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-zinc-300">
                      <span className="text-zinc-500">// Payload Task invocation:</span>
                      <br />
                      task: <span className="text-purple-400">&quot;ingest-file&quot;</span>
                      <br />
                      input: &#123; tenantId: <span className="text-emerald-400">&quot;{tenantId}&quot;</span>,
                      tableName: <span className="text-emerald-400">&quot;orders&quot;</span>, rawFilePath: ... &#125;
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-mono flex items-center justify-center font-bold">
                          4
                        </span>
                        Data Cleansing & Schema Normalization (IngestionCleaner)
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-500">Python Worker & DuckDB</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      The worker receives the task via <code className="text-zinc-200">POST /api/v1/jobs/ingest</code>.
                      The <code className="text-amber-300">IngestionCleaner</code> module processes the raw file using
                      DuckDB&apos;s parallel reader and applies automated normalization rules:
                    </p>
                    <ul className="list-disc list-inside text-xs text-zinc-400 space-y-1.5 pl-2">
                      <li>
                        <strong>Column Sanitization:</strong> Non-alphanumeric characters are replaced with
                        underscores, deduplicated, and converted to lowercase.
                        (e.g., <code className="text-zinc-300">&quot;Order ID (#)&quot;</code> →{' '}
                        <code className="text-emerald-300">&quot;order_id&quot;</code>).
                      </li>
                      <li>
                        <strong>Type Inference & Coercion:</strong> DuckDB scans sample chunks to infer integers,
                        floats, timestamps, booleans, or strings.
                      </li>
                      <li>
                        <strong>Zero In-Memory Explosion:</strong> Relations are streamed directly without
                        serializing entire tables into Python memory.
                      </li>
                    </ul>

                    {/* Format Selector Pill */}
                    <div className="pt-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] text-zinc-400 font-medium">Reader Behavior by Format:</span>
                        <div className="flex rounded bg-zinc-900 border border-zinc-800 p-0.5 text-[11px]">
                          {(['csv', 'json', 'parquet'] as const).map((fmt) => (
                            <button
                              key={fmt}
                              onClick={() => setActiveTabFormat(fmt)}
                              className={`px-2 py-0.5 rounded font-mono uppercase ${
                                activeTabFormat === fmt
                                  ? 'bg-zinc-800 text-zinc-100 font-semibold'
                                  : 'text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              {fmt}
                            </button>
                          ))}
                        </div>
                      </div>

                      {activeTabFormat === 'csv' && (
                        <div className="p-3 rounded bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-zinc-300">
                          <span className="text-zinc-500"># DuckDB CSV Auto-detect with header deduction:</span>
                          <br />
                          rel = con.read_csv(raw_s3_uri, header=True, auto_detect=True, delimiter=&apos;,&apos;)
                        </div>
                      )}
                      {activeTabFormat === 'json' && (
                        <div className="p-3 rounded bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-zinc-300">
                          <span className="text-zinc-500"># DuckDB JSON / NDJSON parsing with schema deduction:</span>
                          <br />
                          rel = con.read_json(raw_s3_uri)
                        </div>
                      )}
                      {activeTabFormat === 'parquet' && (
                        <div className="p-3 rounded bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-zinc-300">
                          <span className="text-zinc-500"># Direct zero-copy Arrow/Parquet stream:</span>
                          <br />
                          rel = con.read_parquet(raw_s3_uri)
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center justify-center font-bold">
                          5
                        </span>
                        DuckLake Atomic Parquet Commit
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-500">ACID Open Table</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      The cleaned DuckDB relation is committed via <code className="text-emerald-300">DuckLakeCommitter</code>{' '}
                      under an exclusive async write lock. DuckLake carries out atomic table writes:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded bg-zinc-900 border border-zinc-800">
                        <div className="font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px] text-emerald-400">table_rows</span>
                          Storage Target (Parquet)
                        </div>
                        <p className="text-zinc-400 text-[11px]">
                          Data is written into snappy-compressed Parquet files under the tenant&apos;s tables directory:
                        </p>
                        <code className="block mt-1 text-[10px] text-emerald-300 font-mono">
                          tenants/{tenantId}/tables/&#123;table_name&#125;/*.parquet
                        </code>
                      </div>
                      <div className="p-3 rounded bg-zinc-900 border border-zinc-800">
                        <div className="font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px] text-indigo-400">history_edu</span>
                          Catalog Target (PostgreSQL)
                        </div>
                        <p className="text-zinc-400 text-[11px]">
                          Metadata, schemas, snapshots, and file manifests are recorded inside PostgreSQL schema:
                        </p>
                        <code className="block mt-1 text-[10px] text-indigo-300 font-mono">
                          ducklake_catalog.tables / manifests
                        </code>
                      </div>
                    </div>
                  </div>

                  {/* Step 6 */}
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-400 text-xs font-mono flex items-center justify-center font-bold">
                          6
                        </span>
                        Live DuckDB Silver View Registration
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-500">Query Accessibility</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Immediately upon commit completion, the engine registers a queryable view inside
                      the DuckDB session under the tenant-isolated schema:
                    </p>
                    <div className="p-3 rounded bg-zinc-950 border border-zinc-800/80 font-mono text-xs text-teal-300 flex items-center justify-between">
                      <code>CREATE OR REPLACE VIEW {tenantId}_silver.&#123;table_name&#125; AS SELECT * FROM lakehouse_cat.{tenantId}_silver.&#123;table_name&#125;;</code>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            'sql-view-create',
                            `SELECT * FROM ${tenantId}_silver.orders LIMIT 10;`
                          )
                        }
                        className="text-zinc-500 hover:text-zinc-300 ml-2"
                        title="Copy sample SQL"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copiedKey === 'sql-view-create' ? 'check' : 'content_copy'}
                        </span>
                      </button>
                    </div>
                    <p className="text-xs text-zinc-400">
                      A legacy compatibility view (<code className="text-zinc-300">{tenantId}_&#123;table_name&#125;</code>)
                      is also registered, and the Payload dataset document transitions to{' '}
                      <code className="text-emerald-400">completed</code> with duration and row count metrics.
                    </p>
                  </div>
                </div>

                {/* CALLOUT ACTION BOX */}
                <div className="p-4 rounded-lg bg-indigo-950/30 border border-indigo-800/50 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-indigo-200 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-indigo-400">tips_and_updates</span>
                      Ready to turn your files into Silver tables?
                    </div>
                    <div className="text-[11px] text-indigo-300/80">
                      Upload a CSV, Parquet, or JSON file to let the automated pipeline sanitize and commit your table.
                    </div>
                  </div>
                  <button
                    onClick={() => onNavigateToUpload?.()}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shrink-0 transition-colors shadow-sm"
                  >
                    Open Ingestion Uploader
                  </button>
                </div>
              </div>
            )}

            {/* SECTION 2: MEDALLION ARCHITECTURE */}
            {activeSectionId === 'medallion' && (
              <div className="space-y-8 animate-fadeIn">
                <div className="border-b border-app-border pb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Architecture
                    </span>
                    <span className="text-zinc-500 text-xs">·</span>
                    <span className="text-zinc-400 text-xs font-mono">Bronze · Silver · Gold</span>
                  </div>
                  <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                    The Medallion Architecture in Local Lakehouse
                  </h1>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                    Local Lakehouse implements the battle-tested Medallion architecture pattern, providing
                    structured stages for raw data refinement, transactional consistency, and analytical marts.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Bronze */}
                  <div className="p-5 rounded-lg bg-app-surface border border-amber-900/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                        Bronze Layer
                      </span>
                      <span className="material-symbols-outlined text-amber-400 text-[18px]">inventory_2</span>
                    </div>
                    <div className="text-sm font-semibold text-zinc-200">Raw File Landing</div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Unaltered, immutable landing zone. Preserves original source data exactly as uploaded.
                    </p>
                    <div className="space-y-1 pt-2 border-t border-zinc-800 text-[11px] font-mono">
                      <div className="text-zinc-500">Storage Prefix:</div>
                      <code className="text-amber-300/90 text-[10px]">tenants/{tenantId}/raw/</code>
                      <div className="text-zinc-500 mt-2">Format:</div>
                      <div className="text-zinc-300">Original CSV, JSON, Parquet</div>
                    </div>
                  </div>

                  {/* Silver */}
                  <div className="p-5 rounded-lg bg-app-surface border border-slate-700/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-slate-500/10 text-slate-300 border border-slate-500/30 font-semibold">
                        Silver Layer
                      </span>
                      <span className="material-symbols-outlined text-slate-300 text-[18px]">table_chart</span>
                    </div>
                    <div className="text-sm font-semibold text-zinc-200">Cleaned & Typed Tables</div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Structured, typed, and normalized tables with schema evolution and atomic commits via DuckLake.
                    </p>
                    <div className="space-y-1 pt-2 border-t border-zinc-800 text-[11px] font-mono">
                      <div className="text-zinc-500">Storage Prefix:</div>
                      <code className="text-slate-300 text-[10px]">tenants/{tenantId}/tables/</code>
                      <div className="text-zinc-500 mt-2">DuckDB Schema:</div>
                      <div className="text-indigo-400">{tenantId}_silver.*</div>
                    </div>
                  </div>

                  {/* Gold */}
                  <div className="p-5 rounded-lg bg-app-surface border border-yellow-900/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 font-semibold">
                        Gold Layer
                      </span>
                      <span className="material-symbols-outlined text-yellow-400 text-[18px]">insights</span>
                    </div>
                    <div className="text-sm font-semibold text-zinc-200">Curated Views & Marts</div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Aggregated analytics, metrics, and business views. Supports zero-storage virtual SQL views or materialized Parquet tables.
                    </p>
                    <div className="space-y-1 pt-2 border-t border-zinc-800 text-[11px] font-mono">
                      <div className="text-zinc-500">Virtual Views:</div>
                      <div className="text-sky-300">0 KB Parquet overhead</div>
                      <div className="text-zinc-500 mt-2">DuckDB Schema:</div>
                      <div className="text-yellow-400">{tenantId}_gold.*</div>
                    </div>
                  </div>
                </div>

                {/* COMPARISON TABLE */}
                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                    Layer Characteristics Matrix
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-500 font-mono text-[11px]">
                          <th className="py-2 pr-4">Attribute</th>
                          <th className="py-2 pr-4 text-amber-400">Bronze (Raw)</th>
                          <th className="py-2 pr-4 text-slate-300">Silver (Tables)</th>
                          <th className="py-2 text-yellow-400">Gold (Views & Marts)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-sans text-zinc-300">
                        <tr>
                          <td className="py-2.5 font-medium text-zinc-400 font-mono text-[11px]">Data State</td>
                          <td>Raw, unvalidated, as-is</td>
                          <td>Cleaned, coerced, normalized</td>
                          <td>Aggregated, modeled metrics</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-zinc-400 font-mono text-[11px]">Format</td>
                          <td>Original (CSV, JSON, Parquet)</td>
                          <td>DuckLake Snappy Parquet</td>
                          <td>Virtual SQL Views or Parquet</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-zinc-400 font-mono text-[11px]">ACID Commits</td>
                          <td>No (Object store files)</td>
                          <td>Yes (DuckLake PostgreSQL Catalog)</td>
                          <td>Yes (Snapshot / View definition)</td>
                        </tr>
                        <tr>
                          <td className="py-2.5 font-medium text-zinc-400 font-mono text-[11px]">Direct Query</td>
                          <td>Via <code className="text-zinc-400">read_csv()</code></td>
                          <td>Via <code className="text-indigo-300">{tenantId}_silver.table</code></td>
                          <td>Via <code className="text-yellow-300">{tenantId}_gold.view</code></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: STORAGE & MULTI-TENANCY */}
            {activeSectionId === 'storage-isolation' && (
              <div className="space-y-8 animate-fadeIn">
                <div className="border-b border-app-border pb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      Security & Storage
                    </span>
                    <span className="text-zinc-500 text-xs">·</span>
                    <span className="text-zinc-400 text-xs font-mono">S3 Layout · STS · Schema Guardrails</span>
                  </div>
                  <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                    Multi-Tenant Storage Layout & Isolation Model
                  </h1>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                    Local Lakehouse isolates customer workloads through physical S3 key prefixes, temporary
                    STS assume-role credentials, and strict DuckDB SQL query inspection.
                  </p>
                </div>

                {/* POC DESIGN CHOICE NOTE */}
                <div className="p-4 rounded-lg bg-teal-950/20 border border-teal-800/40 space-y-2 text-xs">
                  <div className="font-semibold text-teal-300 flex items-center gap-1.5 font-mono">
                    <span className="material-symbols-outlined text-[16px] text-teal-400">tune</span>
                    POC Architecture: Caller-Supplied Tenant Scope
                  </div>
                  <p className="text-zinc-400 leading-relaxed">
                    Local Lakehouse MVP 1 is designed for small teams of trusted users running a self-hosted instance.
                    For an initial Proof of Concept (POC), authentication is one more heavyweight system to configure,
                    maintain, and troubleshoot. We decided it was not worth the setup friction for an evaluation.
                    Instead, <code className="text-teal-300">tenant_id</code> is a caller-supplied value passed via API
                    or selected in the workspace switcher, while STS credential scoping, S3 path prefixes, and DuckDB
                    schema namespaces enforce genuine multi-tenant separation.
                  </p>
                </div>

                {/* S3 TREE STRUCTURE */}
                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
                    <span className="material-symbols-outlined text-teal-400 text-[16px]">folder_open</span>
                    RustFS S3 Bucket Layout
                  </h3>
                  <pre className="p-4 rounded bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed">
{`s3://lakehouse-bucket/
└── tenants/
    ├── tenant_acme/
    │   ├── raw/                           # Bronze: Raw uploads (timestamped)
    │   │   ├── 1718000000_customers.csv
    │   │   └── 1718000042_orders.parquet
    │   ├── tables/                        # Silver: DuckLake Parquet tables
    │   │   ├── customers/
    │   │   │   ├── data_0001.parquet
    │   │   │   └── data_0002.parquet
    │   │   └── orders/
    │   │       └── data_0001.parquet
    │   └── gold/                          # Gold: Materialized tables
    │       └── monthly_revenue/
    │           └── data_0001.parquet
    └── tenant_beta/
        ├── raw/
        └── tables/`}
                  </pre>
                </div>

                {/* SECURITY MECHANISMS */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-2">
                    <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 font-mono">
                      <span className="material-symbols-outlined text-teal-400 text-[16px]">vpn_key</span>
                      STS Credential Scoping
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Uploads do not use master S3 keys. The server generates ephemeral STS tokens restricted by policy:
                    </p>
                    <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-300">
                      Resource: &quot;arn:aws:s3:::lakehouse-bucket/tenants/&#123;tenantId&#125;/*&quot;
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-2">
                    <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 font-mono">
                      <span className="material-symbols-outlined text-indigo-400 text-[16px]">gavel</span>
                      Query AST Inspection & Schema Sandbox
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      All queries run through <code className="text-zinc-200">query-service.ts</code>. Queries attempting to
                      access other tenant schemas (<code className="text-rose-300">tenant_other_*</code>) or system tables
                      are intercepted and rejected before execution.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 4: DUCKLAKE CATALOG */}
            {activeSectionId === 'ducklake-catalog' && (
              <div className="space-y-8 animate-fadeIn">
                <div className="border-b border-app-border pb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Engine Deep Dive
                    </span>
                    <span className="text-zinc-500 text-xs">·</span>
                    <span className="text-zinc-400 text-xs font-mono">DuckDB · DuckLake · PostgreSQL</span>
                  </div>
                  <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                    DuckLake Catalog & Analytical Engine
                  </h1>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                    Why DuckLake? Local Lakehouse combines the blazing vectorization of DuckDB with open
                    table transactional semantics without requiring heavy distributed engines like Apache Spark.
                  </p>
                </div>

                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                    PostgreSQL Catalog Schema Architecture
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    DuckLake manages transactions and snapshots using a light PostgreSQL schema:
                  </p>
                  <pre className="p-4 rounded bg-zinc-950 border border-zinc-800 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
{`-- DuckLake v1.0 Catalog Attach Syntax
ATTACH 'ducklake:postgres:postgresql://user:pass@postgres:5432/lakehouse'
AS lakehouse_cat (
    DATA_PATH 's3://lakehouse-bucket/',
    METADATA_SCHEMA 'ducklake_catalog'
);`}
                  </pre>
                  <div className="text-xs text-zinc-400 leading-relaxed">
                    When you query <code className="text-indigo-300">{tenantId}_silver.orders</code>, DuckDB references
                    the manifest registered inside <code className="text-zinc-200">ducklake_catalog</code> and reads only
                    the necessary Parquet row groups directly from RustFS with columnar predicate pushdown.
                  </div>
                </div>

                {/* TRANSACTION WRITE LOCKS */}
                <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-2">
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 font-mono">
                    <span className="material-symbols-outlined text-amber-400 text-[16px]">lock</span>
                    Concurrency & Async Write-Locks
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    DuckDB maintains high-concurrency read operations while write/DDL operations (such as table commits
                    and gold view creation) acquire an asynchronous write lock (<code className="text-zinc-200">_write_lock</code>)
                    in the Python worker. This prevents catalog race conditions and ensures linearizable snapshot commits.
                  </p>
                </div>
              </div>
            )}

            {/* SECTION 5: API REFERENCE */}
            {activeSectionId === 'api-reference' && (
              <div className="space-y-8 animate-fadeIn">
                <div className="border-b border-app-border pb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Developer Reference
                    </span>
                    <span className="text-zinc-500 text-xs">·</span>
                    <span className="text-zinc-400 text-xs font-mono">REST Endpoints · cURL</span>
                  </div>
                  <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                    REST API & Integration Reference
                  </h1>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                    All lakehouse capabilities are exposed via clean HTTP endpoints on the Control Plane and Worker.
                  </p>
                </div>

                {/* ENDPOINT 1: UPLOAD & INGEST */}
                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono text-xs font-bold">
                        POST
                      </span>
                      <code className="text-xs font-mono text-zinc-200">/api/pipeline/ingest</code>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-500">Multipart / Form-Data</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Uploads a file to RustFS S3, creates a Dataset record in Payload CMS, and enqueues the ingest task.
                  </p>

                  <div className="relative">
                    <pre className="p-3 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto">
{`curl -X POST http://localhost:3000/api/pipeline/ingest \\
  -F "tenant_id=${tenantId}" \\
  -F "table_name=sales_q3" \\
  -F "file=@./data/sales.csv"`}
                    </pre>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          'curl-ingest',
                          `curl -X POST http://localhost:3000/api/pipeline/ingest -F "tenant_id=${tenantId}" -F "table_name=sales_q3" -F "file=@./data/sales.csv"`
                        )
                      }
                      className="absolute top-2.5 right-2.5 p-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                      title="Copy curl"
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {copiedKey === 'curl-ingest' ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* ENDPOINT 2: QUERY */}
                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono text-xs font-bold">
                        POST
                      </span>
                      <code className="text-xs font-mono text-zinc-200">/api/query</code>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-500">JSON</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Executes an analytical SQL query against DuckDB within the tenant&apos;s schema boundary.
                  </p>

                  <div className="relative">
                    <pre className="p-3 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto">
{`curl -X POST http://localhost:3000/api/query \\
  -H "Content-Type: application/json" \\
  -d '{
    "tenant_id": "${tenantId}",
    "query": "SELECT * FROM ${tenantId}_silver.sales_q3 LIMIT 10;"
  }'`}
                    </pre>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          'curl-query',
                          `curl -X POST http://localhost:3000/api/query -H "Content-Type: application/json" -d '{"tenant_id": "${tenantId}", "query": "SELECT * FROM ${tenantId}_silver.sales_q3 LIMIT 10;"}'`
                        )
                      }
                      className="absolute top-2.5 right-2.5 p-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                      title="Copy curl"
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {copiedKey === 'curl-query' ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* ENDPOINT 3: GOLD VIEW CREATION */}
                <div className="p-5 rounded-lg bg-app-surface border border-app-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono text-xs font-bold">
                        POST
                      </span>
                      <code className="text-xs font-mono text-zinc-200">/api/gold</code>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-500">JSON</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Saves a query as a zero-storage Gold virtual view or materializes it as a dedicated Parquet table.
                  </p>

                  <div className="relative">
                    <pre className="p-3 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto">
{`curl -X POST http://localhost:3000/api/gold \\
  -H "Content-Type: application/json" \\
  -d '{
    "tenant_id": "${tenantId}",
    "name": "daily_summary",
    "query": "SELECT order_date, COUNT(*) as orders FROM ${tenantId}_silver.orders GROUP BY 1",
    "action": "view"
  }'`}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 6: QUICKSTART & OPS */}
            {activeSectionId === 'quickstart-ops' && (
              <div className="space-y-8 animate-fadeIn">
                <div className="border-b border-app-border pb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      Operations
                    </span>
                    <span className="text-zinc-500 text-xs">·</span>
                    <span className="text-zinc-400 text-xs font-mono">Docker · Health · Reset</span>
                  </div>
                  <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                    Quickstart & Operations Guide
                  </h1>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                    Deploy and manage your self-hosted Local Lakehouse stack in minutes.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                      Docker Compose Startup
                    </h3>
                    <pre className="p-3 rounded bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300">
{`# 1. Clone repository
git clone https://github.com/Teelon/Local-Lakehouse.git
cd Local-Lakehouse

# 2. Boot containers
docker compose up -d --build

# 3. Check status
docker compose ps`}
                    </pre>
                  </div>

                  <div className="p-4 rounded-lg bg-app-surface border border-app-border space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                      Default Ports & Web Consoles
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">Web Studio</div>
                        <div className="text-zinc-200 font-bold">:3000</div>
                      </div>
                      <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">Payload Admin</div>
                        <div className="text-zinc-200 font-bold">:3000/admin</div>
                      </div>
                      <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">FastAPI Worker</div>
                        <div className="text-zinc-200 font-bold">:8000</div>
                      </div>
                      <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">RustFS S3 Console</div>
                        <div className="text-zinc-200 font-bold">:9001</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
