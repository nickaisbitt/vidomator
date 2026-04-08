#!/bin/bash

# MASTER DEPLOYMENT SCRIPT - VIDOMATOR
# This script automates everything possible
# User must complete OAuth step manually

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "═══════════════════════════════════════════════════════"
echo "  VIDOMATOR - Automated YouTube News System"
echo "  Deploying The Update Desk Automation"
echo "═══════════════════════════════════════════════════════"
echo -e "${NC}"
echo ""

# ============================================
# STEP 0: VALIDATION
# ============================================

echo -e "${BLUE}[0/7] Validating environment...${NC}"

if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ Error: Must run from vidomator directory${NC}"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18+ required${NC}"
    echo "Install from: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✓ Environment validated${NC}"
echo ""

# ============================================
# STEP 1: INSTALL DEPENDENCIES
# ============================================

echo -e "${BLUE}[1/7] Installing dependencies...${NC}"

cd scripts
npm install --silent
cd ..

echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# ============================================
# STEP 2: GET YOUTUBE REFRESH TOKEN
# ============================================

echo -e "${BLUE}[2/7] Setting up YouTube authentication...${NC}"
echo ""
echo -e "${YELLOW}⚠️  MANUAL STEP REQUIRED${NC}"
echo ""
echo "I'm going to start the OAuth server. You'll need to:"
echo "  1. Open the URL shown below in your browser"
echo "  2. Sign in with your YouTube account"
echo "  3. Authorize the app"
echo "  4. Copy the refresh token shown"
echo ""
echo "Press Enter when ready to start..."
read

# Set credentials
export YOUTUBE_CLIENT_ID="${YOUTUBE_CLIENT_ID}"
export YOUTUBE_CLIENT_SECRET="${YOUTUBE_CLIENT_SECRET}"

echo -e "${YELLOW}Starting OAuth server...${NC}"
echo -e "${GREEN}Opening browser...${NC}"

cd scripts
timeout 120 npx ts-node get-youtube-refresh-token.ts || true
cd ..

echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  👆 COPY THE REFRESH TOKEN ABOVE${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "Paste your refresh token here and press Enter:"
read REFRESH_TOKEN

if [ -z "$REFRESH_TOKEN" ]; then
    echo -e "${RED}❌ No refresh token provided${NC}"
    echo "Run this script again when you have the token"
    exit 1
fi

echo -e "${GREEN}✓ Refresh token received${NC}"
echo ""

# ============================================
# STEP 3: RAILWAY SETUP
# ============================================

echo -e "${BLUE}[3/7] Setting up Railway...${NC}"

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Login
echo "Please login to Railway:"
railway login

# Create project
echo "Creating project 'Vidomator'..."
railway init --name Vidomator

echo -e "${GREEN}✓ Railway project created${NC}"
echo ""

# ============================================
# STEP 4: SET ENVIRONMENT VARIABLES
# ============================================

echo -e "${BLUE}[4/7] Configuring environment variables...${NC}"

# Core APIs
railway variables set SPEECHIFY_API_KEY="${SPEECHIFY_API_KEY}"
railway variables set OPENROUTER_API_KEY="${OPENROUTER_API_KEY}"
railway variables set PEXELS_API_KEY="${PEXELS_API_KEY}"
railway variables set PIXABAY_API_KEY="${PIXABAY_API_KEY}"

# BytePlus/Seedance
railway variables set BYTEPLUS_ACCESS_KEY="${BYTEPLUS_ACCESS_KEY}"
railway variables set BYTEPLUS_SECRET_KEY="${BYTEPLUS_SECRET_KEY}"

# YouTube
railway variables set YOUTUBE_CLIENT_ID="${YOUTUBE_CLIENT_ID}"
railway variables set YOUTUBE_CLIENT_SECRET="${YOUTUBE_CLIENT_SECRET}"
railway variables set YOUTUBE_REFRESH_TOKEN="$REFRESH_TOKEN"

# Generate secure passwords
echo "Generating secure credentials..."
N8N_PASSWORD=$(openssl rand -base64 32)
N8N_ENCRYPTION=$(openssl rand -hex 32)

railway variables set N8N_BASIC_AUTH_USER="admin"
railway variables set N8N_BASIC_AUTH_PASSWORD="$N8N_PASSWORD"
railway variables set N8N_ENCRYPTION_KEY="$N8N_ENCRYPTION"

# Save credentials locally
mkdir -p .secrets
cat > .secrets/credentials.txt << EOF
VIDOMATOR DEPLOYMENT CREDENTIALS
================================
Generated: $(date)

n8n Access:
  URL: https://<will-be-shown-after-deploy>
  Username: admin
  Password: $N8N_PASSWORD

YouTube:
  Refresh Token: $REFRESH_TOKEN

Security Keys:
  Encryption Key: $N8N_ENCRYPTION

KEEP THIS FILE SECURE!
EOF

echo -e "${GREEN}✓ Environment variables set${NC}"
echo -e "${YELLOW}  Credentials saved to: .secrets/credentials.txt${NC}"
echo ""

# ============================================
# STEP 5: DEPLOY
# ============================================

echo -e "${BLUE}[5/7] Deploying to Railway...${NC}"
echo "This will take 5-10 minutes..."
echo ""

railway up

echo -e "${GREEN}✓ Initial deployment complete${NC}"
echo ""

# ============================================
# STEP 6: CONFIGURE DOMAIN
# ============================================

echo -e "${BLUE}[6/7] Configuring domain...${NC}"

# Get domain
RAILWAY_DOMAIN=$(railway domain 2>/dev/null || echo "")

if [ -n "$RAILWAY_DOMAIN" ]; then
    echo "Domain: $RAILWAY_DOMAIN"
    railway variables set N8N_HOST="$RAILWAY_DOMAIN"
    railway variables set N8N_PROTOCOL="https"
    railway variables set WEBHOOK_URL="https://$RAILWAY_DOMAIN"
    
    # Update credentials file
    sed -i.bak "s|https://<will-be-shown-after-deploy>|https://$RAILWAY_DOMAIN|g" .secrets/credentials.txt
    rm .secrets/credentials.txt.bak
    
    echo -e "${GREEN}✓ Domain configured${NC}"
    
    # Redeploy with domain
    echo "Redeploying with domain configuration..."
    railway up
else
    echo -e "${YELLOW}⚠️  Could not get domain automatically${NC}"
    echo "Check Railway dashboard and manually set:"
    echo "  N8N_HOST=<your-domain>"
    echo "  WEBHOOK_URL=https://<your-domain>"
fi

echo ""

# ============================================
# STEP 7: TEST VOICE
# ============================================

echo -e "${BLUE}[7/7] Testing voice configuration...${NC}"

cd scripts
export SPEECHIFY_API_KEY="${SPEECHIFY_API_KEY}"
npm run test-voices 2>&1 | tee ../.secrets/voice-test.log

cd ..

if [ -f "test-output/voice_nick.mp3" ]; then
    echo -e "${GREEN}✓ Voice test successful${NC}"
    echo "  Test audio: test-output/voice_nick.mp3"
else
    echo -e "${YELLOW}⚠️  Voice test may have failed${NC}"
    echo "  Check: .secrets/voice-test.log"
fi

echo ""

# ============================================
# DEPLOYMENT COMPLETE
# ============================================

echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "📋 NEXT STEPS (Manual - ~10 minutes):"
echo ""
echo "1. Access n8n:"
if [ -n "$RAILWAY_DOMAIN" ]; then
    echo "   URL: https://$RAILWAY_DOMAIN"
else
    echo "   URL: Check Railway dashboard for domain"
fi
echo "   Username: admin"
echo "   Password: $N8N_PASSWORD"
echo ""
echo "2. Import Workflows:"
echo "   - Go to Workflows → Import"
echo "   - Import all 3 files from n8n-workflows/"
echo ""
echo "3. Configure YouTube Credential:"
echo "   - Settings → Credentials → Add"
echo "   - Search 'YouTube OAuth2 API'"
echo "   - Client ID: $YOUTUBE_CLIENT_ID"
echo "   - Client Secret: $YOUTUBE_CLIENT_SECRET"
echo "   - Refresh Token: $REFRESH_TOKEN"
echo ""
echo "4. Activate:"
echo "   - Open '01 - Scheduler' workflow"
echo "   - Toggle 'Active' switch"
echo ""
echo "📊 DEPLOYMENT SUMMARY:"
echo "═══════════════════════════════════════════════════════"
echo "Project: Vidomator"
echo "Status: Deployed"
if [ -n "$RAILWAY_DOMAIN" ]; then
    echo "Domain: https://$RAILWAY_DOMAIN"
fi
echo "Videos/Day: 8 (every 3 hours)"
echo "Voice: nick"
echo "Cost: ~$47/month"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "📁 Important Files:"
echo "  Credentials: .secrets/credentials.txt"
echo "  Voice Test: test-output/voice_nick.mp3"
echo "  Voice Log: .secrets/voice-test.log"
echo ""
echo -e "${GREEN}🎉 First video will be live within 3 hours!${NC}"
echo ""
echo "Need help? Check:"
echo "  - docs/setup.md (detailed guide)"
echo "  - docs/testing.md (testing guide)"
echo "  - README.md (full documentation)"
echo ""
