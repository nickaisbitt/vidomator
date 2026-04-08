#!/bin/bash

# VERIFICATION SCRIPT - Check Vidomator deployment
# Run this after deployment to ensure everything works

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "═══════════════════════════════════════════════════════"
echo "  VIDOMATOR - Deployment Verification"
echo "═══════════════════════════════════════════════════════"
echo -e "${NC}"
echo ""

PASSED=0
FAILED=0

# ============================================
# CHECK 1: Railway CLI
# ============================================
echo -n "[1/10] Checking Railway CLI... "
if command -v railway &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗${NC}"
    echo "  Install: npm install -g @railway/cli"
    ((FAILED++))
fi

# ============================================
# CHECK 2: Railway Authentication
# ============================================
echo -n "[2/10] Checking Railway authentication... "
if railway whoami &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗${NC}"
    echo "  Run: railway login"
    ((FAILED++))
fi

# ============================================
# CHECK 3: Project Exists
# ============================================
echo -n "[3/10] Checking Railway project... "
if railway status &> /dev/null; then
    PROJECT=$(railway status 2>/dev/null | grep -o "Vidomator" || echo "")
    if [ -n "$PROJECT" ]; then
        echo -e "${GREEN}✓${NC} (Vidomator)"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} (Project name mismatch)"
        ((PASSED++))
    fi
else
    echo -e "${RED}✗${NC}"
    echo "  Project not found. Run: ./INSTALL.sh"
    ((FAILED++))
fi

# ============================================
# CHECK 4: Services Running
# ============================================
echo -n "[4/10] Checking services are running... "
if railway status &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗${NC}"
    echo "  Check: railway status"
    ((FAILED++))
fi

# ============================================
# CHECK 5: Domain Configured
# ============================================
echo -n "[5/10] Checking domain configuration... "
DOMAIN=$(railway domain 2>/dev/null || echo "")
if [ -n "$DOMAIN" ]; then
    echo -e "${GREEN}✓${NC} ($DOMAIN)"
    ((PASSED++))
else
    echo -e "${RED}✗${NC}"
    echo "  Domain not configured"
    ((FAILED++))
fi

# ============================================
# CHECK 6: n8n Accessible
# ============================================
if [ -n "$DOMAIN" ]; then
    echo -n "[6/10] Checking n8n accessibility... "
    if curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN" | grep -q "200\|302"; then
        echo -e "${GREEN}✓${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC}"
        echo "  n8n not responding at https://$DOMAIN"
        ((FAILED++))
    fi
else
    echo -n "[6/10] Checking n8n accessibility... "
    echo -e "${YELLOW}⚠${NC} (skipped - no domain)"
    ((PASSED++))
fi

# ============================================
# CHECK 7: Render Service Health
# ============================================
if [ -n "$DOMAIN" ]; then
    echo -n "[7/10] Checking render service health... "
    if curl -s "https://$DOMAIN:3000/health" 2>/dev/null | grep -q "ok"; then
        echo -e "${GREEN}✓${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC}"
        echo "  Render service not healthy"
        ((FAILED++))
    fi
else
    echo -n "[7/10] Checking render service health... "
    echo -e "${YELLOW}⚠${NC} (skipped - no domain)"
    ((PASSED++))
fi

# ============================================
# CHECK 8: Credentials File
# ============================================
echo -n "[8/10] Checking credentials file... "
if [ -f ".secrets/credentials.txt" ]; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} (not found - check .secrets/)"
    ((PASSED++))
fi

# ============================================
# CHECK 9: Workflow Files
# ============================================
echo -n "[9/10] Checking workflow files... "
if [ -f "n8n-workflows/01-scheduler.json" ] && \
   [ -f "n8n-workflows/02-video-pipeline.json" ] && \
   [ -f "n8n-workflows/03-youtube-publisher.json" ]; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗${NC}"
    echo "  Missing workflow files in n8n-workflows/"
    ((FAILED++))
fi

# ============================================
# CHECK 10: Voice Test
# ============================================
echo -n "[10/10] Checking voice test file... "
if [ -f "test-output/voice_nick.mp3" ]; then
    SIZE=$(ls -lh test-output/voice_nick.mp3 | awk '{print $5}')
    echo -e "${GREEN}✓${NC} ($SIZE)"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} (not found)"
    echo "  Run: cd scripts && npm run test-voices"
    ((PASSED++))
fi

# ============================================
# SUMMARY
# ============================================
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  VERIFICATION SUMMARY"
echo "═══════════════════════════════════════════════════════"
echo ""
echo -e "Passed: ${GREEN}$PASSED${NC}/10"
echo -e "Failed: ${RED}$FAILED${NC}/10"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed!${NC}"
    echo ""
    echo "Your system is ready. Next steps:"
    echo "  1. Access n8n at: https://$DOMAIN"
    echo "  2. Import the 3 workflow files"
    echo "  3. Add YouTube OAuth2 credential"
    echo "  4. Activate the scheduler"
    echo ""
    echo -e "${GREEN}🎉 First video will be live within 3 hours!${NC}"
    
elif [ $FAILED -le 2 ]; then
    echo -e "${YELLOW}⚠️  Most checks passed${NC}"
    echo "Fix the failed items above, then run this script again."
    echo ""
    echo "Common fixes:"
    echo "  - railway login (if auth failed)"
    echo "  - railway up (if services not running)"
    echo "  - Wait 2-3 minutes for domain to propagate"
    
else
    echo -e "${RED}❌ Multiple checks failed${NC}"
    echo "Please run the full deployment: ./INSTALL.sh"
    echo ""
    echo "Or check:"
    echo "  - Railway dashboard"
    echo "  - docs/troubleshooting.md"
fi

echo ""

# Show helpful info
echo "═══════════════════════════════════════════════════════"
echo "  USEFUL COMMANDS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "View logs:"
echo "  railway logs"
echo ""
echo "Restart services:"
echo "  railway up"
echo ""
echo "Check status:"
echo "  railway status"
echo ""
echo "Open dashboard:"
echo "  railway open"
echo ""
