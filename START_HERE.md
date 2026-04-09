# 🚀 START HERE - VIDOMATOR

## What Is This?

**Automated YouTube news channel system** for "The Update Desk"

- Generates **8 videos per day** automatically
- Uses AI to write scripts, create voiceovers, assemble videos
- Uploads directly to your YouTube channel
- **Cost: ~$47/month**

---

## ⚡ Deploy in 20 Minutes

### Step 1: Deploy render-service

```bash
cd vidomator
./INSTALL.sh
```

**What happens:**
- Opens browser for YouTube login
- Creates Railway project
- Deploys everything
- Tests the voice

**You do:**
- Click "authorize" in browser
- Copy the refresh token shown
- Paste it when asked

### Step 2: Deploy n8n separately

Use a separate Railway service for n8n with the `n8nio/n8n` image.

### Step 3: Import Workflows (5 min)

1. Go to the n8n URL shown at end
2. Login with credentials
3. Workflows → Import → Select all 3 files from `n8n-workflows/`

### Step 4: Add YouTube (2 min)

1. Settings → Credentials → Add
2. Search "YouTube OAuth2 API"
3. Paste the credentials from Step 1

### Step 5: Go Live (30 seconds)

1. Open "01 - Scheduler"
2. Toggle "Active" switch
3. **Done!**

---

## ✅ Verify It Works

```bash
./verify.sh
```

Should show: ✅ All checks passed

---

## 📖 Documentation

| File | Purpose |
|------|---------|
| `DEPLOYMENT_SUMMARY.md` | Complete overview of what I built |
| `QUICKSTART.md` | Quick reference guide |
| `README.md` | Full technical documentation |
| `docs/setup.md` | Detailed setup instructions |
| `docs/testing.md` | Testing & validation guide |

---

## 🆘 Troubleshooting

**Something broken?**

```bash
# Check status
./verify.sh

# View logs
railway logs

# Restart render-service
railway up --service render-service
```

**Still broken?**
- Check `docs/troubleshooting.md`
- Review `DEPLOYMENT_SUMMARY.md`

---

## 🎯 What's Configured

- ✅ Voice: "nick"
- ✅ Schedule: Every 3 hours (8 videos/day)
- ✅ Video length: 10-20 minutes
- ✅ Visuals: Stock + AI + Web scraping
- ✅ All API keys embedded
- ✅ Cost optimized

---

## ⏱️ Timeline

| Time | Event |
|------|-------|
| Now | Run `./INSTALL.sh` |
| 20 min | Deployment complete |
| 3 hours | First video live |
| Forever | 8 videos/day automatically |

---

## 🎉 Ready?

**Just run:**

```bash
cd vidomator && ./INSTALL.sh
```

---

*Full details in DEPLOYMENT_SUMMARY.md*
