# Troubleshooting

Common issues and solutions.

## Service Won't Start

**Symptom:** Control-plane or Web-UI fails to start.

**Diagnosis:**

1. **Check logs:**
   ```bash
   docker compose logs control-plane --tail 50
   ```

2. **Verify ports are available:**
   ```bash
   lsof -i :3000   # Control-plane
   lsof -i :4173   # Web-UI
   ```

3. **Check prerequisites:**
   ```bash
   node --version  # Should be 18+
   npm --version   # Should be 9+
   docker ps       # Docker daemon running?
   ```

**Solutions:**

- **Port in use:** Stop conflicting service or change port:
  ```bash
  docker compose down  # Stop all services
  PORT=3001 npm run dev
  ```

- **Out of disk space:** Clean up Docker:
  ```bash
  docker system prune -a --volumes
  ```

- **Corrupted node_modules:**
  ```bash
  rm -rf node_modules
  npm ci
  npm run dev
  ```

## API Connection Failed

**Symptom:** Web UI shows "Cannot reach API" error.

**Diagnosis:**

1. **Verify API is running:**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Check network connectivity:**
   ```bash
   curl -v http://localhost:3000/api/v1/assets
   ```

3. **Review browser console:**
   - Open DevTools (F12)
   - Network tab → check for failed requests
   - Console tab → JavaScript errors

**Solutions:**

- **API not responding:**
  ```bash
  docker compose restart control-plane
  docker compose logs control-plane
  ```

- **CORS issues:**
  - Verify `SPACEHARBOR_CORS_ORIGIN` is set correctly
  - In development: `SPACEHARBOR_CORS_ORIGIN=http://localhost:4173`

- **Firewall blocking:**
  - Check inbound rules allow port 3000
  - If behind proxy, verify X-Forwarded-Proto header

## Job Stuck in Processing

**Symptom:** Asset remains in "processing" state beyond expected time.

**Diagnosis:**

1. **Check job status:**
   ```bash
   curl http://localhost:3000/api/v1/jobs/:jobId
   ```

2. **Review worker logs:**
   ```bash
   docker compose logs media-worker --tail 100
   ```

3. **Check VAST connectivity:**
   ```bash
   curl -u $VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD \
     $VAST_TRINO_ENDPOINT/v1/info
   ```

**Solutions:**

- **Worker not running:**
  ```bash
  docker compose restart media-worker
  ```

- **Lease expired (job abandoned):**
  ```bash
  curl -X POST http://localhost:3000/api/v1/queue/reap-stale
  ```

- **VAST connection lost:**
  - Verify network to VAST cluster
  - Check VAST cluster health
  - Restart control-plane once VAST is online

## DLQ Growing

**Symptom:** `GET /api/v1/dlq` shows increasing failed jobs.

**Diagnosis:**

1. **Inspect DLQ:**
   ```bash
   curl http://localhost:3000/api/v1/dlq | jq '.jobs[0].lastError'
   ```

2. **Check error patterns:**
   - All same error → systematic issue
   - Different errors → environmental problem

3. **Review audit log:**
   ```bash
   curl http://localhost:3000/api/v1/audit | jq '.events[] | select(.result == "failure")'
   ```

**Common Causes & Solutions:**

- **Timeout errors → Function is slow**
  ```bash
  # Increase timeout (seconds)
  VAST_DATAENGINE_TIMEOUT=600  # Was 300
  ```

- **"Trino connection refused" → VAST unreachable**
  - Check network connectivity to VAST cluster
  - Verify credentials in `.env`
  - Check firewall rules

- **"Out of memory" → Function needs more resources**
  - Check VAST cluster capacity
  - Reduce batch size or increase worker memory

- **After deployment → Code regression**
  ```bash
  # Rollback to previous version
  git checkout <previous-tag>
  docker compose build && docker compose up -d
  ```

**Replay jobs after fix:**

```bash
# Replay all DLQ jobs
curl -X POST http://localhost:3000/api/v1/dlq/replay-all
```

## VAST Connectivity Issues

**Symptom:** Logs show connection errors to Trino, Kafka, or DataEngine.

**Diagnosis:**

1. **Test Trino connection:**
   ```bash
   curl -u "$VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD" \
     "$VAST_TRINO_ENDPOINT/v1/info"
   ```

2. **Test Kafka connection:**
   ```bash
   nc -zv vast-broker.example.com 9092
   ```

3. **Check credentials:**
   ```bash
   cat .env | grep VAST_
   ```

**Solutions:**

- **Endpoint unreachable:**
  - Verify DNS resolves:
    ```bash
    nslookup vastdb.example.com
    ```
  - Check firewall rules
  - Verify VPN/network access

- **Authentication failed:**
  - Re-check credentials in `.env`
  - Test with VAST CLI:
    ```bash
    vastcmd cluster show -u $VAST_TRINO_USERNAME -p $VAST_TRINO_PASSWORD
    ```
  - Rotate credentials if expired

- **Connection timeout:**
  - Increase timeout:
    ```bash
    VAST_TRINO_TIMEOUT=60000  # Milliseconds
    ```
  - Check VAST cluster health
  - Review VAST cluster logs

## Web UI Not Updating in Real-Time

**Symptom:** Asset status doesn't update when job completes.

