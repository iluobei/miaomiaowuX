package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// scanNodeTags deserializes JSON tags and syncs Tag field.
func scanNodeTags(node *Node, tagsJSON string) {
	if tagsJSON != "" && tagsJSON != "[]" {
		if err := json.Unmarshal([]byte(tagsJSON), &node.Tags); err != nil {
			node.Tags = nil
		}
	}
	if len(node.Tags) > 0 && node.Tag == "" {
		node.Tag = node.Tags[0]
	}
	if node.Tag != "" && len(node.Tags) == 0 {
		node.Tags = []string{node.Tag}
	}
}

// serializeNodeTags returns JSON string for tags and syncs Tag/Tags fields.
func serializeNodeTags(node *Node) string {
	if len(node.Tags) == 0 && node.Tag != "" {
		node.Tags = []string{node.Tag}
	}
	if len(node.Tags) > 0 {
		node.Tag = node.Tags[0]
	}
	if len(node.Tags) == 0 {
		return "[]"
	}
	b, err := json.Marshal(node.Tags)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func (n Node) HasAnyTag(tags map[string]bool) bool {
	for _, t := range n.Tags {
		if tags[t] {
			return true
		}
	}
	return false
}

// 检查用户的节点名称是否已存在（如果提供，则排除特定节点 ID）。
func (r *TrafficRepository) CheckNodeNameExists(ctx context.Context, nodeName, username string, excludeID int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("traffic repository not initialized")
	}

	nodeName = strings.TrimSpace(nodeName)
	username = strings.TrimSpace(username)
	if nodeName == "" || username == "" {
		return false, errors.New("node name and username are required")
	}

	var count int
	query := `SELECT COUNT(*) FROM nodes WHERE node_name = ? AND username = ?`
	args := []interface{}{nodeName, username}

	if excludeID > 0 {
		query += ` AND id != ?`
		args = append(args, excludeID)
	}

	err := r.db.QueryRowContext(ctx, query, args...).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check node name exists: %w", err)
	}

	return count > 0, nil
}

// 返回特定用户名的所有节点。
func (r *TrafficRepository) ListNodes(ctx context.Context, username string) ([]Node, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	rows, err := r.db.QueryContext(ctx, `SELECT id, username, raw_url, node_name, protocol, parsed_config, clash_config, enabled, COALESCE(tag, 'personal'), COALESCE(original_server, ''), COALESCE(inbound_tag, ''), created_at, updated_at FROM nodes WHERE username = ? ORDER BY created_at DESC`, username)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		var node Node
		var enabled int
		if err := rows.Scan(&node.ID, &node.Username, &node.RawURL, &node.NodeName, &node.Protocol, &node.ParsedConfig, &node.ClashConfig, &enabled, &node.Tag, &node.OriginalServer, &node.InboundTag, &node.CreatedAt, &node.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan node: %w", err)
		}
		node.Enabled = enabled != 0
		nodes = append(nodes, node)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate nodes: %w", err)
	}

	return nodes, nil
}

