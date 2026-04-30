package event

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"miaomiaowux/internal/storage"
)

// InboundToClashFunc 入站转 Clash 配置的函数类型
type InboundToClashFunc func(serverID int64, inbound map[string]any) (string, error)

// NodeSyncListener 节点同步监听器
type NodeSyncListener struct {
	repo           *storage.TrafficRepository
	inboundToClash InboundToClashFunc
}

// 创建节点同步监听器
func NewNodeSyncListener(repo *storage.TrafficRepository, converter InboundToClashFunc) *NodeSyncListener {
	return &NodeSyncListener{
		repo:           repo,
		inboundToClash: converter,
	}
}

// 处理入站事件
func (l *NodeSyncListener) Handle(event InboundEvent) {
	ctx := context.Background()

	switch event.Type {
	case EventInboundAdded:
		l.handleAdded(ctx, event)
	case EventInboundRemoved:
		l.handleRemoved(ctx, event)
	case EventInboundUpdated:
		l.handleUpdated(ctx, event)
	}
}

func (l *NodeSyncListener) handleAdded(ctx context.Context, event InboundEvent) {
	// 获取服务器信息
	server, err := l.repo.GetRemoteServer(ctx, event.ServerID)
	if err != nil {
		log.Printf("[NodeSync] Failed to get server %d: %v", event.ServerID, err)
		return
	}

	// 跳过 api 和 tunnel
	if event.Tag == "api" || event.Protocol == "tunnel" {
		return
	}

	// 生成节点名称：优先使用自定义名称，否则使用 tag 或 protocol:port
	var nodeName string
	if event.NodeName != "" {
		nodeName = event.NodeName
	} else if event.Tag != "" {
		nodeName = fmt.Sprintf("[%s] %s", server.Name, event.Tag)
	} else {
		nodeName = fmt.Sprintf("[%s] %s:%d", server.Name, event.Protocol, event.Port)
	}

	// 检查是否已存在（按名称）
	exists, _ := l.repo.CheckNodeNameExists(ctx, nodeName, "admin", 0)
	if exists {
		log.Printf("[NodeSync] Node already exists: %s", nodeName)
		return
	}

	// 检查是否已存在（按 server + protocol + port）
	existingNodes, _ := l.repo.ListNodes(ctx, "admin")
	for _, n := range existingNodes {
		if n.OriginalServer == server.Name {
			var config map[string]any
			if err := json.Unmarshal([]byte(n.ClashConfig), &config); err == nil {
				if proto, ok := config["type"].(string); ok {
					if port, ok := config["port"].(float64); ok {
						if proto == event.Protocol && int(port) == event.Port {
							log.Printf("[NodeSync] Node with same server/protocol/port already exists: %s", n.NodeName)
							return
						}
					}
				}
			}
		}
	}

	// 转换为 Clash 配置
	clashConfig, err := l.inboundToClash(event.ServerID, event.Inbound)
	if err != nil {
		log.Printf("[NodeSync] Failed to convert inbound to clash: %v", err)
		return
	}

	// 用实际节点名称覆盖 Clash 配置中的 name 字段
	var clashMap map[string]any
	if json.Unmarshal([]byte(clashConfig), &clashMap) == nil {
		clashMap["name"] = nodeName
		if updated, err := json.Marshal(clashMap); err == nil {
			clashConfig = string(updated)
		}
	}

	// 创建节点
	node := storage.Node{
		Username:       "admin",
		NodeName:       nodeName,
		Protocol:       event.Protocol,
		ClashConfig:    clashConfig,
		ParsedConfig:   clashConfig,
		Enabled:        true,
		Tag:            fmt.Sprintf("远程:%s", server.Name),
		OriginalServer: server.Name,
		InboundTag:     event.Tag,
	}

	if _, err := l.repo.CreateNode(ctx, node); err != nil {
		log.Printf("[NodeSync] Failed to create node: %v", err)
	} else {
		log.Printf("[NodeSync] Created node: %s", nodeName)
	}
}

func (l *NodeSyncListener) handleRemoved(ctx context.Context, event InboundEvent) {
	server, err := l.repo.GetRemoteServer(ctx, event.ServerID)
	if err != nil {
		log.Printf("[NodeSync] Failed to get server %d: %v", event.ServerID, err)
		return
	}

	// 删除对应节点
	if _, err := l.repo.DeleteNodesByInboundTag(ctx, server.Name, event.Tag); err != nil {
		log.Printf("[NodeSync] Failed to delete nodes: %v", err)
	} else {
		log.Printf("[NodeSync] Deleted nodes for inbound: %s/%s", server.Name, event.Tag)
	}
}

func (l *NodeSyncListener) handleUpdated(ctx context.Context, event InboundEvent) {
	server, err := l.repo.GetRemoteServer(ctx, event.ServerID)
	if err != nil {
		log.Printf("[NodeSync] Failed to get server %d: %v", event.ServerID, err)
		return
	}

	clashConfig, err := l.inboundToClash(event.ServerID, event.Inbound)
	if err != nil {
		log.Printf("[NodeSync] Failed to convert inbound to clash: %v", err)
		return
	}

	// 更新匹配的节点
	if err := l.repo.UpdateNodeByInboundTag(ctx, server.Name, event.Tag, clashConfig); err != nil {
		log.Printf("[NodeSync] Failed to update node: %v", err)
	} else {
		log.Printf("[NodeSync] Updated node for inbound: %s/%s", server.Name, event.Tag)
	}
}
