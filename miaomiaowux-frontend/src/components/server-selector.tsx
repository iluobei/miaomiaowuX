import { useQuery } from '@tanstack/react-query'
import { Cloud, ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { useServerStore } from '@/stores/server-store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface RemoteServer {
  id: number
  name: string
  status: 'pending' | 'connected' | 'offline'
  ip_address?: string
}

interface ServerSelectorProps {
  className?: string
}

export function ServerSelector({ className }: ServerSelectorProps) {
  const { selectedRemoteServerId, setSelectedServer } = useServerStore()

  const { data: remoteServersData } = useQuery({
    queryKey: ['remote-servers'],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      return response.data as { success: boolean; servers: RemoteServer[] }
    },
    staleTime: 30 * 1000,
  })

  const remoteServers = remoteServersData?.servers || []

  const getSelectedName = () => {
    const server = remoteServers.find(s => s.id === selectedRemoteServerId)
    return server?.name || '选择服务器'
  }

  if (remoteServers.length === 0) {
    return (
      <Button
        variant="outline"
        disabled
        className={cn(
          "h-9 px-3 gap-2 pixel-button bg-background/75 border-[color:rgba(137,110,96,0.45)] dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)]",
          className
        )}
      >
        <Cloud className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">无远程服务器</span>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 px-3 gap-2 pixel-button bg-background/75 border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45",
            className
          )}
        >
          <Cloud className="h-4 w-4" />
          <span className="max-w-[120px] truncate text-sm">{getSelectedName()}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 pixel-border">
        {remoteServers.map(server => (
          <DropdownMenuItem
            key={`remote-${server.id}`}
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setSelectedServer(server.id)}
            disabled={server.status !== 'connected'}
          >
            <Cloud className={cn(
              "h-4 w-4",
              server.status === 'connected' ? 'text-green-500' : 'text-muted-foreground'
            )} />
            <span className="flex-1 truncate">{server.name}</span>
            {server.status !== 'connected' && (
              <Badge variant="secondary" className="text-xs py-0 px-1">
                {server.status === 'pending' ? '待连接' : '离线'}
              </Badge>
            )}
            {selectedRemoteServerId === server.id && (
              <Check className="h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
