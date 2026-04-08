# Detailed Setup Guide

## Step-by-Step Deployment

### Phase 1: Local Setup (5 minutes)

1. **Install dependencies:**
```bash
cd scripts
npm install
```

2. **Get YouTube Refresh Token:**
```bash
export YOUTUBE_CLIENT_ID="YOUR_CLIENT_ID"
export YOUTUBE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
npm run youtube-auth
```

This will open a browser. Authorize the app and copy the refresh token.

### Phase 2: Railway Deployment (10 minutes)

1. **Install Railway CLI:**
```bash
npm install -g @railway/cli
railway login
```

2. **Create Project:**
```bash
cd ..
railway init --name Vidomator
```

3. **Add Environment Variables:**

Go to Railway dashboard → Vidomator project → Variables, and add:

```
# Core APIs
SPEECHIFY_API_KEY=oCx797g08I2OI7hIXE1HmDuEjidE_4hw6J67vtlQ8DY=
OPENROUTER_API_KEY=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
BYTEPLUS_ACCESS_KEY=YOUR_BYTEPLUS_ACCESS_KEY
BYTEPLUS_SECRET_KEY=TURObU56Qm1aakE0WWpJMU5EZzFZV0UzWmpFNE5USTNOVGc0T0dKaE56VQ==
PEXELS_API_KEY=847frI44WssyMTSu7gBDI3NZ6ALHZbLkiNlOO59yeqmIl9bfSPVHasKO
PIXABAY_API_KEY=43904947-bad86e055a5a8feabbaab4f17

# YouTube
YOUTUBE_CLIENT_ID=YOUR_CLIENT_ID
YOUTUBE_CLIENT_SECRET=YOUR_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN=<paste from Phase 1>

# Security (generate these)
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<openssl rand -base64 32>
N8N_ENCRYPTION_KEY=<openssl rand -hex 32>

# Domain (will be set after first deploy)
N8N_HOST=<your-railway-domain>.up.railway.app
N8N_PROTOCOL=https
WEBHOOK_URL=https://<your-railway-domain>.up.railway.app
```

4. **Deploy:**
```bash
railway up
```

5. **Get Domain:**
After deployment, Railway will assign a domain. Copy it and update:
- `N8N_HOST`
- `WEBHOOK_URL`

Then redeploy:
```bash
railway up
```

### Phase 3: n8n Setup (15 minutes)

1. **Access n8n:**
```
https://<your-domain>.up.railway.app
```

2. **Login with credentials:**
- Username: `admin` (or what you set)
- Password: Your `N8N_BASIC_AUTH_PASSWORD`

3. **Import Workflows:**
- Go to Workflows
- Click "Import"
- Upload all three files from `n8n-workflows/`

4. **Configure YouTube Credential:**
- Go to Settings → Credentials
- Click "Add Credential"
- Search for "YouTube OAuth2 API"
- Fill in:
  - Client ID: Your YouTube client ID
  - Client Secret: Your YouTube client secret
  - Refresh Token: Your refresh token
- Save

5. **Configure OpenRouter Credential (if needed):**
- Add Credential
- Search for "OpenAI" (OpenRouter is OpenAI-compatible)
- API Key: Your OpenRouter key
- Base URL: `https://openrouter.ai/api/v1`

### Phase 4: Testing (10 minutes)

1. **Test Voice:**
```bash
cd scripts
export SPEECHIFY_API_KEY=oCx797g08I2OI7hIXE1HmDuEjidE_4hw6J67vtlQ8DY=
npm run test-voices
```

2. **Test Render Service:**
```bash
curl https://<your-domain>.up.railway.app:3000/health
```

Should return: `{"status":"ok"}`

3. **Test BytePlus Balance:**
```bash
curl -X POST https://<your-domain>.up.railway.app:3000/check-balance
```

4. **Manual Workflow Test:**
- In n8n, open "01 - Scheduler"
- Click "Execute Workflow"
- Check execution results

### Phase 5: Go Live (2 minutes)

1. **Activate Scheduler:**
- Open "01 - Scheduler" workflow
- Toggle "Active" switch
- Workflow now runs every 3 hours automatically

2. **Monitor:**
- Check n8n Executions tab
- Check Railway logs: `railway logs`
- Check YouTube Studio for uploads

## 🎨 Customization Guide

### Change Upload Frequency

Edit "01 - Scheduler" → Cron Trigger:

| Schedule | Cron Expression | Videos/Day |
|----------|----------------|------------|
| Every 3 hours | `0 */3 * * *` | 8 |
| Every 2 hours | `0 */2 * * *` | 12 |
| Every 4 hours | `0 */4 * * *` | 6 |
| Specific times | Custom | Varies |

### Change News Sources

Edit "01 - Scheduler" → RSS Feed nodes:

**Add new source:**
1. Copy existing RSS Feed node
2. Change URL to new feed
3. Connect to "Combine & Deduplicate" node

**Popular news RSS feeds:**
- Reuters: `https://www.reutersagency.com/feed/?taxonomy=markets&post_type=reuters-best`
- BBC: `https://feeds.bbci.co.uk/news/rss.xml`
- Guardian: `https://www.theguardian.com/world/rss`
- Politico: `https://feeds.politico.com/politico/rss/politicopicks`
- AP: `https://feeds.apnews.com/apnews-generalnews`
- Al Jazeera: `https://www.aljazeera.com/xml/rss/all.xml`

### Modify Video Length

Edit "02 - Video Pipeline" → "LLM Script Prompt":

