'use client'

import React, { useMemo } from 'react'
import CodeMirror, { Extension } from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { sql } from '@codemirror/lang-sql'
import { sqlExtension } from '@marimo-team/codemirror-sql'
import { DuckDBDialect } from '@marimo-team/codemirror-sql/dialects'
import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

interface ColumnSchema {
  name: string
  type: string
}

interface TableMetadata {
  name: string
  full_name: string
  columns: ColumnSchema[]
}

interface SqlEditorProps {
  value: string
  onChange: (val: string) => void
  tables: TableMetadata[]
  onRun?: () => void
}

// Sleek dark theme matching our #0d0d11 surface palette
const lakehouseDarkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#0d0d11',
      color: '#f4f4f5',
      fontSize: '12px',
      fontFamily: "'JetBrains Mono', monospace",
      height: '100%',
      minHeight: '60px',
    },
    '.cm-content': {
      caretColor: '#ffffff',
      lineHeight: '1.65',
      padding: '12px 14px',
    },
    '.cm-gutters': {
      backgroundColor: '#0d0d11',
      color: '#52525b',
      borderRight: '1px solid #222227',
      paddingRight: '6px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px',
      color: '#52525b',
    },
    '.cm-activeLine': {
      backgroundColor: '#18181c50',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#18181c70',
      color: '#a1a1aa',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: '#27272a80 !important',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#ffffff',
    },
    '.cm-tooltip': {
      backgroundColor: '#18181c',
      border: '1px solid #27272a',
      color: '#f4f4f5',
      borderRadius: '6px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: '#27272a',
        color: '#ffffff',
      },
    },
    '.cm-diagnostic': {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      padding: '4px 8px',
    },
    '.cm-diagnostic-error': {
      borderLeft: '3px solid #f43f5e',
    },
    '.cm-diagnostic-warning': {
      borderLeft: '3px solid #fbbf24',
    },
    '.cm-lint-marker': {
      width: '8px',
      height: '8px',
    },
  },
  { dark: true }
)

// Premium syntax highlighting palette tailored for DuckDB SQL
const lakehouseSyntaxHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: '#93c5fd', fontWeight: '600' }, // vibrant sky blue for SELECT, FROM, WHERE, GROUP BY
    { tag: t.string, color: '#34d399' },                     // emerald green for 'strings'
    { tag: t.number, color: '#fbbf24' },                     // amber for numbers
    { tag: t.function(t.variableName), color: '#38bdf8' },   // cyan for functions (count, sum, avg)
    { tag: t.typeName, color: '#c084fc' },                   // purple for types (VARCHAR, BIGINT)
    { tag: t.comment, color: '#71717a', fontStyle: 'italic' }, // muted gray for comments
    { tag: t.operator, color: '#a78bfa' },                   // violet for =, !=, >, <
    { tag: t.punctuation, color: '#a1a1aa' },                // subtle zinc for commas, parens
    { tag: t.variableName, color: '#f4f4f5' },               // crisp white for columns & identifiers
  ])
)

export default function SqlEditor({ value, onChange, tables, onRun }: SqlEditorProps) {
  // Convert tables to schema map for @marimo-team/codemirror-sql and @codemirror/lang-sql
  const schema = useMemo(() => {
    const s: Record<string, string[]> = {}
    if (tables && Array.isArray(tables)) {
      for (const t of tables) {
        const colNames = (t.columns || []).map((c) => c.name)
        if (t.name) s[t.name] = colNames
        if (t.full_name) s[t.full_name] = colNames
      }
    }
    return s
  }, [tables])

  // Configure CodeMirror extensions: DuckDB dialect + schema-aware semantic linter + hover tooltips + keymaps
  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      lakehouseDarkTheme,
      lakehouseSyntaxHighlighting,
      sql({
        dialect: DuckDBDialect,
        schema,
      }),
      ...sqlExtension({
        schema,
        enableLinting: true,
        enableSemanticLinting: true,
        enableHover: true,
        enableGutterMarkers: true,
      }),
    ]

    if (onRun) {
      exts.push(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRun()
              return true
            },
          },
        ])
      )
    }

    return exts
  }, [schema, onRun])

  return (
    <div className="w-full h-full overflow-hidden bg-app-surface border-t border-app-border">
      <CodeMirror
        value={value}
        height="100%"
        minHeight="60px"
        theme="dark"
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          foldGutter: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
      />
    </div>
  )
}
