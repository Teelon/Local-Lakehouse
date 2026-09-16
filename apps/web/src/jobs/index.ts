import { tasks } from './tasks'

export * from './tasks'

export const jobsConfig = {
  tasks,
  autoRun: [
    {
      cron: '* * * * *',
      queue: 'default',
    },
  ],
}
