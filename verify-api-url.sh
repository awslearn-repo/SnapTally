#!/bin/bash

echo "🔍 API URL Verification"
echo "======================="

echo "📋 Current frontend URL:"
grep -n "execute-api" frontend/js/main.js | head -2

echo ""
echo "🧪 Testing current frontend URL..."
CURRENT_URL=$(grep -o "https://[^\"]*execute-api[^\"]*" frontend/js/main.js | head -1)
echo "URL: $CURRENT_URL"

# Test if the current URL is reachable
echo ""
echo "🔗 Testing connectivity..."
if command -v curl &> /dev/null; then
    # Test OPTIONS request (CORS preflight)
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$CURRENT_URL" 2>/dev/null || echo "000")
    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "204" ]; then
        echo "✅ Current URL is reachable (HTTP $HTTP_STATUS)"
        echo "🎯 The API Gateway URL may NOT have changed!"
        echo ""
        echo "🚨 Real issue might be:"
        echo "   - Lambda function errors"
        echo "   - Step Function issues"
        echo "   - Nova Lite model not enabled"
        echo "   - DynamoDB permissions"
        echo ""
        echo "🔍 Check browser console (F12) for detailed error messages"
        echo "🔍 Check AWS CloudWatch logs for Lambda errors"
    else
        echo "❌ Current URL not reachable (HTTP $HTTP_STATUS)"
        echo "🔄 Need to update API Gateway URL"
    fi
else
    echo "⚠️  curl not available - cannot test connectivity"
    echo "📋 Manually test the URL in browser or check AWS Console"
fi

echo ""
echo "🏗️  To get the correct API Gateway URL:"
echo "   Option 1: AWS Console → API Gateway → SnapTally Service → Stages → prod"
echo "   Option 2: AWS CLI → aws cloudformation describe-stacks --stack-name CdkStack"
echo "   Option 3: Check CDK deployment output logs"