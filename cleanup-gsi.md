# DynamoDB GSI Cleanup Guide

## 🎯 Current GSI Structure (After Fix)

**New GSIs we need:**
- `VendorLowerIndex` - Query by vendorLower + timestamp
- `CategoryTimestampIndex` - Query by category + timestamp  
- `UserTimestampIndex` - Query by userId + timestamp (for future Cognito)

## 🗑️ Old GSIs to Remove

**Likely old GSIs that need cleanup:**
- `VendorIndex` (if exists) - Used vendor instead of vendorLower
- `CategoryIndex` (if exists) - Replaced by CategoryTimestampIndex

## 📋 Manual Cleanup Steps

### Step 1: Check Current GSIs
```bash
aws dynamodb describe-table --table-name SnapTally-Receipts --region us-east-1 --query 'Table.GlobalSecondaryIndexes[].IndexName'
```

### Step 2: Delete Old GSIs (if they exist)

**Delete VendorIndex (if exists):**
```bash
aws dynamodb update-table \
  --table-name SnapTally-Receipts \
  --region us-east-1 \
  --global-secondary-index-updates \
  '[{"Delete":{"IndexName":"VendorIndex"}}]'
```

**Delete CategoryIndex (if exists):**
```bash
aws dynamodb update-table \
  --table-name SnapTally-Receipts \
  --region us-east-1 \
  --global-secondary-index-updates \
  '[{"Delete":{"IndexName":"CategoryIndex"}}]'
```

### Step 3: Wait for Deletion
- GSI deletion takes time (usually 5-15 minutes)
- Check status: `aws dynamodb describe-table --table-name SnapTally-Receipts --region us-east-1`
- Wait until old GSIs are completely removed

### Step 4: Deploy CDK Stack
```bash
cd cdk
cdk deploy
```

## 🖥️ Alternative: AWS Console Method

### Via AWS Console:
1. Go to **DynamoDB Console**
2. Select **SnapTally-Receipts** table
3. Click **Indexes** tab
4. For each old GSI:
   - Click the GSI name
   - Click **Delete**
   - Confirm deletion
5. Wait for deletion to complete
6. Run `cdk deploy`

## ✅ Verification

After cleanup and deployment, verify only these GSIs exist:
```bash
aws dynamodb describe-table --table-name SnapTally-Receipts --region us-east-1 --query 'Table.GlobalSecondaryIndexes[].IndexName'
```

Expected output:
```json
[
    "VendorLowerIndex",
    "CategoryTimestampIndex", 
    "UserTimestampIndex"
]
```

## 💡 Why This Cleanup is Important

- **Cost Savings**: Each GSI costs money for storage and throughput
- **Performance**: Fewer indexes = faster writes
- **Maintenance**: Cleaner architecture
- **Clarity**: No confusion about which indexes to use