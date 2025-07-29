#!/bin/bash

# DynamoDB GSI Cleanup Script for SnapTally
# This script helps clean up old GSIs that are no longer needed

TABLE_NAME="SnapTally-Receipts"
REGION="us-east-1"

echo "🔍 SnapTally DynamoDB GSI Cleanup Tool"
echo "======================================"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check current GSIs
echo "📋 Current GSIs in table $TABLE_NAME:"
CURRENT_GSIS=$(aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --query 'Table.GlobalSecondaryIndexes[].IndexName' --output text 2>/dev/null)

if [ $? -ne 0 ]; then
    echo "❌ Error: Could not access table $TABLE_NAME. Please check:"
    echo "   - Table exists"
    echo "   - AWS credentials are configured"
    echo "   - Region is correct ($REGION)"
    exit 1
fi

if [ -z "$CURRENT_GSIS" ]; then
    echo "ℹ️  No GSIs found in the table."
    exit 0
fi

echo "$CURRENT_GSIS" | tr '\t' '\n' | while read -r gsi; do
    echo "  - $gsi"
done

echo ""
echo "🎯 Target GSI structure (what we want to keep):"
echo "  - VendorLowerIndex"
echo "  - CategoryTimestampIndex"
echo "  - UserTimestampIndex"

echo ""
echo "🗑️  GSIs that should be removed:"
GSIS_TO_DELETE=()

# Check for old GSIs that need removal
if echo "$CURRENT_GSIS" | grep -q "VendorIndex"; then
    echo "  - VendorIndex (replaced by VendorLowerIndex)"
    GSIS_TO_DELETE+=("VendorIndex")
fi

if echo "$CURRENT_GSIS" | grep -q "CategoryIndex"; then
    echo "  - CategoryIndex (replaced by CategoryTimestampIndex)"
    GSIS_TO_DELETE+=("CategoryIndex")
fi

if [ ${#GSIS_TO_DELETE[@]} -eq 0 ]; then
    echo "  ✅ No old GSIs found that need cleanup!"
    echo ""
    echo "🚀 You can proceed with: cd cdk && cdk deploy"
    exit 0
fi

echo ""
read -p "❓ Do you want to delete the old GSIs? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cleanup cancelled."
    echo "💡 You can run this script again or delete GSIs manually via AWS Console."
    exit 0
fi

# Delete old GSIs
for gsi in "${GSIS_TO_DELETE[@]}"; do
    echo "🗑️  Deleting GSI: $gsi"
    aws dynamodb update-table \
        --table-name $TABLE_NAME \
        --region $REGION \
        --global-secondary-index-updates "[{\"Delete\":{\"IndexName\":\"$gsi\"}}]" \
        --output text > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Successfully initiated deletion of $gsi"
    else
        echo "❌ Failed to delete $gsi"
    fi
done

echo ""
echo "⏳ GSI deletion is in progress..."
echo "   This typically takes 5-15 minutes."
echo ""
echo "🔄 You can check the status with:"
echo "   aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION"
echo ""
echo "✅ Once deletion is complete, deploy your CDK stack:"
echo "   cd cdk && cdk deploy"
echo ""
echo "🎯 Final verification command:"
echo "   aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --query 'Table.GlobalSecondaryIndexes[].IndexName'"