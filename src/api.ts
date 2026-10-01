import axios from 'axios'
import { currentSnapshot, devices, routes, seedCases, seedChanges, seedExecutions } from './mock'

export const stationApi = axios.create({
  baseURL: '/api',
  adapter: async (config) => ({
    data: config.url === '/station'
      ? { devices, routes, cases: seedCases, executions: seedExecutions, changes: seedChanges, snapshot: currentSnapshot, version: currentSnapshot.software }
      : {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }),
})

export async function fetchStation() {
  const { data } = await stationApi.get('/station')
  return data
}
