# 🚀 Vidomator - Ready to Deploy!

## What You Have

A complete automated YouTube news video generation system:

- ✅ **8 videos per day** (every 3 hours)
- ✅ **15-minute average** (10-20 min flexible)
- ✅ **"Nick" voice** for TTS
- ✅ **Viral thumbnails** with 4 styles
- ✅ **Multiple visual sources** (stock, AI, web scraping)
- ✅ **Seedance integration** for AI video clips
- ✅ **Auto-upload to YouTube**
- ✅ **~$47/month total cost**

## Quick Start (30 minutes)

### Step 1: Deploy (10 min)

```bash
cd vidomator
./deploy.sh
```

**What this does:**
1. Gets YouTube refresh token (opens browser)
2. Creates Railway project "Vidomator"
3. Sets all environment variables
4. Deploys n8n + render service
5. Gives you the n8n URL and password

**You'll need:**
- Railway account (free to sign up)
- Your YouTube refresh token (script helps you get this)

### Step 2: Configure n8n (10 min)

1. Go to the n8n URL from deployment output
2. Login with credentials shown
3. Import 3 workflows from `n8n-workflows/` folder:
   - 01-scheduler.json
   - 02-video-pipeline.json
   - 03-youtube-publisher.json
4. Add YouTube OAuth2 credential (Settings → Credentials)
   - Client ID: `YOUR_CLIENT_ID`
   - Client Secret: `YOUR_CLIENT_SECRET`
   - Refresh Token: (from step 1)

### Step 3: Test (10 min)

```bash
cd scripts
export SPEECHIFY_API_KEY="YOUR_SPEECHIFY_KEY"
npm run test-voices
```

**Verify:**
- ✅ Test audio file created in `test-output/voice_nick.mp3`
- ✅ Sounds good when played

### Step 4: Go Live! (1 min)

1. In n8n, open "01 - Scheduler"
2. Toggle "Active" switch
3. Done! Videos will start publishing automatically

## What Happens Next

- **Every 3 hours:** Scheduler fetches news, picks best story
- **10-15 minutes later:** Video generated and uploaded
- **8 videos/day:** 24/7 automated
- **YouTube Studio:** Videos appear with titles, descriptions, thumbnails

## Monitoring

| Where | What to Check |
|-------|---------------|
| n8n Executions | Green = success, Red = error |
| Railway Dashboard | Service health, logs |
| YouTube Studio | Videos uploading |
| This folder | `test-output/` for voice tests |

## Files You Can Customize

| File | What to Edit |
|------|--------------|
| `n8n-workflows/01-scheduler.json` | RSS sources, schedule frequency |
| `n8n-workflows/02-video-pipeline.json` | Video length, voice ID, visual strategy |
| `render-service/src/templates/thumbnails.ts` | Thumbnail styles |
| `render-service/src/visuals/index.ts` | Add more image sources |

## Common Commands

```bash
# View Railway logs
railway logs

# Restart services
railway up

# Test voice again
cd scripts && npm run test-voices

# Check render service health
curl https://<your-domain>/health
```

## Troubleshooting

**"Voice not found" error:**
- Check Speechify dashboard for available voices
- Update voice_id in workflow if "nick" doesn't exist

**Videos not uploading:**
- Check YOUTUBE_REFRESH_TOKEN is set
- Verify YouTube API quota (10k/day)
- Check n8n execution logs

**Render failing:**
- Check Railway logs: `railway logs`
- Ensure all env vars are set
- Check disk space

## Documentation

- **Full Setup Guide:** `docs/setup.md`
- **Testing Guide:** `docs/testing.md`
- **README:** `README.md`

## Your API Keys (Already Configured)

All your credentials are ready:
- ✅ Speechify: `YOUR_SPEECHIFY_KEY`
- ✅ OpenRouter: `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`
- ✅ BytePlus/Seedance: Access + Secret keys provided
- ✅ Pexels: `847frI44WssyMTSu7gBDI3NZ6ALHZbLkiNlOO59yeqmIl9bfSPVHasKO`
- ✅ Pixabay: `43904947-bad86e055a5a8feabbaab4f17`
- ✅ YouTube OAuth: Client ID + Secret provided

## Support

If something breaks:
1. Check `docs/troubleshooting.md`
2. Review Railway logs: `railway logs`
3. Check n8n execution history

---

**Ready to deploy?** Run `./deploy.sh` and follow the prompts!

**Estimated time to first video:** 30-45 minutes
