const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const RECEIPTS_TABLE = process.env.RECEIPTS_TABLE || 'SnapTally-Receipts';

exports.handler = async (event) => {
  try {
    console.log('DynamoDB Lambda processing receipt data...');
    
    const { receiptId, parsedData, textractResult, timestamp, s3Location } = event;
    
    if (!receiptId || !parsedData) {
      throw new Error('Missing required parameters: receiptId or parsedData');
    }

    console.log(`Saving receipt ${receiptId} to DynamoDB with complete item details`);

    // Prepare comprehensive receipt record with ALL details
    const receiptRecord = {
      // Primary Keys
      receiptId: receiptId,
      timestamp: timestamp || new Date().toISOString(),
      
      // Basic Receipt Info
      vendor: parsedData.merchant || parsedData.vendor || 'Unknown',
      merchant: parsedData.merchant || parsedData.vendor || 'Unknown',
      date: parsedData.date || new Date().toISOString().split('T')[0],
      
      // Financial Details
      total: parseFloat(parsedData.total || '0'),
      totalFormatted: parsedData.total || '0.00',
      subtotal: parseFloat(parsedData.subtotal || '0'),
      subtotalFormatted: parsedData.subtotal || '0.00',
      tax: parseFloat(parsedData.tax || '0'),
      taxFormatted: parsedData.tax || '0.00',
      
      // COMPLETE ITEM DETAILS - This was missing!
      items: (parsedData.items || []).map((item, index) => ({
        itemId: `${receiptId}-item-${index + 1}`,
        name: item.name || item.description || `Item ${index + 1}`,
        price: parseFloat(item.price || '0'),
        priceFormatted: item.price || '0.00',
        quantity: parseInt(item.quantity || '1'),
        quantityFormatted: item.quantity || '1',
        lineTotal: parseFloat(item.price || '0') * parseInt(item.quantity || '1'),
        lineTotalFormatted: (parseFloat(item.price || '0') * parseInt(item.quantity || '1')).toFixed(2),
        category: determineItemCategory(item.name || item.description || ''),
        order: index + 1
      })),
      
      // Item Summary Statistics
      itemCount: (parsedData.items || []).length,
      totalItems: (parsedData.items || []).reduce((sum, item) => sum + parseInt(item.quantity || '1'), 0),
      averageItemPrice: (parsedData.items || []).length > 0 
        ? ((parsedData.items || []).reduce((sum, item) => sum + parseFloat(item.price || '0'), 0) / (parsedData.items || []).length).toFixed(2)
        : '0.00',
      
      // Processing Status
      processed: true,
      processingMethod: event.processingMethod || 'textract-bedrock-nova',
      confidence: parsedData.metadata?.confidence || 0.85,
      
      // Raw Processing Data (for debugging/analysis)
      rawData: {
        textractSummaryFields: textractResult?.summaryFields || {},
        textractLineItems: textractResult?.lineItems || [],
        textractConfidence: textractResult?.confidence || {},
        bedrockResponse: parsedData.metadata || {},
        processingTimestamp: new Date().toISOString()
      },
      
      // Metadata & Timestamps
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingDuration: parsedData.metadata?.processingTime || 0,
      
      // User & Organization (for future use)
      userId: 'anonymous', // Will be replaced with actual user ID when Cognito is added
      organizationId: 'default',
      tags: [],
      notes: '',
      
      // Classification & Search
      category: determineReceiptCategory(parsedData.merchant || parsedData.vendor || ''),
      vendorLower: (parsedData.merchant || parsedData.vendor || '').toLowerCase(),
      totalAmount: parseFloat(parsedData.total || '0'), // For GSI queries
      
      // Storage & Lifecycle
      s3Location: s3Location || '',
      ttl: Math.floor(Date.now() / 1000) + (7 * 365 * 24 * 60 * 60), // 7 years retention
      
      // Analytics Fields
      dayOfWeek: new Date(parsedData.date || new Date()).toLocaleDateString('en-US', { weekday: 'long' }),
      monthYear: new Date(parsedData.date || new Date()).toISOString().substring(0, 7), // YYYY-MM
      year: new Date(parsedData.date || new Date()).getFullYear(),
      
      // Receipt Validation
      isValid: validateReceiptData(parsedData),
      validationErrors: getValidationErrors(parsedData),
      
      // Feature Flags
      hasItems: (parsedData.items || []).length > 0,
      hasTax: parseFloat(parsedData.tax || '0') > 0,
      hasSubtotal: parseFloat(parsedData.subtotal || '0') > 0,
      isLargeReceipt: (parsedData.items || []).length > 10
    };

    console.log(`Receipt record prepared:
    - Vendor: ${receiptRecord.vendor}
    - Total: $${receiptRecord.totalFormatted}
    - Items: ${receiptRecord.itemCount} (${receiptRecord.totalItems} total quantity)
    - Category: ${receiptRecord.category}
    - Confidence: ${Math.round(receiptRecord.confidence * 100)}%`);

    // Log individual items for verification
    if (receiptRecord.items.length > 0) {
      console.log('Individual items being saved:');
      receiptRecord.items.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.name} - Qty: ${item.quantity} - Price: $${item.priceFormatted} - Total: $${item.lineTotalFormatted}`);
      });
    } else {
      console.log('⚠️ No individual items found in parsed data');
    }

    // Save to DynamoDB with condition to prevent overwrites
    const command = new PutCommand({
      TableName: RECEIPTS_TABLE,
      Item: receiptRecord,
      ConditionExpression: 'attribute_not_exists(receiptId)'
    });

    await docClient.send(command);
    console.log(`✅ Receipt ${receiptId} saved to DynamoDB successfully with complete item details`);

    // Return summary for Step Function
    const savedSummary = {
      receiptId: receiptRecord.receiptId,
      timestamp: receiptRecord.timestamp,
      vendor: receiptRecord.vendor,
      total: receiptRecord.totalFormatted,
      itemCount: receiptRecord.itemCount,
      totalItems: receiptRecord.totalItems,
      category: receiptRecord.category,
      confidence: receiptRecord.confidence
    };

    return {
      receiptId,
      status: 'DYNAMODB_COMPLETED',
      savedData: savedSummary,
      itemDetails: receiptRecord.items.map(item => ({
        name: item.name,
        price: item.priceFormatted,
        quantity: item.quantityFormatted,
        total: item.lineTotalFormatted
      })),
      timestamp: new Date().toISOString(),
      message: `Receipt saved with ${receiptRecord.itemCount} items`
    };

  } catch (error) {
    console.error('❌ DynamoDB save failed:', error);
    
    return {
      receiptId: event.receiptId || 'unknown',
      status: 'DYNAMODB_FAILED',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

function determineReceiptCategory(vendor) {
  const vendorLower = vendor.toLowerCase();
  
  // Grocery stores
  if (vendorLower.includes('market') || vendorLower.includes('grocery') || 
      vendorLower.includes('food') || vendorLower.includes('super')) {
    return 'Grocery';
  }
  
  // Restaurants
  if (vendorLower.includes('restaurant') || vendorLower.includes('cafe') || 
      vendorLower.includes('pizza') || vendorLower.includes('burger')) {
    return 'Restaurant';
  }
  
  // Gas stations
  if (vendorLower.includes('gas') || vendorLower.includes('fuel') || 
      vendorLower.includes('shell') || vendorLower.includes('exxon')) {
    return 'Gas';
  }
  
  // Retail
  if (vendorLower.includes('store') || vendorLower.includes('shop') || 
      vendorLower.includes('retail')) {
    return 'Retail';
  }
  
  return 'Other';
}

function determineItemCategory(itemName) {
  const itemLower = itemName.toLowerCase();
  
  if (itemLower.includes('food') || itemLower.includes('bread') || itemLower.includes('milk')) {
    return 'Food';
  }
  if (itemLower.includes('drink') || itemLower.includes('soda') || itemLower.includes('water')) {
    return 'Beverage';
  }
  if (itemLower.includes('gas') || itemLower.includes('fuel')) {
    return 'Fuel';
  }
  
  return 'General';
}

function validateReceiptData(parsedData) {
  // Basic validation rules
  if (!parsedData.merchant && !parsedData.vendor) return false;
  if (!parsedData.total || parseFloat(parsedData.total) <= 0) return false;
  if (!parsedData.date) return false;
  
  return true;
}

function getValidationErrors(parsedData) {
  const errors = [];
  
  if (!parsedData.merchant && !parsedData.vendor) {
    errors.push('Missing merchant/vendor name');
  }
  if (!parsedData.total || parseFloat(parsedData.total) <= 0) {
    errors.push('Invalid or missing total amount');
  }
  if (!parsedData.date) {
    errors.push('Missing receipt date');
  }
  if (!parsedData.items || parsedData.items.length === 0) {
    errors.push('No individual items found');
  }
  
  return errors;
}