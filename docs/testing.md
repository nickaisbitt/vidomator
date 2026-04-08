# Testing & Validation Guide

This guide walks you through testing each component of Vidomator before going live.

## Pre-Deployment Testing

### 1. Test Speechify Voice ("nick")

Before deploying, verify the "nick" voice works:

```bash
cd vidomator/scripts
npm install

# Set your Speechify API key
export SPEECHIFY_API_KEY="YOUR_SPEECHIFY_KEY"

# Test the voice
npm run test-voices
```

**Expected output:**
```
🎤 Speechify Voice Tester
==================================================

🎙️  Testing: Nick (Primary)
   Description: Male, professional news anchor style - REQUESTED BY USER
   Voice ID: nick
   ✅ Saved: ../test-output/voice_nick.mp3

==================================================
📊 Results Summary

✅ Successful: 1/1
```

**Listen to the sample:**
```bash
open test-output/voice_nick.mp3  # macOS
# or
vlc test-output/voice_nick.mp3   # Linux with VLC
```

If the voice doesn't work, you'll get an error. Common issues:
- Invalid voice ID (check Speechify dashboard)
- API rate limit (wait a few minutes)
- Network issues (check connection)

### 2. Verify All Credentials

Run this checklist before deployment:

```bash
cd vidomator

# Check each credential is set
echo "Checking credentials..."
echo "Speechify: ${SPEECHIFY_API_KEY:0:10}..."
echo "OpenRouter: ${OPENROUTER_API_KEY:0:15}..."
echo "YouTube Client ID: ${YOUTUBE_CLIENT_ID:0:20}..."
echo "BytePlus Access Key: ${BYTEPLUS_ACCESS_KEY:0:15}..."
```

You should see partial values for each. If any are blank, you need to set them.

### 3. Test Docker Build Locally (Optional)

If you have Docker installed, test the build:

```bash
cd vidomator/render-service

# Build the image
docker build -t vidomator-render:test .

# Test it runs
docker run -p 3000:3000 \
  -e SPEECHIFY_API_KEY="YOUR_SPEECHIFY_KEY" \
  -e OPENROUTER_API_KEY="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" \
  vidomator-render:test

# In another terminal, test health endpoint
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

Press Ctrl+C to stop the container.

## Deployment Testing

### 4. Run Deployment Script

```bash
cd vidomator
./deploy.sh
```

The script will:
1. Check prerequisites
2. Get YouTube refresh token
3. Create Railway project
4. Set all environment variables
5. Deploy services
6. Configure domain

**Expected output:**
- ✅ All green checkmarks
- n8n URL displayed at the end
- Username/password shown

### 5. Post-Deployment Tests

After deployment completes, run these tests:

#### Test A: Render Service Health

```bash
# Get your Railway domain from dashboard or:
railway domain

# Test health endpoint
curl https://<your-domain>/health
# Expected: {"status":"ok"}
```

#### Test B: n8n Access

1. Open browser to `https://<your-domain>`
2. Login with credentials from deployment output
3. You should see empty workflows page

#### Test C: Import Workflows

1. In n8n, click "Workflows"
2. Click "Import"
3. Import all three files from `n8n-workflows/`:
   - `01-scheduler.json`
   - `02-video-pipeline.json`
   - `03-youtube-publisher.json`

You should see 3 workflows listed.

#### Test D: Configure YouTube Credential

1. Settings → Credentials
2. Add Credential
3. Search "YouTube OAuth2 API"
4. Fill in:
   - Client ID: `YOUR_CLIENT_ID`
   - Client Secret: `YOUR_CLIENT_SECRET`
   - Refresh Token: (from deployment step)
5. Save

#### Test E: Test OpenRouter Connection

1. Settings → Credentials
2. Add Credential
3. Search "OpenAI" (OpenRouter uses OpenAI format)
4. API Key: `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`
5. Base URL: `https://openrouter.ai/api/v1`
6. Save

## Workflow Testing

### 6. Manual Workflow Test

Before activating the scheduler, test each workflow manually:

#### Test Scheduler (01)

1. Open "01 - Scheduler" workflow
2. Click "Execute Workflow"
3. Wait 1-2 minutes
4. Check Executions tab
5. You should see:
   - RSS feeds fetched
   - Stories scored
   - Top stories selected

**Expected result:** At least one story should pass through to the video pipeline.

#### Test Video Pipeline (02)

1. Open "02 - Video Pipeline" workflow
2. Manually trigger with test data:

```json
{
  "title": "Test News Story",
  "link": "https://example.com/test-news",
  "source": "Test Source",
  "content": "This is a test news story for validation purposes. The system should generate a script and attempt to create a video."
}
```

3. Click "Execute Workflow"
4. Monitor progress in Executions tab

**Expected timeline:**
- 0-30s: Article fetched, script generated
- 30-60s: TTS generated
- 60-120s: Visuals fetched/generated
- 120-300s: Video rendered
- 300s+: Upload to YouTube

**What to check:**
- Green nodes = success
- Red nodes = error (check error message)
- No infinite loops or timeouts

#### Test YouTube Publisher (03)

