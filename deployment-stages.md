# Staged GSI Deployment Guide

## 🚨 Issue: AWS GSI Limitation
AWS DynamoDB only allows **one GSI operation per table update**. We need to deploy GSIs in stages.

## 📋 Deployment Stages

### Stage 1: Deploy VendorLowerIndex (Current)
```bash
cd cdk
cdk deploy
```
**Wait for completion** (~5-10 minutes)

### Stage 2: Add CategoryTimestampIndex
**After Stage 1 completes**, uncomment in `cdk/lib/cdk-stack.js`:

```javascript
// Add CategoryTimestampIndex
receiptsTable.addGlobalSecondaryIndex({
  indexName: "CategoryTimestampIndex", 
  partitionKey: { name: "category", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
});
```

Then deploy:
```bash
cdk deploy
```
**Wait for completion** (~5-10 minutes)

### Stage 3: Add UserTimestampIndex
**After Stage 2 completes**, uncomment in `cdk/lib/cdk-stack.js`:

```javascript
// Add UserTimestampIndex
receiptsTable.addGlobalSecondaryIndex({
  indexName: "UserTimestampIndex",
  partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
});
```

Then deploy:
```bash
cdk deploy
```

## ⚡ Quick Fix for Current Error

**Right now, just deploy Stage 1:**
```bash
cd cdk
cdk deploy
```

This will create only the VendorLowerIndex and should succeed.

## 🔍 Verification After Each Stage

Check GSI status:
```bash
aws dynamodb describe-table --table-name SnapTally-Receipts --region us-east-1 --query 'Table.GlobalSecondaryIndexes[].{IndexName:IndexName,IndexStatus:IndexStatus}'
```

Wait until `IndexStatus` is `ACTIVE` before proceeding to next stage.

## 🎯 Final Target Structure

After all 3 stages:
- ✅ VendorLowerIndex
- ✅ CategoryTimestampIndex  
- ✅ UserTimestampIndex

## 💡 Why This Happens

AWS limits GSI operations to prevent table performance issues during multiple simultaneous index builds. This is a safety measure, not a bug.

## 🚀 Alternative: Single Command Deployment

I can also create a script that handles the staged deployment automatically if you prefer!