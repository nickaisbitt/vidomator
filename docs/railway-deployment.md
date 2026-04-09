# Railway Deployment Checklist

## 10 Steps

1. Create or open the `Vidomator` Railway project.
2. Deploy `render-service` from `render-service/Dockerfile`.
3. Confirm `render-service` exposes port `3000` and `/health` returns `200`.
4. Create a separate Railway service for `n8n` using the `n8nio/n8n:1.103.2` image.
5. Set `n8n` env vars: `N8N_BASIC_AUTH_*`, `N8N_ENCRYPTION_KEY`, `N8N_HOST`, `N8N_PROTOCOL`, `WEBHOOK_URL`.
6. Set `render-service` env vars: `PORT`, `FILES_BASE_PATH`, and all API keys.
7. Confirm both services are on the same Railway project network.
8. Import `n8n-workflows/01-scheduler.json`, `02-video-pipeline.json`, `03-youtube-publisher.json`, `04-custom-video-creator.json`.
9. Activate `01 - Scheduler` only after one manual test passes.
10. Verify one manual render and one scheduled run end-to-end.

## Notes

- `render-service` is the only service built from this repo's `railway.json`.
- `n8n` is intentionally separate so its runtime settings do not affect the render container.
- If Railway shows n8n logs while testing render-service, the service binding is wrong.
