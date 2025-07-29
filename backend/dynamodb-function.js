const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const RECEIPTS_TABLE = process.env.RECEIPTS_TABLE || 'SnapTally-Receipts';

exports.handler = async (event) => {
  try {
    console.log('Starting DynamoDB save operation');
    
    const { receiptId, parsedData, textractResult, timestamp } = event;
    
    if (!receiptId || !parsedData) {
      throw new Error('Receipt ID and parsed data are required');
    }

    // Prepare the complete receipt record
    const receiptRecord = {
      receiptId,
      timestamp: timestamp || new Date().toISOString(),
      
      // Parsed receipt data
      vendor: parsedData.merchant || parsedData.vendor,
      date: parsedData.date,
      total: parsedData.total,
      subtotal: parsedData.subtotal,
      tax: parsedData.tax,
      items: parsedData.items || [],
      
      // Metadata
      itemCount: (parsedData.items || []).length,
      processed: true,
      processingMethod: 'textract-bedrock',
      
      // Confidence and quality metrics
      confidence: parsedData.metadata?.confidence || 0,
      textractFieldsFound: parsedData.metadata?.textractFieldsFound || 0,
      textractItemsFound: parsedData.metadata?.textractItemsFound || 0,
      
      // Raw data for debugging/reprocessing
      rawData: {
        textractSummaryFields: textractResult?.summaryFields || {},
        textractLineItems: textractResult?.lineItems || [],
        rawText: textractResult?.rawText || ''
      },
      
      // Processing timestamps
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      
      // Additional fields for future features
      userId: null, // Will be populated when Cognito is integrated
      tags: [],
      category: determineCategory(parsedData.merchant || parsedData.vendor),
      
      // Search fields for GSI
      vendorLower: (parsedData.merchant || parsedData.vendor || '').toLowerCase(),
      totalAmount: parseFloat(parsedData.total || '0'),
      
      // TTL field (optional - receipts expire after 7 years for compliance)
      ttl: Math.floor(Date.now() / 1000) + (7 * 365 * 24 * 60 * 60)
    };

    console.log(`Saving receipt ${receiptId} to DynamoDB`);
    console.log('Receipt summary:', {
      vendor: receiptRecord.vendor,
      total: receiptRecord.total,
      itemCount: receiptRecord.itemCount,
      confidence: receiptRecord.confidence
    });

    // Save to DynamoDB
    const command = new PutCommand({
      TableName: RECEIPTS_TABLE,
      Item: receiptRecord,
      // Prevent overwriting existing records
      ConditionExpression: 'attribute_not_exists(receiptId)'
    });

    await docClient.send(command);
    
    console.log(`Receipt ${receiptId} saved successfully to DynamoDB`);

    return {
      receiptId,
      status: 'DYNAMODB_COMPLETED',
      timestamp: new Date().toISOString(),
      savedData: {
        vendor: receiptRecord.vendor,
        total: receiptRecord.total,
        itemCount: receiptRecord.itemCount,
        confidence: receiptRecord.confidence,
        category: receiptRecord.category
      }
    };

  } catch (error) {
    console.error('DynamoDB save error:', error);
    
    // Don't fail the entire process if DynamoDB save fails
    return {
      receiptId: event.receiptId,
      status: 'DYNAMODB_FAILED',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        type: 'DYNAMODB_ERROR'
      },
      // Still return the parsed data for the API response
      parsedData: event.parsedData
    };
  }
};

function determineCategory(vendor) {
  if (!vendor) return 'Other';
  
  const vendorLower = vendor.toLowerCase();
  
  // Grocery stores
  if (['walmart', 'target', 'kroger', 'safeway', 'albertsons', 'publix', 'whole foods', 'trader joe'].some(store => vendorLower.includes(store))) {
    return 'Grocery';
  }
  
  // Restaurants
  if (['mcdonald', 'burger king', 'kfc', 'subway', 'starbucks', 'dunkin', 'pizza', 'restaurant', 'cafe', 'diner'].some(food => vendorLower.includes(food))) {
    return 'Restaurant';
  }
  
  // Gas stations
  if (['shell', 'exxon', 'chevron', 'bp', 'mobil', 'texaco', 'gas', 'fuel'].some(gas => vendorLower.includes(gas))) {
    return 'Gas';
  }
  
  // Pharmacies
  if (['cvs', 'walgreens', 'rite aid', 'pharmacy'].some(pharmacy => vendorLower.includes(pharmacy))) {
    return 'Pharmacy';
  }
  
  // Home improvement
  if (['home depot', 'lowes', 'menards', 'hardware'].some(home => vendorLower.includes(home))) {
    return 'Home Improvement';
  }
  
  // Electronics
  if (['best buy', 'apple', 'microsoft', 'electronics'].some(tech => vendorLower.includes(tech))) {
    return 'Electronics';
  }
  
  // Department stores
  if (['macy', 'nordstrom', 'jcpenney', 'sears', 'department'].some(dept => vendorLower.includes(dept))) {
    return 'Department Store';
  }
  
  return 'Other';
}