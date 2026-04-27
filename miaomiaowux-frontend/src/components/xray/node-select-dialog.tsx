// @ts-nocheck
import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { toast } from 'sonner'

// Protocol colors matching node management
const PROTOCOL_COLORS: Record<string, string> = {
  vmess: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  vless: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  trojan: 'bg-red-500/10 text-red-700 dark:text-red-400',
  ss: 'bg-green-500/10 text-green-700 dark:text-green-400',
  socks5: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  hysteria: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',
  hysteria2: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  tuic: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  anytls: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  wireguard: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
}

interface ParsedNode {
  id: number
  raw_url: string
  node_name: string
  protocol: string
  parsed_config: string
  clash_config: string
  enabled: boolean
  tag: string
  original_server: string
  created_at: string
  updated_at: string
}

interface NodeSelectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (node: ParsedNode, clashConfig: any) => void
  /** Filter nodes by protocol, e.g., ['vless', 'vmess', 'trojan'] */
  protocolFilter?: string[]
}

export function NodeSelectDialog({ open, onOpenChange, onSelect, protocolFilter }: NodeSelectDialogProps) {
  const [nodes, setNodes] = useState<ParsedNode[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('all')

  // Load node list
  useEffect(() => {
    if (open) {
      loadNodes()
      setSelectedNodeId(null)
      setSearchTerm('')
      setTagFilter('all')
    }
  }, [open])

  const loadNodes = async () => {
    setLoading(true)
    try {
      const response = await api.get('/api/admin/nodes')
      const nodeData = response.data?.nodes || []
      setNodes(nodeData)
    } catch (error) {
      toast.error('加载节点失败', {
        description: error.response?.data?.message || error.message,
      })
      setNodes([])
    } finally {
      setLoading(false)
    }
  }

  const handleSelectNode = (nodeId: number) => {
    setSelectedNodeId(nodeId === selectedNodeId ? null : nodeId)
  }

  // Get unique tags
  const uniqueTags = useMemo(() => {
    const tags = new Set<string>()
    nodes.forEach((node) => {
      if (node.tag && node.tag.trim()) {
        tags.add(node.tag.trim())
      }
    })
    return Array.from(tags).sort()
  }, [nodes])

  // Filter nodes
  const filteredNodes = useMemo(() => {
    let filtered = nodes

    // Filter by enabled status
    filtered = filtered.filter((node) => node.enabled)

    // Filter by protocol if specified
    if (protocolFilter && protocolFilter.length > 0) {
      filtered = filtered.filter((node) =>
        protocolFilter.some((p) => node.protocol.toLowerCase().includes(p.toLowerCase()))
      )
    }

    // Filter by tag
    if (tagFilter !== 'all') {
      filtered = filtered.filter((node) => node.tag === tagFilter)
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase()
      filtered = filtered.filter((node) =>
        node.node_name?.toLowerCase().includes(searchLower) ||
        node.protocol?.toLowerCase().includes(searchLower) ||
        node.tag?.toLowerCase().includes(searchLower)
      )
    }

    return filtered
  }, [nodes, protocolFilter, tagFilter, searchTerm])

  const handleConfirm = () => {
    if (!selectedNodeId) return

    const selectedNode = nodes.find((n) => n.id === selectedNodeId)
    if (!selectedNode) return

    try {
      const clashConfig = JSON.parse(selectedNode.clash_config)
      onSelect(selectedNode, clashConfig)
      onOpenChange(false)
    } catch (error) {
      toast.error('解析节点配置失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>从节点导入</DialogTitle>
          <DialogDescription>选择一个节点，将其配置导入到出站</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Search box */}
          <div className="space-y-2">
            <Label>搜索节点</Label>
            <Input
              placeholder="输入节点名称、协议或标签搜索"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Tag filter */}
          {uniqueTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={tagFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setTagFilter('all')}
              >
                全部
              </Button>
              {uniqueTags.map((tag) => (
                <Button
                  key={tag}
                  size="sm"
                  variant={tagFilter === tag ? 'default' : 'outline'}
                  onClick={() => setTagFilter(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}

          {/* Node list */}
          <div className="flex-1 overflow-y-auto border rounded-lg p-4">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
            ) : filteredNodes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {searchTerm || tagFilter !== 'all' ? '未找到匹配的节点' : '暂无可用节点'}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredNodes.map((node) => {
                  let clashConfig: any = null
                  try {
                    clashConfig = JSON.parse(node.clash_config)
                  } catch {
                    // ignore
                  }

                  return (
                    <div
                      key={node.id}
                      className={`flex items-center space-x-3 p-3 border rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors ${
                        selectedNodeId === node.id ? 'bg-primary/10 border-primary' : ''
                      }`}
                      onClick={() => handleSelectNode(node.id)}
                    >
                      <Checkbox
                        checked={selectedNodeId === node.id}
                        onCheckedChange={() => handleSelectNode(node.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={PROTOCOL_COLORS[node.protocol.toLowerCase()] || 'bg-gray-500/10'}
                          >
                            {node.protocol.toUpperCase()}
                          </Badge>
                          <span className="font-medium truncate">{node.node_name}</span>
                          {node.tag && (
                            <Badge variant="secondary" className="text-xs">
                              {node.tag}
                            </Badge>
                          )}
                        </div>
                        {clashConfig && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {clashConfig.server}:{clashConfig.port}
                            {clashConfig.network && clashConfig.network !== 'tcp' && (
                              <span className="ml-2">({clashConfig.network})</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            {selectedNodeId ? '已选择 1 个节点' : '请选择一个节点'}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedNodeId}>
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