// 返回管理员用户的所有节点。
func (r *TrafficRepository) ListAllNodes(ctx context.Context) ([]Node, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `SELECT id, username, raw_url, node_name, protocol, parsed_config, clash_config, enabled, COALESCE(tag, 'personal'), COALESCE(original_server, ''), COALESCE(inbound_tag, ''), created_at, updated_at FROM nodes ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list all nodes: %w", err)
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		var node Node
		var enabled int
		if err := rows.Scan(&node.ID, &node.Username, &node.RawURL, &node.NodeName, &node.Protocol, &node.ParsedConfig, &node.ClashConfig, &enabled, &node.Tag, &node.OriginalServer, &node.InboundTag, &node.CreatedAt, &node.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan node: %w", err)
		}
		node.Enabled = enabled != 0
		nodes = append(nodes, node)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate nodes: %w", err)
	}

	return nodes, nil
}

// 通过 ID 和用户名检索单个节点。
func (r *TrafficRepository) GetNode(ctx context.Context, id int64, username string) (Node, error) {
	var node Node
	if r == nil || r.db == nil {
		return node, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return node, errors.New("node id is required")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return node, errors.New("username is required")
	}

	var enabled int
	row := r.db.QueryRowContext(ctx, `SELECT id, username, raw_url, node_name, protocol, parsed_config, clash_config, enabled, COALESCE(tag, 'personal'), COALESCE(original_server, ''), COALESCE(inbound_tag, ''), created_at, updated_at FROM nodes WHERE id = ? AND username = ? LIMIT 1`, id, username)
	if err := row.Scan(&node.ID, &node.Username, &node.RawURL, &node.NodeName, &node.Protocol, &node.ParsedConfig, &node.ClashConfig, &enabled, &node.Tag, &node.OriginalServer, &node.InboundTag, &node.CreatedAt, &node.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return node, ErrNodeNotFound
		}
		return node, fmt.Errorf("get node: %w", err)
	}
	node.Enabled = enabled != 0

	return node, nil
}

// GetNodeByID 仅通过 ID 检索节点（供管理员使用）。
// 该函数不检查用户名。
func (r *TrafficRepository) GetNodeByID(ctx context.Context, id int64) (Node, error) {
	var node Node
	if r == nil || r.db == nil {
		return node, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return node, errors.New("node id is required")
	}

	var enabled int
	row := r.db.QueryRowContext(ctx, `SELECT id, username, raw_url, node_name, protocol, parsed_config, clash_config, enabled, COALESCE(tag, 'personal'), COALESCE(original_server, ''), COALESCE(inbound_tag, ''), created_at, updated_at FROM nodes WHERE id = ? LIMIT 1`, id)
	if err := row.Scan(&node.ID, &node.Username, &node.RawURL, &node.NodeName, &node.Protocol, &node.ParsedConfig, &node.ClashConfig, &enabled, &node.Tag, &node.OriginalServer, &node.InboundTag, &node.CreatedAt, &node.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return node, ErrNodeNotFound
		}
		return node, fmt.Errorf("get node by id: %w", err)
	}
	node.Enabled = enabled != 0

	return node, nil
}

// 插入一个新的代理节点。
func (r *TrafficRepository) CreateNode(ctx context.Context, node Node) (Node, error) {
	if r == nil || r.db == nil {
		return Node{}, errors.New("traffic repository not initialized")
	}

	node.Username = strings.TrimSpace(node.Username)
	node.RawURL = strings.TrimSpace(node.RawURL)
	node.NodeName = strings.TrimSpace(node.NodeName)
	node.Protocol = strings.ToLower(strings.TrimSpace(node.Protocol))
	node.Tag = strings.TrimSpace(node.Tag)
	node.InboundTag = strings.TrimSpace(node.InboundTag)

	if node.Username == "" {
		return Node{}, errors.New("username is required")
	}
	// RawURL 可以为空（Clash 订阅节点），但 ClashConfig 必须存在
	if node.RawURL == "" && node.ClashConfig == "" {
		return Node{}, errors.New("raw URL or clash config is required")
	}
	if node.NodeName == "" {
		return Node{}, errors.New("node name is required")
	}
	if node.Protocol == "" {
		return Node{}, errors.New("protocol is required")
	}
	if node.Tag == "" {
		node.Tag = "手动输入"
	}

	enabled := 0
	if node.Enabled {
		enabled = 1
	}

	res, err := r.db.ExecContext(ctx, `INSERT INTO nodes (username, raw_url, node_name, protocol, parsed_config, clash_config, enabled, tag, original_server, inbound_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, node.Username, node.RawURL, node.NodeName, node.Protocol, node.ParsedConfig, node.ClashConfig, enabled, node.Tag, node.OriginalServer, node.InboundTag)
	if err != nil {
		return Node{}, fmt.Errorf("create node: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return Node{}, fmt.Errorf("fetch node id: %w", err)
	}

	return r.GetNode(ctx, id, node.Username)
}

// 更新现有的代理节点。
func (r *TrafficRepository) UpdateNode(ctx context.Context, node Node) (Node, error) {
	if r == nil || r.db == nil {
		return Node{}, errors.New("traffic repository not initialized")
	}

	if node.ID <= 0 {
		return Node{}, errors.New("node id is required")
	}

	node.Username = strings.TrimSpace(node.Username)
	node.RawURL = strings.TrimSpace(node.RawURL)
	node.NodeName = strings.TrimSpace(node.NodeName)
	node.Protocol = strings.ToLower(strings.TrimSpace(node.Protocol))
	node.Tag = strings.TrimSpace(node.Tag)
	node.InboundTag = strings.TrimSpace(node.InboundTag)

	if node.Username == "" {
		return Node{}, errors.New("username is required")
	}
	// RawURL 可以为空（Clash 订阅节点），但 ClashConfig 必须存在
	if node.RawURL == "" && node.ClashConfig == "" {
		return Node{}, errors.New("raw URL or clash config is required")
	}
	if node.NodeName == "" {
		return Node{}, errors.New("node name is required")
	}
	if node.Protocol == "" {
		return Node{}, errors.New("protocol is required")
	}
	if node.Tag == "" {
		node.Tag = "手动输入"
	}

	enabled := 0
	if node.Enabled {
		enabled = 1
	}

	res, err := r.db.ExecContext(ctx, `UPDATE nodes SET raw_url = ?, node_name = ?, protocol = ?, parsed_config = ?, clash_config = ?, enabled = ?, tag = ?, original_server = ?, inbound_tag = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?`, node.RawURL, node.NodeName, node.Protocol, node.ParsedConfig, node.ClashConfig, enabled, node.Tag, node.OriginalServer, node.InboundTag, node.ID, node.Username)
	if err != nil {
		return Node{}, fmt.Errorf("update node: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return Node{}, fmt.Errorf("node update rows affected: %w", err)
	}
	if affected == 0 {
		return Node{}, ErrNodeNotFound
	}

	return r.GetNode(ctx, node.ID, node.Username)
}

// 删除代理节点。
func (r *TrafficRepository) DeleteNode(ctx context.Context, id int64, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("node id is required")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	// 获取节点的 raw_url，用于后续检查外部订阅
	var rawURL string
	err := r.db.QueryRowContext(ctx, `SELECT raw_url FROM nodes WHERE id = ? AND username = ?`, id, username).Scan(&rawURL)
	if err != nil {
		if err == sql.ErrNoRows {
			return ErrNodeNotFound
		}
		return fmt.Errorf("get node raw_url: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `DELETE FROM nodes WHERE id = ? AND username = ?`, id, username)
	if err != nil {
		return fmt.Errorf("delete node: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("node delete rows affected: %w", err)
	}
	if affected == 0 {
		return ErrNodeNotFound
	}

	// 检查该 raw_url 是否还有其他节点使用
	// 如果没有，则删除对应的外部订阅及其关联的代理集合配置
	if rawURL != "" {
		var count int
		err = r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM nodes WHERE username = ? AND raw_url = ?`, username, rawURL).Scan(&count)
		if err != nil {
			// 记录错误但不影响删除节点的操作
			return nil
		}

		// 如果没有节点使用该订阅链接，删除外部订阅
		if count == 0 {
			// 首先获取外部订阅的 ID
			var subID int64
			err = r.db.QueryRowContext(ctx, `SELECT id FROM external_subscriptions WHERE username = ? AND url = ?`, username, rawURL).Scan(&subID)
			if err == nil && subID > 0 {
				// 删除关联的代理集合配置
				_, _ = r.db.ExecContext(ctx, `DELETE FROM proxy_provider_configs WHERE external_subscription_id = ?`, subID)
			}
			// 删除外部订阅
			_, err = r.db.ExecContext(ctx, `DELETE FROM external_subscriptions WHERE username = ? AND url = ?`, username, rawURL)
			if err != nil {
				// 记录错误但不影响删除节点的操作
				// 可以在这里添加日志记录
			}
		}
	}

	return nil
}

// DeleteNodeByID 仅按 ID 删除代理节点（供管理员使用）。
// 该功能不检查用户名，允许管理员删除任何节点。
func (r *TrafficRepository) DeleteNodeByID(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("node id is required")
	}

	// 获取节点信息以进行清理
	var rawURL, username string
	err := r.db.QueryRowContext(ctx, `SELECT raw_url, username FROM nodes WHERE id = ?`, id).Scan(&rawURL, &username)
	if err != nil {
		if err == sql.ErrNoRows {
			return ErrNodeNotFound
		}
		return fmt.Errorf("get node info: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `DELETE FROM nodes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete node: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("node delete rows affected: %w", err)
	}
	if affected == 0 {
		return ErrNodeNotFound
	}

	// 如果没有其他节点使用相同的 raw_url，则清除外部订阅
	if rawURL != "" && username != "" {
		var count int
		err = r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM nodes WHERE username = ? AND raw_url = ?`, username, rawURL).Scan(&count)
		if err == nil && count == 0 {
			var subID int64
			err = r.db.QueryRowContext(ctx, `SELECT id FROM external_subscriptions WHERE username = ? AND url = ?`, username, rawURL).Scan(&subID)
			if err == nil && subID > 0 {
				_, _ = r.db.ExecContext(ctx, `DELETE FROM proxy_provider_configs WHERE external_subscription_id = ?`, subID)
			}
			_, _ = r.db.ExecContext(ctx, `DELETE FROM external_subscriptions WHERE username = ? AND url = ?`, username, rawURL)
		}
	}

	return nil
}

// 在单个事务中创建多个节点。
func (r *TrafficRepository) BatchCreateNodes(ctx context.Context, nodes []Node) ([]Node, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if len(nodes) == 0 {
		return nil, errors.New("nodes list is empty")
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin batch create nodes tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO nodes (username, raw_url, node_name, protocol, parsed_config, clash_config, enabled, tag, original_server, inbound_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return nil, fmt.Errorf("prepare insert node: %w", err)
	}
	defer stmt.Close()

	var createdIDs []int64
	for idx, node := range nodes {
		node.Username = strings.TrimSpace(node.Username)
		node.RawURL = strings.TrimSpace(node.RawURL)
		node.NodeName = strings.TrimSpace(node.NodeName)
		node.Protocol = strings.ToLower(strings.TrimSpace(node.Protocol))
		node.Tag = strings.TrimSpace(node.Tag)
		node.InboundTag = strings.TrimSpace(node.InboundTag)

		if node.Username == "" {
			return nil, fmt.Errorf("node %d: username is required", idx+1)
		}
		// RawURL 可以为空（Clash 订阅节点），但 ClashConfig 必须存在
		if node.RawURL == "" && node.ClashConfig == "" {
			return nil, fmt.Errorf("node %d: raw URL or clash config is required", idx+1)
		}
		if node.NodeName == "" {
			return nil, fmt.Errorf("node %d: node name is required", idx+1)
		}
		if node.Protocol == "" {
			return nil, fmt.Errorf("node %d: protocol is required", idx+1)
		}
		if node.Tag == "" {
			node.Tag = "手动输入"
		}

		enabled := 0
		if node.Enabled {
			enabled = 1
		}

		res, err := stmt.ExecContext(ctx, node.Username, node.RawURL, node.NodeName, node.Protocol, node.ParsedConfig, node.ClashConfig, enabled, node.Tag, node.OriginalServer, node.InboundTag)
		if err != nil {
			return nil, fmt.Errorf("insert node %d: %w", idx+1, err)
		}

		id, err := res.LastInsertId()
		if err != nil {
			return nil, fmt.Errorf("fetch node %d id: %w", idx+1, err)
		}

		createdIDs = append(createdIDs, id)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit batch create nodes: %w", err)
	}

	// 获取创建的节点
	var created []Node
	for i, id := range createdIDs {
		node, err := r.GetNode(ctx, id, nodes[i].Username)
		if err != nil {
			return nil, fmt.Errorf("fetch created node %d: %w", i+1, err)
		}
		created = append(created, node)
	}

	return created, nil
}

// 删除特定用户的所有节点。
func (r *TrafficRepository) DeleteAllUserNodes(ctx context.Context, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	_, err := r.db.ExecContext(ctx, `DELETE FROM nodes WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete all user nodes: %w", err)
	}

	return nil
}

// DeleteNodesByInboundTag 删除与服务器名称和入站标记匹配的所有节点。
// 从远程服务器删除入站时使用。
func (r *TrafficRepository) DeleteNodesByInboundTag(ctx context.Context, serverName, inboundTag string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	serverName = strings.TrimSpace(serverName)
	inboundTag = strings.TrimSpace(inboundTag)
	if serverName == "" || inboundTag == "" {
		return 0, errors.New("server name and inbound tag are required")
	}

	res, err := r.db.ExecContext(ctx, `DELETE FROM nodes WHERE original_server = ? AND inbound_tag = ?`, serverName, inboundTag)
	if err != nil {
		return 0, fmt.Errorf("delete nodes by inbound tag: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("delete nodes rows affected: %w", err)
	}

	return affected, nil
}

// 当服务器名称更改时，UpdateNodesByServerName 会更新所有节点。
// 这将更新该服务器中节点的original_server 字段和tag 字段。
func (r *TrafficRepository) UpdateNodesByServerName(ctx context.Context, oldName, newName string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" {
		return 0, errors.New("old name and new name are required")
	}

	if oldName == newName {
		return 0, nil
	}

	// 更新original_server和tag字段
	// 同时更新包含 [server_name] 前缀的node_name
	res, err := r.db.ExecContext(ctx, `
		UPDATE nodes
		SET original_server = ?,
		    tag = REPLACE(tag, ?, ?),
		    node_name = REPLACE(node_name, ?, ?),
		    updated_at = CURRENT_TIMESTAMP
		WHERE original_server = ?`,
		newName,
		"远程:"+oldName, "远程:"+newName,
		"["+oldName+"]", "["+newName+"]",
		oldName)
	if err != nil {
		return 0, fmt.Errorf("update nodes by server name: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("update nodes rows affected: %w", err)
	}

	return affected, nil
}

// 按服务器名称和入站标签更新节点配置。
func (r *TrafficRepository) UpdateNodeByInboundTag(ctx context.Context, serverName, inboundTag, clashConfig string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	serverName = strings.TrimSpace(serverName)
	inboundTag = strings.TrimSpace(inboundTag)
	if serverName == "" || inboundTag == "" {
		return errors.New("server name and inbound tag are required")
	}

	_, err := r.db.ExecContext(ctx, `
		UPDATE nodes
		SET clash_config = ?, parsed_config = ?, updated_at = CURRENT_TIMESTAMP
		WHERE original_server = ? AND inbound_tag = ?`,
		clashConfig, clashConfig, serverName, inboundTag)
	if err != nil {
		return fmt.Errorf("update node by inbound tag: %w", err)
	}

	return nil
}
