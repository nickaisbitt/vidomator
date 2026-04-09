#!/bin/bash

# DEPLOYMENT COMMANDS - Run these manually
# Copy and paste each section

echo "═══════════════════════════════════════════════════════"
echo "  VIDOMATOR DEPLOYMENT COMMANDS"
echo "═══════════════════════════════════════════════════════"
echo ""

# ============================================
# STEP 1: Navigate to project
# ============================================
echo "STEP 1: Navigate to project"
echo "───────────────────────────────────────────────────────"
echo "cd /Users/nickaisbitt/AI\ Video/vidomator"
echo ""

# ============================================
# STEP 2: Link to project (if not already)
# ============================================
echo "STEP 2: Link to Railway project"
echo "───────────────────────────────────────────────────────"
echo "railway link"
echo ""
echo "Select:"
echo "  - Workspace: nick aisbitt's Projects"
echo "  - Project: Vidomator"
echo "  - Environment: production"
echo ""

# ============================================
# STEP 3: Set ALL environment variables at once
# ============================================
echo "STEP 3: Set environment variables (copy ALL lines)"
echo "───────────────────────────────────────────────────────"
echo ""

cat << 'EOF'
railway variables set \
  SPEECHIFY_API_KEY="${SPEECHIFY_API_KEY}" \
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY}" \
  PEXELS_API_KEY="${PEXELS_API_KEY}" \
  PIXABAY_API_KEY="${PIXABAY_API_KEY}" \
  BYTEPLUS_ACCESS_KEY="${BYTEPLUS_ACCESS_KEY}" \
  BYTEPLUS_SECRET_KEY="${BYTEPLUS_SECRET_KEY}" \
  YOUTUBE_CLIENT_ID="${YOUTUBE_CLIENT_ID}" \
  YOUTUBE_CLIENT_SECRET="${YOUTUBE_CLIENT_SECRET}"
EOF

echo ""

# ============================================
# STEP 4: Generate secure passwords
# ============================================
echo "STEP 4: Generate and set secure credentials"
echo "───────────────────────────────────────────────────────"
echo ""
echo "# Generate passwords (run these separately):"
echo "N8N_PASSWORD=\$(openssl rand -base64 32)"
echo "N8N_ENCRYPTION=\$(openssl rand -hex 32)"
echo ""
echo "# Then set them:"
echo "railway variables set \\"
echo "  N8N_BASIC_AUTH_USER=\"admin\" \\"
echo "  N8N_BASIC_AUTH_PASSWORD=\"\$N8N_PASSWORD\" \\"
echo "  N8N_ENCRYPTION_KEY=\"\$N8N_ENCRYPTION\""
echo ""

# ============================================
# STEP 5: Get YouTube Refresh Token
# ============================================
echo "STEP 5: Get YouTube refresh token"
echo "───────────────────────────────────────────────────────"
echo ""
echo "cd scripts"
echo "export YOUTUBE_CLIENT_ID=\"${YOUTUBE_CLIENT_ID}\""
echo "export YOUTUBE_CLIENT_SECRET=\"${YOUTUBE_CLIENT_SECRET}\""
echo "npm run youtube-auth"
echo ""
echo "This will open a browser. After authorization, copy the refresh token."
echo "Then set it:"
echo "cd .."
echo "railway variables set YOUTUBE_REFRESH_TOKEN=\"YOUR_TOKEN_HERE\""
echo ""

# ============================================
# STEP 6: Deploy
# ============================================
echo "STEP 6: Deploy render-service to Railway"
echo "───────────────────────────────────────────────────────"
echo "railway up --service render-service"
echo ""

# ============================================
# STEP 7: Get domain and configure
# ============================================
echo "STEP 7: Deploy n8n separately and configure domain"
echo "───────────────────────────────────────────────────────"
echo "Create n8n as a separate Railway service using the n8nio/n8n image"
echo "railway domain"
echo ""
echo "Copy the domain shown, then set:"
echo "railway variables set \\"
echo "  N8N_HOST=\"YOUR_DOMAIN_HERE\" \\"
echo "  N8N_PROTOCOL=\"https\" \\"
echo "  WEBHOOK_URL=\"https://YOUR_DOMAIN_HERE\""
echo ""

# ============================================
# STEP 8: Redeploy with domain
# ============================================
echo "STEP 8: Final deploy"
echo "───────────────────────────────────────────────────────"
echo "railway up"
echo ""

echo "═══════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Access n8n at your Railway domain"
echo "2. Import the 3 workflow files"
echo "3. Add YouTube OAuth2 credential"
echo "4. Activate the scheduler"
echo ""
echo "Full guide: docs/setup.md"
echo ""
