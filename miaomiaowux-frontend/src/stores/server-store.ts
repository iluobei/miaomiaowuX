import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ServerType = 'remote'

interface ServerState {
  selectedRemoteServerId: number | null
  serverType: ServerType
  setSelectedServer: (id: number | null) => void
}

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      selectedRemoteServerId: null,
      serverType: 'remote',
      setSelectedServer: (id) => set(() => ({
        serverType: 'remote',
        selectedRemoteServerId: id,
      })),
    }),
    {
      name: 'server-storage',
      version: 2,
      migrate: (persisted: any) => ({
        selectedRemoteServerId: persisted?.selectedRemoteServerId ?? null,
        serverType: 'remote' as const,
      }),
    }
  )
)
