# Vidomator - The Update Desk YouTube Automation

Automated news video generation system for "The Update Desk" YouTube channel. Generates 8 professional news videos per day using AI-powered scripting, text-to-speech, and video assembly.

## 🏗️ Architecture

```
Railway Project: Vidomator
│
├── n8n (Workflow Orchestration)
│   ├── Scheduler (RSS feeds → story selection)
│   ├── Video Pipeline (LLM → TTS → Visuals → Assembly)
│   └── YouTube Publisher (Upload + Thumbnail + Notify)
│
├── Render Service (Video Assembly)
│   ├── FFmpeg processing
│   ├── Puppeteer thumbnail generation
│   └── Visual fetching (Pexels, Pixabay, Web scraping, AI generation)
│
└── Shared Volume (/files)
    ├── /audio (TTS segments)
    ├── /video (Stock footage, Seedance clips)
    ├── /images (Web images, AI-generated thumbnails)
    ├── /temp (Processing)
    └── /output (Final MP4s)
```

## 📋 Prerequisites

- Railway.app account
- API credentials (see below)
- YouTube channel: [The Update Desk](https://youtube.com/@theupdatedesk)

## 🔑 Required API Credentials

### You Already Have:

| Service | Credential | Status |
|---------|-----------|--------|
| Railway | Account | ✅ |
| Speechify | API Key | ✅ |
| OpenRouter | API Key | ✅ |
| YouTube | OAuth Client ID + Secret | ✅ |
| BytePlus/Seedance | Access Key + Secret | ✅ |
| Pexels | API Key | ✅ |
| Pixabay | API Key | ✅ |

### Still Need:

| Service | Purpose | How to Get |
|---------|---------|------------|
| YouTube Refresh Token | Upload videos | Run `npm run youtube-auth` (see below) |

## 🚀 Quick Start (One-Command Deploy)

### Option 1: Automated Deployment (Recommended)

```bash
git clone <your-repo>
cd vidomator
./deploy.sh
```

This script automates everything:
- ✅ Installs dependencies
- ✅ Gets YouTube refresh token
- ✅ Creates Railway project
- ✅ Sets all environment variables
- ✅ Deploys services
- ✅ Configures domain

Just follow the prompts and copy your refresh token when shown!

### Option 2: Manual Deployment

If you prefer manual control:

#### 1. Get YouTube Refresh Token

```bash
cd scripts
npm install

export YOUTUBE_CLIENT_ID="YOUR_CLIENT_ID"
export YOUTUBE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
npm run youtube-auth
```

#### 2. Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init --name Vidomator
railway up
```

### 4. Configure Environment Variables

In Railway dashboard, add these environment variables:

```bash
# Required
SPEECHIFY_API_KEY=${SPEECHIFY_API_KEY}
OPENROUTER_API_KEY=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
YOUTUBE_CLIENT_ID=YOUR_CLIENT_ID
YOUTUBE_CLIENT_SECRET=YOUR_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN=<from step 2>
BYTEPLUS_ACCESS_KEY=YOUR_BYTEPLUS_ACCESS_KEY
BYTEPLUS_SECRET_KEY=TURObU56Qm1aakE0WWpJMU5EZzFZV0UzWmpFNE5USTNOVGc0T0dKaE56VQ==
PEXELS_API_KEY=847frI44WssyMTSu7gBDI3NZ6ALHZbLkiNlOO59yeqmIl9bfSPVHasKO
PIXABAY_API_KEY=43904947-bad86e055a5a8feabbaab4f17

# n8n Security (generate strong passwords)
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<generate with: openssl rand -base64 32>
N8N_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
N8N_HOST=<your-railway-domain>.up.railway.app
N8N_PROTOCOL=https
WEBHOOK_URL=https://<your-railway-domain>.up.railway.app
```

### 5. Import n8n Workflows

1. Access n8n at `https://<your-domain>.up.railway.app`
2. Login with your credentials
3. Go to Workflows → Import
4. Import the three workflow files from `n8n-workflows/`:
   - `01-scheduler.json`
   - `02-video-pipeline.json`
   - `03-youtube-publisher.json`

### 6. Configure YouTube Credentials in n8n

1. In n8n, go to Settings → Credentials
2. Add "YouTube OAuth2 API" credential
3. Fill in:
   - Client ID: Your YouTube client ID
   - Client Secret: Your YouTube client secret
   - Access Token: Leave blank (will be filled by refresh token)
   - Refresh Token: Your refresh token from step 2

### Voice Configuration

The system is configured to use **"nick"** voice as requested.

To verify it's working:

```bash
cd scripts
export SPEECHIFY_API_KEY="${SPEECHIFY_API_KEY}"
npm run test-voices
```

This will generate a test audio file with the "nick" voice.

Listen to the samples in `test-output/` and note your preferred voice ID.

### 8. Activate Workflows

1. In n8n, activate the "01 - Scheduler" workflow
2. It will run every 3 hours (8x daily)
3. Check the executions to monitor progress

## 📊 Cost Breakdown (Monthly)

| Service | Cost |
|---------|------|
| Railway (n8n + render) | ~$15 |
| Railway volume (10GB) | ~$3 |
| OpenRouter LLM | ~$15 |
| OpenRouter Images (Flux) | ~$3.50 |
| Speechify TTS | $10 |
| **Total** | **~$47/month** |

## 🔧 Customization

### Adjust Video Schedule

Edit the Cron Trigger in "01 - Scheduler" workflow:
- Current: Every 3 hours (8 videos/day)
- Format: Cron expression

### Change News Sources

Edit the RSS Feed nodes in "01 - Scheduler" workflow. Current sources:
- Reuters
- BBC
- WSJ
- Guardian
- Politico

### Modify Visual Strategy

Edit the visual fetch logic in "02 - Video Pipeline" workflow. Options:
- `stock_video` - Pexels/Pixabay
- `web_image` - Web scraping
- `seedance` - ByteDance AI video generation
- `generated_image` - Flux AI image generation

### Update Thumbnail Style

Edit `render-service/src/templates/thumbnails.ts`:
- `viral-news` - Bold, breaking news style
- `breaking` - Red alert style
- `documentary` - Professional, in-depth style
- `minimal` - Clean, simple style

## 📁 Project Structure

```
vidomator/
├── docker-compose.yml          # Railway deployment config
├── n8n-workflows/              # Importable workflow JSONs
│   ├── 01-scheduler.json
│   ├── 02-video-pipeline.json
│   └── 03-youtube-publisher.json
├── render-service/             # Video assembly API
│   ├── src/
│   │   ├── server.ts          # Express API
│   │   ├── ffmpeg.ts          # Video processing
│   │   ├── visuals/           # Image/video fetching
│   │   └── templates/         # Thumbnail generators
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── scripts/                    # Helper scripts
│   ├── get-youtube-refresh-token.ts
│   ├── test-speechify-voices.ts
│   └── package.json
└── docs/                       # Documentation
    ├── setup.md
    └── troubleshooting.md
```

## 🐛 Troubleshooting

### Videos not uploading to YouTube
- Check YOUTUBE_REFRESH_TOKEN is set correctly
- Verify YouTube API quota hasn't been exceeded (10,000 units/day)
- Check n8n execution logs for errors

### Render service failing
- Check Railway logs: `railway logs`
- Verify all environment variables are set
- Ensure /files volume has enough space

### No images being found
- Pexels/Pixabay rate limits: Wait and retry
- Web scraping blocked: Check if target sites block Railway IPs

### TTS failing
- Verify Speechify API key
- Check voice ID is valid (run test-voices script)
- Monitor Speechify rate limits

## 📞 Support

For issues or questions:
1. Check Railway logs: `railway logs`
2. Check n8n execution history
3. Review render service logs in `/files/logs/`

## 📄 License

Private - For The Update Desk use only
