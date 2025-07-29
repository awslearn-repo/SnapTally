#!/bin/bash

# Script to update frontend API URLs with the new API Gateway endpoint

FRONTEND_FILE="frontend/js/main.js"
CDK_DIR="cdk"

echo "🔧 SnapTally Frontend URL Updater"
echo "================================="

# Check if files exist
if [ ! -f "$FRONTEND_FILE" ]; then
    echo "❌ Frontend file not found: $FRONTEND_FILE"
    exit 1
fi

if [ ! -d "$CDK_DIR" ]; then
    echo "❌ CDK directory not found: $CDK_DIR"
    exit 1
fi

# Try to get API Gateway URL from CDK outputs
echo "🔍 Getting API Gateway URL from CDK..."
cd $CDK_DIR

# Try different methods to get the URL
API_URL=""

# Method 1: Try cdk outputs
if command -v cdk &> /dev/null; then
    echo "   Trying 'cdk outputs'..."
    API_URL=$(cdk outputs 2>/dev/null | grep ApiGatewayUrl | cut -d'=' -f2 | tr -d ' ')
fi

# Method 2: Try npx cdk outputs
if [ -z "$API_URL" ] && command -v npx &> /dev/null; then
    echo "   Trying 'npx cdk outputs'..."
    API_URL=$(npx cdk outputs 2>/dev/null | grep ApiGatewayUrl | cut -d'=' -f2 | tr -d ' ')
fi

cd ..

if [ -z "$API_URL" ]; then
    echo "❌ Could not automatically get API Gateway URL"
    echo "📋 Manual steps:"
    echo "   1. Run: cd cdk && npx cdk outputs"
    echo "   2. Find: CdkStack.ApiGatewayUrl = https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/prod/"
    echo "   3. Copy the URL and run this script with: $0 YOUR_API_URL"
    echo ""
    echo "🌐 Alternative: Check AWS Console → API Gateway → SnapTally Service → Stages → prod"
    exit 1
fi

# Remove trailing slash if present
API_URL=${API_URL%/}

echo "✅ Found API Gateway URL: $API_URL"

# Current URLs in the frontend
OLD_URL="https://vppubumnr7.execute-api.us-east-1.amazonaws.com/prod"

echo "🔄 Updating frontend URLs..."
echo "   From: $OLD_URL"
echo "   To:   $API_URL"

# Create backup
cp "$FRONTEND_FILE" "$FRONTEND_FILE.backup"
echo "📋 Created backup: $FRONTEND_FILE.backup"

# Update the URLs
sed -i.tmp "s|$OLD_URL|$API_URL|g" "$FRONTEND_FILE"
rm "$FRONTEND_FILE.tmp" 2>/dev/null

# Verify changes
UPDATED_COUNT=$(grep -c "$API_URL" "$FRONTEND_FILE")

if [ "$UPDATED_COUNT" -ge 2 ]; then
    echo "✅ Successfully updated $UPDATED_COUNT URL(s) in frontend"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Test your frontend with a receipt upload"
    echo "   2. Check browser console (F12) for any errors"
    echo "   3. Monitor AWS CloudWatch logs if needed"
    echo ""
    echo "🔧 If issues persist:"
    echo "   - Check TROUBLESHOOTING.md"
    echo "   - Ensure Nova Lite is enabled in Bedrock"
    echo "   - Verify Step Functions are working"
else
    echo "❌ URL update may have failed"
    echo "📋 Please manually update $FRONTEND_FILE"
    echo "   Replace: $OLD_URL"
    echo "   With:    $API_URL"
    
    # Restore backup if update failed
    mv "$FRONTEND_FILE.backup" "$FRONTEND_FILE"
    echo "🔄 Restored original file from backup"
fi