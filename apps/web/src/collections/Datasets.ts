import type { CollectionConfig } from 'payload'
import { datasetsAccess } from '../access/datasets'
import { datasetAfterChangeHook } from './hooks/dataset-after-change'

export const Datasets: CollectionConfig = {
  slug: 'datasets',
  admin: {
    useAsTitle: 'name',
  },
  access: datasetsAccess,
  hooks: {
    afterChange: [datasetAfterChangeHook],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'tenant',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
    },
    {
      name: 'layer',
      type: 'select',
      options: [
        { label: 'Bronze', value: 'bronze' },
        { label: 'Silver', value: 'silver' },
        { label: 'Gold', value: 'gold' },
      ],
      defaultValue: 'silver',
    },
    {
      name: 'objectType',
      type: 'select',
      options: [
        { label: 'Table', value: 'table' },
        { label: 'View', value: 'view' },
      ],
      defaultValue: 'table',
    },
    {
      name: 'sqlQuery',
      type: 'textarea',
      admin: {
        description: 'Definition query for Gold views or materialized tables',
      },
    },
    {
      name: 'dependencies',
      type: 'json',
      admin: {
        description: 'List of dataset IDs or table names this view depends on',
      },
    },
    {
      name: 'rawFilePath',
      type: 'text',
    },
    {
      name: 'format',
      type: 'select',
      options: ['csv', 'json', 'parquet', 'sql_view'],
      defaultValue: 'csv',
    },
    {
      name: 'status',
      type: 'select',
      options: ['pending', 'uploaded', 'processing', 'completed', 'failed'],
      defaultValue: 'pending',
    },
    {
      name: 'ducklakeTable',
      type: 'text',
    },
    {
      name: 'rowCount',
      type: 'number',
    },
    {
      name: 'errorMessage',
      type: 'textarea',
    },
    {
      name: 'jobId',
      type: 'text',
    },
    {
      name: 'durationMs',
      type: 'number',
    },
  ],
}
