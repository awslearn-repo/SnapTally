#!/bin/bash

# Automated Staged GSI Deployment for SnapTally
# This script handles the 3-stage GSI deployment automatically

CDK_PATH="cdk"
STACK_FILE="$CDK_PATH/lib/cdk-stack.js"
TABLE_NAME="SnapTally-Receipts"
REGION="us-east-1"

echo "🚀 SnapTally Staged GSI Deployment"
echo "=================================="

# Check if CDK directory exists
if [ ! -d "$CDK_PATH" ]; then
    echo "❌ CDK directory not found. Please run from project root."
    exit 1
fi

# Check if stack file exists
if [ ! -f "$STACK_FILE" ]; then
    echo "❌ CDK stack file not found: $STACK_FILE"
    exit 1
fi

# Function to wait for GSI to become active
wait_for_gsi_active() {
    local index_name=$1
    echo "⏳ Waiting for GSI '$index_name' to become ACTIVE..."
    
    while true; do
        local status=$(aws dynamodb describe-table \
            --table-name $TABLE_NAME \
            --region $REGION \
            --query "Table.GlobalSecondaryIndexes[?IndexName=='$index_name'].IndexStatus" \
            --output text 2>/dev/null)
        
        if [ "$status" = "ACTIVE" ]; then
            echo "✅ GSI '$index_name' is now ACTIVE"
            break
        elif [ "$status" = "CREATING" ]; then
            echo "   Still creating... (checking again in 30 seconds)"
            sleep 30
        else
            echo "❌ Unexpected status for GSI '$index_name': $status"
            exit 1
        fi
    done
}

# Function to deploy CDK
deploy_cdk() {
    echo "🚀 Deploying CDK stack..."
    cd $CDK_PATH
    
    if cdk deploy --require-approval never; then
        echo "✅ CDK deployment successful"
        cd ..
        return 0
    else
        echo "❌ CDK deployment failed"
        cd ..
        return 1
    fi
}

echo "📋 This script will deploy GSIs in 3 stages:"
echo "   Stage 1: VendorLowerIndex"
echo "   Stage 2: CategoryTimestampIndex" 
echo "   Stage 3: UserTimestampIndex"
echo ""

read -p "❓ Continue with staged deployment? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled."
    exit 0
fi

# Stage 1: Deploy VendorLowerIndex (should already be in the code)
echo ""
echo "🎯 Stage 1: Deploying VendorLowerIndex"
echo "======================================"

if ! deploy_cdk; then
    echo "❌ Stage 1 failed. Exiting."
    exit 1
fi

wait_for_gsi_active "VendorLowerIndex"

# Stage 2: Add CategoryTimestampIndex
echo ""
echo "🎯 Stage 2: Adding CategoryTimestampIndex"
echo "========================================="

# Add CategoryTimestampIndex to the stack file
sed -i.bak '/\/\/ Stage 2: CategoryTimestampIndex (deploy separately)/a\
    receiptsTable.addGlobalSecondaryIndex({\
      indexName: "CategoryTimestampIndex",\
      partitionKey: { name: "category", type: dynamodb.AttributeType.STRING },\
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },\
    });' "$STACK_FILE"

if ! deploy_cdk; then
    echo "❌ Stage 2 failed. Restoring backup."
    mv "$STACK_FILE.bak" "$STACK_FILE"
    exit 1
fi

wait_for_gsi_active "CategoryTimestampIndex"

# Stage 3: Add UserTimestampIndex
echo ""
echo "🎯 Stage 3: Adding UserTimestampIndex"
echo "====================================="

# Add UserTimestampIndex to the stack file
sed -i.bak2 '/\/\/ Stage 3: UserTimestampIndex (deploy separately)/a\
    receiptsTable.addGlobalSecondaryIndex({\
      indexName: "UserTimestampIndex",\
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },\
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },\
    });' "$STACK_FILE"

if ! deploy_cdk; then
    echo "❌ Stage 3 failed. Restoring backup."
    mv "$STACK_FILE.bak2" "$STACK_FILE"
    exit 1
fi

wait_for_gsi_active "UserTimestampIndex"

# Clean up backup files
rm -f "$STACK_FILE.bak" "$STACK_FILE.bak2"

echo ""
echo "🎉 All GSI stages deployed successfully!"
echo "======================================"

# Final verification
echo "📋 Final GSI verification:"
aws dynamodb describe-table \
    --table-name $TABLE_NAME \
    --region $REGION \
    --query 'Table.GlobalSecondaryIndexes[].{IndexName:IndexName,IndexStatus:IndexStatus}' \
    --output table

echo ""
echo "✅ Deployment complete! Your receipt processing system is ready."
echo "🚀 Next steps:"
echo "   1. Enable Nova Lite in AWS Console → Bedrock → Model Access"
echo "   2. Test receipt processing"
echo "   3. Monitor CloudWatch logs"