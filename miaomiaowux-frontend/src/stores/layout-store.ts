import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type LayoutMode = 'top' | 'sidebar'

interface LayoutState {
  layoutMode: LayoutMode
  sidebarCollapsed: boolean
  setLayoutMode: (mode: LayoutMode) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      layoutMode: 'top',
      sidebarCollapsed: false,
      setLayoutMode: (mode) => set({ layoutMode: mode }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'layout-storage',
    }
  )
)
