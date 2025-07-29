# 🚨 DEPLOYMENT FIX - Step by Step

## Current Issue
AWS DynamoDB is rejecting GSI operations due to conflicts. Let's fix this with a clean approach.

## ✅ IMMEDIATE FIX

### Step 1: Clean Deployment (NO GSIs)
```bash
cd cdk
cdk deploy
```

**This should work now** - we've removed all GSIs temporarily.

### Step 2: Add First GSI
After Step 1 succeeds, edit `cdk/lib/cdk-stack.js` and **uncomment only this block**:

```javascript
// STEP 1: After initial deployment, uncomment this first:
receiptsTable.addGlobalSecondaryIndex({
  indexName: "VendorLowerIndex",
  partitionKey: { name: "vendorLower", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
});
```

Then deploy:
```bash
cdk deploy
```

### Step 3: Add Second GSI
After Step 2 succeeds, **uncomment this block**:

```javascript
// STEP 2: After Step 1 deploys successfully, uncomment this:
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

### Step 4: Add Third GSI
After Step 3 succeeds, **uncomment this block**:

```javascript
// STEP 3: After Step 2 deploys successfully, uncomment this:
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

## 🎯 Key Points

- **Wait** for each deployment to complete before the next step
- **Only uncomment one GSI block at a time**
- **Don't skip steps** - AWS requires sequential GSI operations

## ⚡ Quick Start

**Right now, just run:**
```bash
cd cdk
cdk deploy
```

This will deploy everything except GSIs and should work immediately.

## 🔍 Why This Approach Works

1. **Clean slate**: No GSI conflicts
2. **Sequential**: One GSI at a time
3. **Controlled**: You can stop at any step
4. **Safe**: No rollback risks

## 🚀 After Deployment

Once you have at least the VendorLowerIndex (Step 2), your receipt processing will work perfectly with Nova Lite!