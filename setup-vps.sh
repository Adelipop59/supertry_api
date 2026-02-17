#!/bin/bash
# ============================================================
# SuperTry API — VPS Initial Setup Script
# ============================================================
# Run as: bash scripts/setup-vps.sh
#
# Prerequisites:
#   - Ubuntu 22.04 or 24.04
#   - User 'supertry' with sudo access
#   - DNS for api.super-try.com AND dev-api.super-try.com pointing to this VPS
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Pre-checks ──────────────────────────────────────────────
if [ "$(id -u)" -eq 0 ]; then
  err "Do not run as root. Run as 'supertry' user with sudo access."
fi

echo ""
echo "============================================"
echo "  SuperTry API — VPS Setup"
echo "============================================"
echo ""

# ── Step 1: System update ──────────────────────────────────
echo "--- Step 1/7: System Update ---"
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git ufw
log "System updated"

# ── Step 2: Firewall ───────────────────────────────────────
echo ""
echo "--- Step 2/7: Firewall (UFW) ---"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 6443/tcp
echo "y" | sudo ufw enable
sudo ufw status
log "Firewall configured (22, 80, 443, 6443)"

# ── Step 3: Install K3s ───────────────────────────────────
echo ""
echo "--- Step 3/7: K3s Installation ---"
if command -v k3s &>/dev/null; then
  warn "K3s already installed, skipping"
else
  curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
  log "K3s installed"
fi

# ── Step 4: Configure kubectl ──────────────────────────────
echo ""
echo "--- Step 4/7: kubectl Configuration ---"
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown "$(id -u):$(id -g)" ~/.kube/config
chmod 600 ~/.kube/config

if ! grep -q 'KUBECONFIG' ~/.bashrc; then
  echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc
fi
export KUBECONFIG=~/.kube/config
log "kubectl configured"

# ── Step 5: Wait for node ─────────────────────────────────
echo ""
echo "--- Step 5/7: Waiting for K3s Node ---"
kubectl wait --for=condition=Ready node --all --timeout=120s
log "K3s node ready"
kubectl get nodes

# ── Step 6: Install cert-manager ──────────────────────────
echo ""
echo "--- Step 6/7: cert-manager Installation ---"
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.17.1/cert-manager.yaml
echo "Waiting for cert-manager pods (30s)..."
sleep 30
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager -n cert-manager --timeout=120s
log "cert-manager installed"

# ── Step 7: Kubernetes Dashboard ──────────────────────────
echo ""
echo "--- Step 7/7: Kubernetes Dashboard ---"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml
log "Dashboard installed"

# ── Summary ───────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Create namespaces:"
echo "     kubectl create namespace supertry-prod"
echo "     kubectl create namespace supertry-dev"
echo ""
echo "  2. Create ghcr.io pull secrets (for each namespace):"
echo "     for NS in supertry-prod supertry-dev; do"
echo "       kubectl create secret docker-registry ghcr-secret \\"
echo "         --namespace=\$NS \\"
echo "         --docker-server=ghcr.io \\"
echo "         --docker-username=YOUR_GITHUB_USER \\"
echo "         --docker-password=YOUR_GITHUB_PAT \\"
echo "         --docker-email=YOUR_EMAIL"
echo "     done"
echo ""
echo "  3. Create application secrets (for each namespace):"
echo "     kubectl create secret generic supertry-secrets \\"
echo "       --namespace=supertry-prod \\"
echo "       --from-literal=DATABASE_URL='...' \\"
echo "       --from-literal=STRIPE_SECRET_KEY='...' \\"
echo "       ... (all env vars)"
echo ""
echo "     kubectl create secret generic supertry-secrets \\"
echo "       --namespace=supertry-dev \\"
echo "       --from-literal=DATABASE_URL='...' \\"
echo "       --from-literal=STRIPE_SECRET_KEY='sk_test_...' \\"
echo "       ... (all env vars with dev/test values)"
echo ""
echo "  4. Apply dashboard admin (once):"
echo "     kubectl apply -f k8s/base/dashboard-admin.yaml"
echo ""
echo "  5. Get KUBECONFIG_DATA for GitHub Actions:"
VPS_IP=$(curl -s ifconfig.me)
echo "     Run this command:"
echo "     sed 's/127.0.0.1/${VPS_IP}/g' ~/.kube/config | base64 -w 0"
echo ""
echo "     Then add it as KUBECONFIG_DATA secret in GitHub."
echo ""
echo "  6. Push to 'dev' or 'main' branch to trigger deployment!"
echo ""
echo "  Dashboard access:"
echo "     ssh -L 8443:localhost:8443 supertry@${VPS_IP}"
echo "     kubectl port-forward -n kubernetes-dashboard svc/kubernetes-dashboard 8443:443"
echo "     kubectl -n kubernetes-dashboard create token admin-user"
echo "     Open: https://localhost:8443"
echo ""
