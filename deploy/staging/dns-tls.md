# DNS + TLS for staging.aster-lang.cloud

How the staging hostname resolves and gets a TLS certificate. Done once at environment provisioning; revisit only when the cluster LB IP changes.

## DNS (Cloudflare)

The apex zone `aster-lang.cloud` lives in Cloudflare. The staging subdomain is an A record pointing at the K3S Traefik load-balancer IP.

| Type | Name | Value | Proxied | TTL |
|---|---|---|---|---|
| A | `staging` | `<K3S-LB-IP>` (one of 192.168.0.2/.3/.4/192.168.1.2 — see note) | **DNS-only** (gray cloud) | Auto |

**Why DNS-only, not proxied:**
- We need the LE HTTP-01 challenge to reach the cluster directly. Cloudflare's "proxied" mode terminates TLS at the edge and would shadow cert-manager.
- Cloudflare's edge IPs would make pod-to-pod traffic look like it comes from CF, breaking IP allowlists if we add them later.

**LB IP selection:**
K3S has four control-plane IPs. Pick the one that's currently advertised by `klipper-lb`:

```bash
KUBECONFIG=~/.kube/k3s-config kubectl -n kube-system get svc traefik \
  -o jsonpath='{.status.loadBalancer.ingress[*].ip}'
```

If multiple IPs are returned, pick any one; klipper-lb load-balances across the masters via Layer 2.

## TLS (cert-manager + Let's Encrypt)

cert-manager is already running in the cluster (`cert-manager` namespace) with `ClusterIssuer/letsencrypt-prod`. The ingress's `cert-manager.io/cluster-issuer` annotation triggers automatic provisioning.

### How it works

1. Ingress is applied with the annotation.
2. cert-manager sees the annotation, creates a `Certificate` resource.
3. cert-manager creates a `CertificateRequest`, then an `Order`, then an HTTP-01 `Challenge`.
4. The challenge spins up a temporary pod + ingress to serve the `/.well-known/acme-challenge/<token>` path.
5. Let's Encrypt fetches it through Cloudflare DNS → K3S Traefik → challenge pod.
6. Cert is issued, stored as the secret `aster-cloud-staging-tls`, mounted by ingress.
7. Renewal: cert-manager auto-renews when the cert is within 30 days of expiry (LE certs are 90 days).

### Verify

```bash
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging get certificate
# Expect: aster-cloud-staging-tls   True    aster-cloud-staging-tls   <age>

KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging describe certificate aster-cloud-staging-tls \
  | grep -E "Status|Events" -A 5
```

```bash
# End-to-end check from outside the cluster:
curl -sI https://staging.aster-lang.cloud/ | head -1
# Expect: HTTP/2 200 (or 307)

openssl s_client -connect staging.aster-lang.cloud:443 -servername staging.aster-lang.cloud < /dev/null 2>&1 \
  | grep -E "subject=|issuer="
# Expect: issuer=C = US, O = Let's Encrypt, CN = R10 (or similar)
```

## Troubleshooting

### Challenge stuck "pending"
Most common cause: Cloudflare DNS not yet propagated, or the A record is proxied (orange cloud) instead of DNS-only.

```bash
# Verify Cloudflare sees DNS-only:
dig +short staging.aster-lang.cloud
# Expect: the K3S LB IP, NOT a Cloudflare edge IP (which would start with 104.x or 172.x)

# If proxied IP appears, flip to gray cloud in Cloudflare dashboard.
```

### "rate limited by Let's Encrypt"
LE rate-limits to 50 issuances per registered domain per week. If we hit the limit:
1. Wait the cooldown (max 1 week).
2. Use `letsencrypt-staging` ClusterIssuer for dev verification (annotate ingress with that instead), then flip back to `letsencrypt-prod` once stable.

### Cert renewal didn't fire
cert-manager renews at T - 30 days. If somehow we ended up at < 7 days:
```bash
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging delete certificate aster-cloud-staging-tls
# cert-manager will re-create it within 30s
```

## Related

- `argocd/application.yaml` — applies the ingress with the cert-manager annotation
- `docs/runbooks/staging-deploy.md` — full deployment runbook
- Cloudflare zone admin: ask in #ops (only 2-3 humans hold admin access)
