# SpaceHarbor Helm chart

Deploy SpaceHarbor control-plane + web-ui to Kubernetes.

## Install

```bash
# Create the secrets referenced by the chart FIRST (NEVER commit plaintext):
kubectl create secret generic spaceharbor-secrets \
  --from-literal=SPACEHARBOR_JWT_SECRET="$(openssl rand -base64 48)" \
  --from-literal=SPACEHARBOR_ADMIN_EMAIL="admin@example.com" \
  --from-literal=SPACEHARBOR_ADMIN_PASSWORD="$(openssl rand -base64 24)" \
  --from-literal=VAST_DATABASE_URL="https://vast-trino.example.com:8443" \
  --from-literal=VAST_ACCESS_KEY="..." \
  --from-literal=VAST_SECRET_KEY="..." \
  --from-literal=SPACEHARBOR_S3_ACCESS_KEY_ID="..." \
  --from-literal=SPACEHARBOR_S3_SECRET_ACCESS_KEY="..."

helm install spaceharbor deploy/helm/spaceharbor \
  --namespace spaceharbor --create-namespace
```

## Topology

The chart deploys:

1. **spaceharbor-control-plane-worker** — `replicas: 1`, pinned. Runs all
   background timers (audit retention, lease reaping, rate limiter,
   trigger consumer, dispatch poller, Kafka subscriber). Uses
   `strategy: Recreate` to avoid a second worker running during rollouts.

2. **spaceharbor-control-plane-http** — horizontally scalable HTTP-only
   pods. Runs with `SPACEHARBOR_BACKGROUND_WORKER=false`. `RollingUpdate`
   with `maxUnavailable: 0` keeps capacity during deploys.

3. **spaceharbor-web-ui** — stateless nginx + Vite build.

4. **Ingress** — routes `/api/`, `/health`, `/metrics`, `/webhooks/` to
   the control-plane service; everything else to web-ui.

## Values worth reviewing

| Key | Default | Notes |
|-----|---------|-------|
| `controlPlane.replicas` | 3 | Total including the 1 worker; HTTP replicas = `replicas - 1` |
| `controlPlane.otlpEndpoint` | `""` | Set to an OTLP/HTTP URL to enable tracing |
| `controlPlane.prometheus.scrape` | true | Emits standard `prometheus.io/scrape` pod annotations |
| `ingress.host` | `spaceharbor.example.com` | Change per-env |
| `autoscaling.enabled` | false | Enable HPA on the HTTP pods only |

## Secrets: External Secrets Operator

If your cluster uses External Secrets Operator, replace the direct
`kubectl create secret` step with an `ExternalSecret` resource — see
`examples/external-secret.yaml` (TODO).

The important contract is a Kubernetes Secret named
`{{ .Values.controlPlane.envFromSecret }}` (default
`spaceharbor-secrets`) whose keys match the env vars listed in the
chart README. The chart doesn't care where the secret data comes from.

## Upgrading

```bash
helm upgrade spaceharbor deploy/helm/spaceharbor -n spaceharbor
```

The worker pod uses `Recreate` strategy — expect a brief (≤30 s) gap
in background timer activity during rollout. HTTP pods stay up.

## Uninstall

```bash
helm uninstall spaceharbor -n spaceharbor
```

Leaves the PVC by design (settings-data) — remove manually if
permanently deleting.
