#!/bin/bash

# Vidomator Complete Deployment Script
# This script automates the entire deployment process

set -e  # Exit on any error

echo "🚀 Vidomator - Complete Deployment Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running in correct directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ Error: docker-compose.yml not found${NC}"
    echo "Please run this script from the vidomator directory"
    exit 1
fi

echo "📋 Step 1: Environment Setup"
echo "----------------------------"

# Check for required environment variables
if [ -z "$YOUTUBE_CLIENT_ID" ]; then
    echo -e "${YELLOW}⚠️  YOUTUBE_CLIENT_ID not set${NC}"
    echo "Setting default..."
    export YOUTUBE_CLIENT_ID="${YOUTUBE_CLIENT_ID}"
fi

if [ -z "$YOUTUBE_CLIENT_SECRET" ]; then
    echo -e "${YELLOW}⚠️  YOUTUBE_CLIENT_SECRET not set${NC}"
    echo "Setting default..."
    export YOUTUBE_CLIENT_SECRET="${YOUTUBE_CLIENT_SECRET}"
fi

echo -e "${GREEN}✓ Environment variables configured${NC}"
echo ""

echo "📋 Step 2: Check Prerequisites"
echo "------------------------------"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found. Please install npm${NC}"
    exit 1
fi

# Check for Railway CLI
if ! command -v railway &> /dev/null; then
    echo -e "${YELLOW}⚠️  Railway CLI not found. Installing...${NC}"
    npm install -g @railway/cli
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

echo "📋 Step 3: Install Dependencies"
echo "-------------------------------"

cd scripts
npm install
cd ..

echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

echo "📋 Step 4: Get YouTube Refresh Token"
echo "-------------------------------------"
echo "This will open a browser for YouTube authorization."
echo "Please authorize the app and copy the refresh token."
echo ""

read -p "Press Enter to continue or 'skip' to skip this step: " skip_token

if [ "$skip_token" != "skip" ]; then
    cd scripts
    npm run youtube-auth
    cd ..
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT: Copy the refresh token above and save it!${NC}"
    echo "You'll need to add it to Railway environment variables."
    echo ""
    read -p "Press Enter when you've saved the refresh token..."
else
    echo -e "${YELLOW}⚠️  Skipping YouTube auth. Make sure you already have a refresh token.${NC}"
fi

echo ""
echo "📋 Step 5: Railway Login"
echo "------------------------"

railway login

echo -e "${GREEN}✓ Logged in to Railway${NC}"
echo ""

echo "📋 Step 6: Create Railway Project"
echo "----------------------------------"

echo "Creating project 'Vidomator'..."
railway init --name Vidomator

echo -e "${GREEN}✓ Project created${NC}"
echo ""

echo "📋 Step 7: Set Environment Variables"
echo "-------------------------------------"
echo "Adding all required environment variables to Railway..."
echo ""

# Core API Keys
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

# Generate secure passwords
N8N_PASSWORD=$(openssl rand -base64 32)
N8N_ENCRYPTION=$(openssl rand -hex 32)

railway variables set N8N_BASIC_AUTH_USER="admin"
railway variables set N8N_BASIC_AUTH_PASSWORD="$N8N_PASSWORD"
railway variables set N8N_ENCRYPTION_KEY="$N8N_ENCRYPTION"

echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: You need to manually add YOUTUBE_REFRESH_TOKEN${NC}"
echo "Run: railway variables set YOUTUBE_REFRESH_TOKEN=your_refresh_token_here"
echo ""
read -p "Press Enter when you've added the refresh token..."

echo -e "${GREEN}✓ Environment variables set${NC}"
echo ""

echo "📋 Step 8: Deploy to Railway"
echo "-----------------------------"
echo "This may take 5-10 minutes..."
echo ""

railway up

echo -e "${GREEN}✓ Deployment complete!${NC}"
echo ""

echo "📋 Step 9: Get Railway Domain"
echo "-----------------------------"
echo "Fetching your Railway domain..."
echo ""

RAILWAY_DOMAIN=$(railway domain 2>/dev/null || echo "")

if [ -n "$RAILWAY_DOMAIN" ]; then
    echo "Your domain: $RAILWAY_DOMAIN"
    railway variables set N8N_HOST="$RAILWAY_DOMAIN"
    railway variables set N8N_PROTOCOL="https"
    railway variables set WEBHOOK_URL="https://$RAILWAY_DOMAIN"
    echo -e "${GREEN}✓ Domain configured${NC}"
else
    echo -e "${YELLOW}⚠️  Could not fetch domain automatically${NC}"
    echo "Please check Railway dashboard and manually set:"
    echo "  N8N_HOST=<your-domain>"
    echo "  WEBHOOK_URL=https://<your-domain>"
fi

echo ""
echo "📋 Step 10: Final Deployment"
echo "----------------------------"
echo "Redeploying with domain configuration..."
echo ""

railway up

echo -e "${GREEN}✓ Final deployment complete!${NC}"
echo ""

echo "=========================================="
echo "🎉 Deployment Summary"
echo "=========================================="
echo ""
echo "n8n URL: https://$RAILWAY_DOMAIN (or check Railway dashboard)"
echo "Render Service: https://$RAILWAY_DOMAIN:3000 (internal)"
echo ""
echo "n8n Credentials:"
echo "  Username: admin"
echo "  Password: $N8N_PASSWORD"
echo ""
echo "Next Steps:"
echo "1. Access n8n at your Railway domain"
echo "2. Import the 3 workflow JSON files from n8n-workflows/"
echo "3. Configure YouTube OAuth2 credential in n8n"
echo "4. Activate the '01 - Scheduler' workflow"
echo "5. Run: npm run test-voices (optional, using 'nick' voice)"
echo ""
echo "Documentation:"
echo "- Full guide: docs/setup.md"
echo "- README: README.md"
echo ""
echo -e "${GREEN}✅ Vidomator is ready to automate your YouTube channel!${NC}"
echo ""
