'use client'

import React, { useState, useEffect } from 'react'
import { SchemaMatchResult, ColumnSchema } from '../utils/table-schema-matcher'

interface TableSuggestionModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectAndIngest: (tableName: string) => void
  onApplyNameOnly: (tableName: string) => void
  filename: string
  fileSize: number
  fileFormat: string
  estimatedRows?: number | null
  inferredColumns: ColumnSchema[]
  schemaMatches: SchemaMatchResult[]
  suggestedNames: string[]
  tenantId: string
  initialTableName?: string
  isUploading?: boolean
}

export default function TableSuggestionModal({
  isOpen,
  onClose,
  onSelectAndIngest,
  onApplyNameOnly,
  filename,
  fileSize,
  fileFormat,
  estimatedRows,
  inferredColumns,
  schemaMatches,
  suggestedNames,
  tenantId,
  initialTableName = '',
  isUploading = false,
}: TableSuggestionModalProps) {
  const [selectedName, setSelectedName] = useState('')
  const [activeTab, setActiveTab] = useState<'match' | 'suggest'>('match')
  const [expandedTableDetails, setExpandedTableDetails] = useState<Record<string, boolean>>({})
  const [validationError, setValidationError] = useState<string | null>(null)

  // Initialize selected name whenever modal opens or suggestions change
  useEffect(() => {
    if (isOpen) {
      if (initialTableName && initialTableName.trim() && initialTableName !== 'dataset') {
        setSelectedName(initialTableName.trim())
      } else if (schemaMatches.length > 0 && schemaMatches[0].matchScore >= 70) {
        setSelectedName(schemaMatches[0].table.name)
        setActiveTab('match')
      } else if (suggestedNames.length > 0) {
        setSelectedName(suggestedNames[0])
        setActiveTab('suggest')
      } else {
        setSelectedName('')
      }
      setValidationError(null)
    }
  }, [isOpen, initialTableName, schemaMatches, suggestedNames])

  if (!isOpen) return null

  const handleCleanInput = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    setSelectedName(cleaned)
    if (cleaned.trim()) {
      setValidationError(null)
    }
  }

  const validateAndProceed = (action: 'ingest' | 'apply') => {
    const clean = selectedName.trim().replace(/^_+|_+$/g, '')
    if (!clean || clean === 'dataset') {
      setValidationError('Please specify or select a valid table name before proceeding.')
      return
    }

    if (clean.length < 2) {
      setValidationError('Table name must be at least 2 characters long.')
      return
    }

    if (action === 'ingest') {
      onSelectAndIngest(clean)
    } else {
      onApplyNameOnly(clean)
    }
  }

  const toggleDetails = (tableName: string) => {
    setExpandedTableDetails((prev) => ({
      ...prev,
      [tableName]: !prev[tableName],
    }))
  }

  const hasHighConfidenceMatch = schemaMatches.length > 0 && schemaMatches[0].matchScore >= 50

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6 flex flex-col gap-5 text-xs font-mono my-auto max-h-[92vh] overflow-y-auto">
        {/* MODAL HEADER */}
        <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 font-sans flex items-center gap-2">
                Resolve Target Table
                {hasHighConfidenceMatch && (
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-400">
                    Schema Match Found
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
                Inspect columns and assign a destination table before ingesting into Local Lakehouse.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* STAGED FILE METRICS BANNER */}
        <div className="p-3 bg-zinc-950/70 border border-zinc-800/80 rounded-lg flex flex-wrap items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center gap-2 text-zinc-300 truncate max-w-md">
            <span className="material-symbols-outlined text-[16px] text-zinc-400">description</span>
            <span className="font-semibold text-zinc-100 truncate">{filename}</span>
            <span className="text-zinc-600">•</span>
            <span className="text-zinc-400">{(fileSize / 1024 / 1024).toFixed(2)} MB</span>
            <span className="text-zinc-600">•</span>
            <span className="uppercase text-indigo-400 font-semibold">{fileFormat}</span>
          </div>
          <div className="flex items-center gap-3 text-zinc-400">
            {estimatedRows && (
              <span>~{estimatedRows.toLocaleString()} rows</span>
            )}
            <span className="text-zinc-600">•</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">view_column</span>
              {inferredColumns.length} columns detected
            </span>
          </div>
        </div>

        {/* TAB CONTROLS (Matched Existing Tables vs Smart Suggestions) */}
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
          {schemaMatches.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('match')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-sans text-xs transition-colors ${
                activeTab === 'match'
                  ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <span className="material-symbols-outlined text-[14px] text-emerald-400">compare_arrows</span>
              <span>Matching Tables ({schemaMatches.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('suggest')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-sans text-xs transition-colors ${
              activeTab === 'suggest' || schemaMatches.length === 0
                ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <span className="material-symbols-outlined text-[14px] text-indigo-400">lightbulb</span>
            <span>Suggested Names ({suggestedNames.length})</span>
          </button>
        </div>

        {/* CONTENT FOR TAB 1: MATCHING TABLES */}
        {(activeTab === 'match' || schemaMatches.length === 0) && schemaMatches.length > 0 && (
          <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
            <div className="text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Existing tables in tenant matching inferred schema:</span>
              <span className="text-zinc-500">Click a card to select</span>
            </div>

            {schemaMatches.map((match) => {
              const isSelected = selectedName === match.table.name
              const isExpanded = !!expandedTableDetails[match.table.name]
              const isExact = match.matchScore >= 90

              return (
                <div
                  key={match.table.name}
                  onClick={() => setSelectedName(match.table.name)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col gap-2 ${
                    isSelected
                      ? 'bg-indigo-950/30 border-indigo-500/70 ring-1 ring-indigo-500/40'
                      : 'bg-zinc-950/40 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="material-symbols-outlined text-[16px] text-zinc-400">table_chart</span>
                      <span className="font-semibold text-zinc-100">{match.table.name}</span>
                      <span className="text-[10px] text-zinc-500">
                        ({tenantId}_silver.{match.table.name})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          isExact
                            ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                            : match.matchScore >= 60
                            ? 'bg-teal-950/70 border border-teal-800 text-teal-300'
                            : 'bg-amber-950/70 border border-amber-800 text-amber-300'
                        }`}
                      >
                        {match.matchScore}% Match
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleDetails(match.table.name)
                        }}
                        className="text-zinc-500 hover:text-zinc-300 text-[11px] flex items-center gap-0.5 ml-1"
                      >
                        <span>{isExpanded ? 'Hide' : 'Cols'}</span>
                        <span className="material-symbols-outlined text-[13px]">
                          {isExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                    <span>
                      {match.exactTypeMatches} / {match.totalInferredColumns} columns exact match (
                      {match.compatibleTypeMatches > 0 && `+${match.compatibleTypeMatches} compatible, `}
                      {match.totalExistingColumns} total in table)
                    </span>
                    {isSelected && (
                      <span className="text-indigo-400 font-semibold flex items-center gap-1 text-[11px]">
                        <span className="material-symbols-outlined text-[13px]">check</span>
                        Selected Target
                      </span>
                    )}
                  </div>

                  {/* Expanded Columns Breakdown */}
                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-zinc-800/80 flex flex-wrap gap-1.5">
                      {match.matchedColumns.map((col) => (
                        <span
                          key={col.inferredName}
                          className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-[10px] text-zinc-300 flex items-center gap-1"
                          title={`Type: ${col.inferredType} -> ${col.matchedExistingType}`}
                        >
                          <span
                            className={`material-symbols-outlined text-[11px] ${
                              col.exactTypeMatch ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {col.exactTypeMatch ? 'check_circle' : 'change_circle'}
                          </span>
                          <span>{col.inferredName}</span>
                          <span className="text-zinc-500 font-sans text-[9px]">{col.inferredType}</span>
                        </span>
                      ))}

                      {match.unmatchedInferredColumns.map((uCol) => (
                        <span
                          key={uCol}
                          className="px-2 py-0.5 rounded bg-amber-950/30 border border-amber-800/40 text-[10px] text-amber-300/80 flex items-center gap-1"
                          title="Column in file but not in existing table (will be appended/unioned)"
                        >
                          <span className="material-symbols-outlined text-[11px] text-amber-400">add</span>
                          <span>{uCol}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* CONTENT FOR TAB 2: SMART SUGGESTIONS */}
        {(activeTab === 'suggest' || schemaMatches.length === 0) && (
          <div className="flex flex-col gap-2.5">
            <div className="text-[11px] text-zinc-400">
              Smart table names recommended based on column semantics, identifiers, and file metadata:
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedNames.map((name, idx) => {
                const isSelected = selectedName === name
                const isRec = idx === 0

                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedName(name)}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200 font-semibold ring-1 ring-indigo-500/50'
                        : 'bg-zinc-950/50 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/60'
                    }`}
                  >
                    {isRec ? (
                      <span className="material-symbols-outlined text-[13px] text-indigo-400">star</span>
                    ) : (
                      <span className="material-symbols-outlined text-[13px] text-zinc-500">tag</span>
                    )}
                    <span>{name}</span>
                    {isRec && (
                      <span className="text-[9px] uppercase px-1 rounded bg-indigo-500/20 text-indigo-300 font-normal">
                        Recommended
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* TARGET TABLE INPUT & PATH PREVIEW */}
        <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
          <div className="flex items-baseline justify-between">
            <label className="text-zinc-200 font-sans text-xs font-semibold">
              Confirmed Target Table Name
            </label>
            <span className="text-[11px] text-zinc-500 font-mono">
              Destination: {tenantId}_silver.{selectedName || '...'}
            </span>
          </div>

          <div className="flex items-center rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 focus-within:border-zinc-500 transition-colors">
            <span className="text-zinc-500 font-mono mr-1 select-none">{tenantId}_silver.</span>
            <input
              type="text"
              value={selectedName}
              onChange={(e) => handleCleanInput(e.target.value)}
              placeholder="e.g. students"
              className="bg-transparent text-zinc-100 text-xs focus:outline-none flex-1 font-mono placeholder:text-zinc-600"
              autoFocus
            />
            {selectedName && (
              <button
                type="button"
                onClick={() => setSelectedName('')}
                className="text-zinc-500 hover:text-zinc-300 ml-1"
              >
                <span className="material-symbols-outlined text-[14px]">cancel</span>
              </button>
            )}
          </div>

          {validationError ? (
            <div className="text-rose-400 text-[11px] flex items-center gap-1 mt-0.5">
              <span className="material-symbols-outlined text-[13px]">error</span>
              <span>{validationError}</span>
            </div>
          ) : (
            <div className="text-zinc-500 text-[10px] flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">info</span>
              <span>Table will be created or appended under the Silver Medallion layer in Local Lakehouse.</span>
            </div>
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800 mt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="px-3.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 font-sans text-xs transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => validateAndProceed('apply')}
              disabled={isUploading || !selectedName.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-sans text-xs font-medium transition-colors border border-zinc-700/60 disabled:opacity-40"
            >
              Apply to Form
            </button>

            <button
              type="button"
              onClick={() => validateAndProceed('ingest')}
              disabled={isUploading || !selectedName.trim()}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-semibold shadow-md shadow-indigo-900/30 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <span className="material-symbols-outlined text-[15px] animate-spin">
                    progress_activity
                  </span>
                  <span>Ingesting...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[15px]">cloud_upload</span>
                  <span>Confirm & Ingest</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