Change the requirements section:
```
- Target length: 12-20 minutes (current)
- Target length: 8-12 minutes (shorter)
- Target length: 15-25 minutes (longer)
```

### Change Thumbnail Style

Edit `render-service/src/templates/thumbnails.ts`:

In the workflow, when calling `/render`, set:
```json
{
  "thumbnail": {
    "style": "viral-news" // or "breaking", "documentary", "minimal"
  }
}
```

### Add Background Music

1. Add royalty-free music files to `/files/audio/`:
   - `background_music_1.mp3`
   - `background_music_2.mp3`
   - `background_music_3.mp3`

2. Edit render service to rotate through them

3. Adjust volume in render call:
```json
{
  "musicVolume": 0.15 // 15% volume (0.0 to 1.0)
}
```

### Change TTS Voice

After running `npm run test-voices`, update the voice_id in "02 - Video Pipeline" → "Generate TTS":

```json
{
  "voice_id": "YOUR_PREFERRED_VOICE_ID"
}
```

## 🔍 Monitoring & Debugging

### View Logs

```bash
# Railway logs
railway logs

# n8n execution logs
# In n8n UI: Executions tab

# Render service logs
curl https://<your-domain>.up.railway.app:3000/logs
```

### Check Job Status

```bash
# Check render job status
curl https://<your-domain>.up.railway.app:3000/status/<job-id>
```

### Test Individual Components

```bash
# Test image generation
curl -X POST https://<your-domain>.up.railway.app:3000/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Breaking news scene, dramatic lighting, news studio",
    "output": "/files/test_image.jpg",
    "model": "black-forest-labs/flux.2-klein-4b"
  }'

# Test Seedance video generation
curl -X POST https://<your-domain>.up.railway.app:3000/generate-seedance \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "News footage of protest, handheld camera, dusk",
    "output": "/files/test_video.mp4",
    "duration": 8
  }'
```

## 🚨 Common Issues

### "Refresh token invalid"

**Cause:** Token expired or revoked
**Fix:** Re-run `npm run youtube-auth` and update YOUTUBE_REFRESH_TOKEN

### "Quota exceeded" on YouTube

**Cause:** Daily API quota (10,000 units) exceeded
**Fix:** 
- Wait 24 hours
- Reduce upload frequency
- Request quota increase from Google

### "No videos found" in RSS

**Cause:** RSS feed URL changed or rate limited
**Fix:**
- Check RSS feed URL in browser
- Add delays between RSS fetches
- Use different feed sources

### "Render failed"

**Cause:** FFmpeg error or missing files
**Fix:**
- Check render service logs
- Verify all segments have audio files
- Check disk space: `df -h`

### "TTS failed"

**Cause:** Invalid voice ID or rate limit
**Fix:**
- Run `npm run test-voices` to verify voice
- Check Speechify dashboard for rate limits

## 📊 Performance Optimization

### Speed Up Renders

1. **Use smaller video files:**
   - Stock footage: 720p instead of 1080p
   - Shorter Seedance clips: 5s instead of 10s

2. **Reduce segments:**
   - Target 4-6 segments instead of 8-10
   - Longer segments = less transition overhead

3. **Enable parallel processing:**
   - Already enabled in workflow design
   - TTS and visual fetching run concurrently

### Reduce Costs

1. **Use cheaper models:**
   - LLM: `google/gemini-2.0-flash-exp:free` instead of paid models
   - Images: `google/gemini-2.5-flash-image` instead of Flux

2. **Reduce AI image generation:**
   - Use HTML/CSS thumbnails instead of AI images
   - Use stock photos instead of generated images

3. **Optimize Seedance usage:**
   - Only use for abstract concepts
   - Use stock video for common scenes

## 🔄 Backup & Recovery

### Backup n8n Workflows

1. Export each workflow from n8n UI
2. Save JSON files to `n8n-workflows/backup/`
3. Commit to git

### Backup Credentials

Keep a secure record of:
- All API keys
- OAuth tokens
- Railway project URL

### Recovery Steps

If Railway project is lost:
1. Create new Railway project
2. Redeploy from git
3. Re-add environment variables
4. Re-import workflows
5. Reconfigure credentials

## 📝 Updating the System

### Update n8n

Edit `docker-compose.yml`:
```yaml
image: n8nio/n8n:1.104.0  # Update version number
```

Then:
```bash
railway up
```

### Update Render Service

1. Make code changes
2. Test locally (if possible)
3. Commit and push
4. Railway auto-deploys

### Update Workflows

1. Modify workflow in n8n UI
2. Export workflow JSON
3. Replace file in `n8n-workflows/`
4. Commit to git

## 🎯 Success Metrics

Track these to measure success:

| Metric | Target | How to Check |
|--------|--------|--------------|
| Videos published/day | 8 | YouTube Studio |
| Average view duration | >40% | YouTube Analytics |
| Click-through rate | >5% | YouTube Analytics |
| Upload success rate | >95% | n8n Executions |
| Cost per video | <$2 | Railway + API dashboards |

## 🚦 Next Steps After Setup

1. [ ] Monitor first 24 hours of uploads
2. [ ] Review YouTube Analytics after 1 week
3. [ ] Adjust thumbnail style based on CTR
4. [ ] Fine-tune voice selection based on feedback
5. [ ] Add more news sources if needed
6. [ ] Set up Discord notifications for errors
7. [ ] Create backup workflow exports

---

**Questions?** Check the README.md or troubleshooting docs.