1. Open "03 - YouTube Publisher"
2. Test with mock data (won't actually upload without real video):

```json
{
  "output": "/files/test_output.mp4",
  "thumbnail": {
    "output": "/files/test_thumb.jpg"
  },
  "youtubeTitle": "TEST VIDEO - PLEASE DELETE",
  "description": "This is a test video for system validation.",
  "tags": ["test"],
  "videoId": "test123"
}
```

3. Execute workflow

**Expected:** Workflow should attempt upload but may fail if test files don't exist. That's OK - we just want to verify the credential connection.

### 7. End-to-End Test

Once individual workflows pass, do a full test:

1. Open "01 - Scheduler"
2. Execute workflow
3. Let it trigger "02 - Video Pipeline" automatically
4. Let that trigger "03 - YouTube Publisher"
5. Monitor for 10-15 minutes

**Success indicators:**
- Video appears in YouTube Studio
- Thumbnail is set
- Title/description match
- Video is public

**If successful:** Delete the test video from YouTube Studio.

## Production Activation

### 8. Activate Scheduler

1. Open "01 - Scheduler"
2. Toggle "Active" switch in top-right
3. Workflow now runs every 3 hours automatically

### 9. Monitor First 24 Hours

Check these metrics:

| Time | Check | Expected |
|------|-------|----------|
| 0-3h | First execution | 1 video uploaded |
| 3-6h | Second execution | 2 videos total |
| 6-24h | Continued execution | 8 videos total |

**Where to check:**
- n8n: Executions tab (all green)
- YouTube Studio: Content tab (videos appearing)
- Railway: Logs (no errors)

### 10. Verify Video Quality

Watch at least one full video and check:

- [ ] Audio is clear ("nick" voice audible)
- [ ] No long silences
- [ ] Visuals match content
- [ ] Lower thirds appear correctly
- [ ] Thumbnail looks professional
- [ ] Title is engaging
- [ ] Duration is 10-20 minutes

## Troubleshooting Common Issues

### Issue: "Voice nick not found"

**Solution:**
The "nick" voice ID may not exist in your Speechify account. 

1. Check available voices: Log into Speechify dashboard
2. Find a voice ID that works
3. Update workflow: Edit "02 - Video Pipeline" → "Generate TTS" node
4. Change `voice_id` from "nick" to your preferred voice ID

### Issue: "Quota exceeded" on YouTube

**Solution:**
You've hit the daily API limit (10,000 units).

1. Wait 24 hours
2. Reduce upload frequency (change cron from every 3h to every 4h)
3. Or request quota increase from Google Cloud Console

### Issue: Videos not rendering

**Solution:**
Check Railway logs:
```bash
railway logs
```

Common causes:
- Missing audio files (TTS failed)
- FFmpeg error (check render service logs)
- Disk space full (increase Railway volume)

### Issue: Thumbnails not generating

**Solution:**
1. Check Puppeteer is working:
```bash
curl -X POST https://<your-domain>/render \
  -H "Content-Type: application/json" \
  -d '{
    "output": "/files/test.mp4",
    "segments": [...],
    "thumbnail": {
      "output": "/files/test_thumb.jpg",
      "title": "Test",
      "style": "viral-news"
    }
  }'
```

2. Check Chrome/Puppeteer dependencies in Dockerfile

### Issue: RSS feeds failing

**Solution:**
Some RSS feeds may block Railway IPs or require different formats.

1. Test feeds manually:
```bash
curl https://feeds.bbci.co.uk/news/rss.xml
```

2. If blocked, try alternative feeds
3. Or use NewsAPI as backup (requires API key)

## Performance Benchmarks

After running for a week, expect:

| Metric | Target | Acceptable |
|--------|--------|------------|
| Videos/day | 8 | 6-10 |
| Upload success rate | >95% | >90% |
| Average render time | <10 min | <15 min |
| Cost/video | <$0.50 | <$0.75 |
| YouTube CTR | >5% | >3% |

## Rollback Plan

If something goes wrong:

1. **Stop uploads:**
   - n8n: Deactivate "01 - Scheduler" workflow
   - Or set YouTube videos to "Private" in YouTube Studio

2. **Check logs:**
   ```bash
   railway logs
   ```

3. **Reset if needed:**
   ```bash
   railway down
   railway up
   ```

4. **Restore workflows:**
   - Import original JSON files again
   - Reconfigure credentials

5. **Test again** before reactivating

## Success Checklist

Before considering deployment complete:

- [ ] "nick" voice tested and working
- [ ] All API credentials verified
- [ ] Railway project created
- [ ] Services deployed successfully
- [ ] n8n accessible via web
- [ ] All 3 workflows imported
- [ ] YouTube OAuth2 credential configured
- [ ] Manual workflow test passed
- [ ] End-to-end test created a video
- [ ] Scheduler workflow activated
- [ ] First automatic video uploaded
- [ ] Video quality verified
- [ ] No errors in logs

## Next Steps After Testing

1. **Monitor:** Check daily for first week
2. **Optimize:** Adjust thumbnail style based on CTR
3. **Scale:** Add more RSS sources if needed
4. **Analyze:** Review YouTube Analytics after 2 weeks
5. **Iterate:** Adjust based on performance data

---

**Remember:** You can always check `docs/setup.md` for detailed configuration options.
