# 🔧 Frontend Troubleshooting Guide

## 🚨 Current Issue: "Failed to start receipt processing"

The frontend is using the **old API Gateway URL** and needs to be updated to the new one.

## 🔍 Steps to Fix

### Step 1: Get Your New API Gateway URL

Run this in your local terminal:
```bash
cd cdk
npx cdk outputs
```

Look for output like:
```
CdkStack.ApiGatewayUrl = https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/prod/
```

### Step 2: Update Frontend URLs

Edit `frontend/js/main.js` and replace these two URLs:

**Line 61** - Replace:
```javascript
"https://vppubumnr7.execute-api.us-east-1.amazonaws.com/prod/receipt",
```

**Line 112** - Replace:
```javascript
const statusUrl = `https://vppubumnr7.execute-api.us-east-1.amazonaws.com/prod/status/${receiptId}?executionArn=${encodeURIComponent(executionArn)}`;
```

**With your new API Gateway URL from Step 1**

### Step 3: Alternative Check via AWS Console

If CDK outputs doesn't work:

1. Go to **AWS Console** → **API Gateway**
2. Find **SnapTally Service** 
3. Click **Stages** → **prod**
4. Copy the **Invoke URL**
5. Use that URL in the frontend code

## 🚀 Quick Test

After updating the URLs, test with:
1. Open your frontend
2. Upload a receipt image
3. Check browser developer console (F12) for any errors

## 🔍 Additional Debugging

### Check Step Function
1. AWS Console → Step Functions
2. Look for **SnapTally-ReceiptProcessing**
3. Check if executions are starting

### Check Lambda Logs
1. AWS Console → CloudWatch → Log groups
2. Look for logs from your Lambda functions
3. Check for any errors

### Check Bedrock Access
1. AWS Console → Bedrock → Model access
2. Ensure **Amazon Nova Lite** is enabled
3. Status should be "Access granted"

## 🎯 Common Issues

1. **Wrong API URL**: Frontend pointing to old endpoint
2. **CORS Issues**: API Gateway CORS not configured  
3. **Nova Lite Not Enabled**: Bedrock model access required
4. **Step Function Permissions**: Check IAM roles

## 📞 Need Help?

If issues persist, provide:
- Browser console errors (F12 → Console)
- CloudWatch log messages
- Step Function execution details