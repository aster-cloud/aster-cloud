# Staging deployment

Manifests for `staging.aster-lang.cloud` running on the OCI K3S cluster (ap-melbourne-1).

## Topology

```
                             ┌─────────────────────────────┐
                             │  Cloudflare DNS              │
                             │  staging.aster-lang.cloud →  │
                             │  K3S Traefik LB              │
                             └─────────────┬───────────────┘
                                           │
                                           ▼
            ┌──────────────────────────────────────────────────────┐
            │  K3S namespace: aster-cloud-staging                  │
            │                                                      │
            │   ┌─────────────┐    ┌───────────────┐               │
            │   │ aster-cloud │ → │ aster-api      │               │
            │   │ (Next.js)   │    │ (Quarkus JVM) │               │
            │   └──────┬──────┘    └───────┬───────┘               │
            │          │                   │                       │
            │          │ ┌─────────────────▼───────────────┐       │
            │          │ │ CNPG: postgres-staging         │       │
            │          │ │ (primary in-cluster, 3 replicas)│       │
            │          │ └─────────────────────────────────┘       │
            │          │ ┌──────────────┐                          │
            │          └─► redis-staging │                          │
            │            └──────────────┘                          │
            │                                                      │
            └──────────────────────────────────────────────────────┘
                                           │
                                           │ WAL backup (continuous)
                                           ▼
              ┌─────────────────────────────────────────────────────┐
              │ OCI Object Storage bucket-backup                    │
              │ (axuwdowxwpud namespace, ap-melbourne-1)            │
              └─────────────────────────────────────────────────────┘
                                           │
                                           │ daily snapshot (cron)
                                           ▼
              ┌─────────────────────────────────────────────────────┐
              │ OCI Autonomous Database (DR / read-replica)         │
              │ (cold-restore target for catastrophic failure)      │
              └─────────────────────────────────────────────────────┘
```

## Layout

```
deploy/staging/
├── README.md                        # this file
├── argocd/
│   └── application.yaml             # ArgoCD Application pointing at this dir
├── aster-cloud/                     # Next.js standalone front-end
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── deployment.yaml
│       ├── service.yaml
│       ├── ingress.yaml
│       ├── externalsecret.yaml
│       └── configmap.yaml
├── aster-api/                       # Quarkus JVM back-end
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── deployment.yaml
│       ├── service.yaml
│       └── externalsecret.yaml
└── postgres/
    ├── cluster.yaml                 # CNPG cluster definition
    ├── backup.yaml                  # WAL → OCI Object Storage backup config
    └── scheduledbackup.yaml         # daily full snapshot
```

## Prerequisites (already present in cluster — verified May 2026)

- ArgoCD running in `argocd` namespace
- cert-manager running in `cert-manager` namespace (ClusterIssuer `letsencrypt-prod`)
- ExternalSecrets running in `external-secrets` namespace, configured to pull from OCI Vault
- CNPG operator running in `cnpg-system` namespace
- Traefik ingress with public LB IP (192.168.0.2, .3, .4, 192.168.1.2 — multi-master)

## Deployment

Once the ArgoCD Application is committed to main, the cluster sync is automatic:

```bash
KUBECONFIG=~/.kube/k3s-config kubectl apply -f deploy/staging/argocd/application.yaml
KUBECONFIG=~/.kube/k3s-config argocd app sync aster-cloud-staging
KUBECONFIG=~/.kube/k3s-config argocd app wait aster-cloud-staging --health
```

See [`docs/runbooks/staging-deploy.md`](../../docs/runbooks/staging-deploy.md) for the full operator runbook (deploy + invite customer + reset DB).

## Why staging is separate from prod

- Production SaaS = Cloudflare Workers (our managed deploy, runs aster-lang.cloud)
- Production on-prem-equivalent infrastructure = customer's own K3S
- Staging = our internal K3S, used for:
  - Pre-release validation of on-prem builds (these run on Node standalone, NOT Workers)
  - Customer POCs / demos before they get their own k8s
  - License-key ceremony rehearsals (see `docs/runbooks/license-key-ceremony-rehearsal.md`)
  - Quarterly DR drills (restore from OCI Object Storage to Autonomous DB)
