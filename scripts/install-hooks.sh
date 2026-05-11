#!/bin/bash
# 安装 git hooks

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

cat > "$HOOKS_DIR/post-commit" << 'EOF'
#!/bin/bash
# post-commit hook: commit message 包含 [release] 时触发自动发布

COMMIT_MSG=$(git log -1 --pretty=%B)

if echo "$COMMIT_MSG" | grep -q "\[release\]"; then
  echo ""
  echo "检测到 [release] 标记，启动自动发布流程..."
  echo ""
  bash "$(git rev-parse --show-toplevel)/scripts/release.sh"
fi
EOF

chmod +x "$HOOKS_DIR/post-commit"
echo "Git hooks 安装完成"
