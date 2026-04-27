package handler

import (
	"encoding/json"
	"net/http"
	"sort"

	"miaomiaowu/internal/storage"
)

func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": err.Error(),
	})
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func sortNodesByNodeOrder(nodes []storage.Node, nodeOrder []int64) {
	if len(nodeOrder) == 0 || len(nodes) == 0 {
		return
	}

	nodeIDToPosition := make(map[int64]int, len(nodeOrder))
	for pos, nodeID := range nodeOrder {
		nodeIDToPosition[nodeID] = pos
	}

	sort.SliceStable(nodes, func(i, j int) bool {
		posI, foundI := nodeIDToPosition[nodes[i].ID]
		posJ, foundJ := nodeIDToPosition[nodes[j].ID]

		if !foundI {
			return false
		}
		if !foundJ {
			return true
		}
		return posI < posJ
	})
}