**Diagnosis:**

1. **Check API updated:**
   ```bash
   curl http://localhost:3000/api/v1/assets/:assetId
   ```

2. **Check WebSocket connection:**
   - DevTools → Network → filter "ws"
   - Should see active connection to `/events/stream`

3. **Check browser console:**
   - Are there JavaScript errors?
   - Is event data being received?

**Solutions:**

- **WebSocket not connected:**
  - Check firewall allows WebSocket
  - If behind proxy, verify it supports WebSocket
  - Restart control-plane

- **Events not flowing:**
  ```bash
  # Check event subscriber is running
  docker compose logs control-plane | grep -i "kafka\|subscriber"
  ```

- **Browser caching stale data:**
  - Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R)
  - Clear cookies: DevTools → Application → Clear Storage

## Asset Ingest Failed

**Symptom:** `POST /api/v1/assets/ingest` returns error.

**Diagnosis:**

1. **Check response error message:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/assets/ingest \
     -H "Content-Type: application/json" \
     -d '{"title": "Test", "sourceUri": "s3://bucket/test.mov"}'
   ```

2. **Verify source file exists:**
   - S3: `aws s3 ls s3://bucket/test.mov`
   - NFS: `ls /mnt/nfs/test.mov`

3. **Check permissions:**
   - Can control-plane read source file?
   - Can control-plane write to Element Store?

**Solutions:**

- **Source file not found (404):**
  - Verify URI is correct
  - Check S3 bucket name and region
  - Check NFS mount point

- **Permission denied:**
  - Verify S3 access key/secret
  - Check NFS mount permissions
  - Review VAST Catalog ACLs

- **Invalid format:**
  - Check required fields: `title`, `sourceUri`
  - Verify `sourceUri` is valid S3/NFS path

## Database Migration Failed

**Symptom:** `npm run db:install` fails with SQL errors.

**Diagnosis:**

1. **Check Trino connectivity:**
   ```bash
   curl -u $VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD \
     $VAST_TRINO_ENDPOINT/v1/info
   ```

2. **Review migration logs:**
   ```bash
   npm run db:install -- --verbose
   ```

3. **Check schema doesn't exist:**
   ```bash
   curl -u $VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD \
     "$VAST_TRINO_ENDPOINT/v1/schema" | jq '.schemas[]'
   ```

**Solutions:**

- **Trino unreachable:**
  - Verify Trino endpoint URL
  - Check network connectivity
  - Verify credentials

- **Schema already exists:**
  - Migrations are idempotent (safe to re-run)
  - Or manually drop schema: `DROP SCHEMA spaceharbor CASCADE`

- **Permission denied:**
  - Ensure VAST user has CREATE SCHEMA privilege
  - Contact VAST admin for elevated permissions

## Performance Issues

**Symptom:** API is slow or Web UI lags.

**Diagnosis:**

1. **Check API latency:**
   ```bash
   curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/api/v1/assets
   ```

2. **Check resource usage:**
   ```bash
   docker stats control-plane
   ```

3. **Check Trino query performance:**
   - Review VAST Trino dashboard
   - Look for slow queries

**Solutions:**

- **High CPU usage:**
  - Increase container CPU limit
  - Review concurrent request count
  - Enable query caching:
    ```bash
    SPACEHARBOR_QUERY_CACHE_ENABLED=true
    ```

- **High memory usage:**
  - Increase container memory limit
  - Review active WebSocket connections
  - Reduce batch sizes

- **Slow Trino queries:**
  - Add database indexes (contact VAST admin)
  - Increase `VAST_TRINO_POOL_SIZE` for more connections
  - Review VAST cluster capacity

## Authentication Issues

**Symptom:** Cannot login or "Invalid token" errors.

**Diagnosis:**

1. **Check auth mode:**
   ```bash
   curl http://localhost:3000/openapi.json | jq '.components.securitySchemes'
   ```

2. **Verify credentials:**
   - Local mode: check `SPACEHARBOR_DEFAULT_EMAIL` and password
   - JWT: check `SPACEHARBOR_JWT_SECRET` is set
   - API key: check `SPACEHARBOR_API_KEY` format (must start with `sh_`)

3. **Check login endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "dev@example.com", "password": "devpass123"}'
   ```

**Solutions:**

- **"Invalid credentials":**
  - Verify email and password match `.env`
  - Reset password via `/api/v1/auth/password-reset`

- **"Token expired":**
  - Refresh token:
    ```bash
    curl -X POST http://localhost:3000/api/v1/auth/refresh \
      -H "Authorization: Bearer $REFRESH_TOKEN"
    ```

- **OIDC not configured:**
  - Set `SPACEHARBOR_OIDC_ENABLED=true`
  - Verify OIDC provider URL and credentials

## Still Having Issues?

1. **Check documentation:**
   - [Architecture Overview](Architecture.md)
   - [Configuration Guide](Configuration-Guide.md)
   - [Deployment Guide](Deployment-Guide.md)

2. **Review logs:**
   ```bash
   docker compose logs -f --all
   ```

3. **Check VAST cluster health:**
   - Visit VAST web UI
   - Run `vastcmd cluster show`

4. **Contact support:**
   - Review internal runbooks
   - Escalate to VAST support if cluster issue
