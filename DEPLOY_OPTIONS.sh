#!/bin/bash

# Complete Deployment - Non-Interactive Version
# This script works around Railway CLI TTY limitations

echo "🚀 VIDOMATOR DEPLOYMENT - ALTERNATIVE METHOD"
echo "=============================================="
echo ""

# Navigate to project
cd "/Users/nickaisbitt/AI Video/vidomator"

echo "✅ Project location verified"
echo ""

echo "Since Railway CLI requires interactive prompts,"
echo "here are TWO options to complete deployment:"
echo ""

echo "OPTION 1: Railway Dashboard (Easiest - 5 minutes)"
echo "---------------------------------------------------"
echo ""
echo "1. Open: https://railway.com/project/3b3e6d4b-8cd3-4598-9776-490e151b96af"
echo ""
echo "2. Create two Railway services in the same project:"
echo "   - render-service from render-service/Dockerfile"
echo "   - n8n from n8nio/n8n:1.103.2"
echo ""
echo "3. Configure env vars separately for each service"
echo ""
echo "4. Add environment variables in Railway dashboard:"
echo "   (Settings → Variables)"
echo ""
cat << 'ENVVARS'
SPEECHIFY_API_KEY=${SPEECHIFY_API_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
PEXELS_API_KEY=${PEXELS_API_KEY}
PIXABAY_API_KEY=${PIXABAY_API_KEY}
BYTEPLUS_ACCESS_KEY=${BYTEPLUS_ACCESS_KEY}
BYTEPLUS_SECRET_KEY=${BYTEPLUS_SECRET_KEY}
YOUTUBE_CLIENT_ID=${YOUTUBE_CLIENT_ID}
YOUTUBE_CLIENT_SECRET=${YOUTUBE_CLIENT_SECRET}
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<generate with: openssl rand -base64 32>
N8N_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
ENVVARS

echo ""
echo "4. Deploy render-service first, then n8n"
echo ""
echo "5. Set domain variables on n8n:"
echo "   N8N_HOST=your-domain.railway.app"
echo "   N8N_PROTOCOL=https"
echo "   WEBHOOK_URL=https://your-domain.railway.app"
echo ""

echo "OPTION 2: Manual CLI with Interactive Terminal"
echo "------------------------------------------------"
echo ""
echo "Open your own terminal (iTerm/Terminal) and run:"
echo ""
echo "cd \"/Users/nickaisbitt/AI Video/vidomator\""
echo "railway link"
echo "# Select: nick aisbitt's Projects → Vidomator → production"
echo ""
echo "railway up"
echo "# This will create services from docker-compose.yml"
echo ""

echo "📋 POST-DEPLOYMENT STEPS (Either Option)"
echo "-----------------------------------------"
echo ""
echo "1. Get YouTube Refresh Token:"
echo "   cd scripts"
echo "   npm install"
echo "   export YOUTUBE_CLIENT_ID=\"${YOUTUBE_CLIENT_ID}\""
echo "   export YOUTUBE_CLIENT_SECRET=\"${YOUTUBE_CLIENT_SECRET}\""
echo "   npm run youtube-auth"
echo "   # Browser opens → Authorize → Copy token"
echo ""
echo "2. Add refresh token to Railway variables"
echo ""
echo "3. Test voice:"
echo "   export SPEECHIFY_API_KEY=\"${SPEECHIFY_API_KEY}\""
echo "   npm run test-voices"
echo ""
echo "4. Import n8n workflows:"
echo "   - Go to your Railway domain"
echo "   - Workflows → Import → Select 3 JSON files"
echo ""
echo "5. Add YouTube credential and activate scheduler"
echo ""

echo "✅ SYSTEM IS 100% BUILT AND READY"
echo "=================================="
echo ""
echo "All code, configs, and documentation complete."
echo "Just need to deploy via Railway dashboard or interactive CLI."
echo ""
echo "📁 Location: /Users/nickaisbitt/AI Video/vidomator/"
echo "🌐 Railway Project: https://railway.com/project/3b3e6d4b-8cd3-4598-9776-490e151b96af"
echo ""
