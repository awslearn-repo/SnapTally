// Advanced Receipt processing using AWS Textract AnalyzeExpense + Bedrock Claude
document.getElementById("processBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("imageUpload");
  const file = fileInput.files[0];

  if (!file) {
    alert("Please select an image first.");
    return;
  }

  // Show advanced loading state
  const output = document.getElementById("receiptInfo");
  output.innerHTML = `
    <div class="processing-container">
      <div class="processing-header">
        <h2>🚀 Advanced Receipt Processing</h2>
        <p>Using AWS Textract AnalyzeExpense + Bedrock Claude</p>
      </div>
      <div class="processing-steps">
        <div class="step active" id="step-upload">
          <span class="step-icon">📤</span>
          <span class="step-text">Uploading image...</span>
        </div>
        <div class="step" id="step-textract">
          <span class="step-icon">🔍</span>
          <span class="step-text">Extracting data with Textract</span>
        </div>
        <div class="step" id="step-bedrock">
          <span class="step-icon">🧠</span>
          <span class="step-text">AI parsing with Claude</span>
        </div>
        <div class="step" id="step-save">
          <span class="step-icon">💾</span>
          <span class="step-text">Saving to database</span>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
      <p class="processing-note">This may take 30-60 seconds for optimal accuracy</p>
    </div>
  `;

  try {
    // Convert file to base64
    updateProgress(25, "Preparing image data...");
    const base64Image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Start processing
    updateProgress(50, "Starting advanced processing...");
    activateStep("step-textract");
    
    const response = await fetch(
      "https://vppubumnr7.execute-api.us-east-1.amazonaws.com/prod/receipt",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: base64Image
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Error starting receipt processing.");
    }

    if (result.success && result.receiptId) {
      // Start polling for results
      updateProgress(75, "Processing with AI...");
      activateStep("step-bedrock");
      
      await pollForResults(result.receiptId, result.executionArn);
    } else {
      throw new Error("Failed to start receipt processing");
    }

  } catch (error) {
    console.error("Error:", error);
    output.innerHTML = `
      <div class="error-container">
        <h2>❌ Processing Failed</h2>
        <p><strong>Error:</strong> ${error.message}</p>
        <p>Please try again with a clear receipt image.</p>
        <button onclick="processAnotherReceipt()" class="retry-btn">
          Try Again
        </button>
      </div>
    `;
  }
});

async function pollForResults(receiptId, executionArn) {
  const maxAttempts = 30; // 5 minutes max (10 second intervals)
  let attempts = 0;

  const poll = async () => {
    attempts++;
    
    try {
      const statusUrl = `https://vppubumnr7.execute-api.us-east-1.amazonaws.com/prod/status/${receiptId}?executionArn=${encodeURIComponent(executionArn)}`;
      const statusResponse = await fetch(statusUrl);
      const statusResult = await statusResponse.json();

      console.log(`Polling attempt ${attempts}:`, statusResult);

      if (statusResult.status === 'COMPLETED' && statusResult.data) {
        // Processing complete!
        updateProgress(100, "Processing complete!");
        activateStep("step-save");
        
        setTimeout(() => {
          displayReceiptData(statusResult.data, receiptId, statusResult.metadata);
        }, 1000);
        
      } else if (statusResult.status === 'FAILED') {
        throw new Error(statusResult.message || 'Processing failed');
        
      } else if (statusResult.status === 'PROCESSING' && attempts < maxAttempts) {
        // Still processing, continue polling
        updateProgress(75 + (attempts * 2), "AI processing in progress...");
        setTimeout(poll, 10000); // Poll every 10 seconds
        
      } else if (attempts >= maxAttempts) {
        throw new Error('Processing timeout - please try again');
        
      } else {
        // Continue polling
        setTimeout(poll, 10000);
      }

    } catch (error) {
      console.error('Polling error:', error);
      
      if (attempts < maxAttempts) {
        // Retry polling
        setTimeout(poll, 10000);
      } else {
        throw error;
      }
    }
  };

  // Start polling after a short delay
  setTimeout(poll, 5000);
}

function updateProgress(percentage, message) {
  const progressFill = document.getElementById("progress-fill");
  const processingNote = document.querySelector(".processing-note");
  
  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }
  
  if (processingNote) {
    processingNote.textContent = message;
  }
}

function activateStep(stepId) {
  // Remove active class from all steps
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('active');
    step.classList.add('completed');
  });
  
  // Add active class to current step
  const currentStep = document.getElementById(stepId);
  if (currentStep) {
    currentStep.classList.remove('completed');
    currentStep.classList.add('active');
  }
}

function displayReceiptData(data, receiptId, metadata) {
  const output = document.getElementById("receiptInfo");
  
  // Create the enhanced receipt display
  let itemsTableHTML = '';
  
  if (data.items && data.items.length > 0) {
    itemsTableHTML = `
      <div class="items-section">
        <h3>📋 Items Detected</h3>
        <div class="table-container">
          <table class="items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${data.items.map(item => `
                <tr>
                  <td class="item-name">${item.name || 'Unknown Item'}</td>
                  <td class="item-qty">${item.quantity || 1}</td>
                  <td class="item-price">$${item.price || '0.00'}</td>
                  <td class="item-total">$${item.lineTotal || item.price || '0.00'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Create enhanced totals section
  let totalsHTML = '';
  if (data.subtotal || data.tax || data.total) {
    totalsHTML = `
      <div class="totals-section">
        <h3>💰 Financial Summary</h3>
        <div class="totals-grid">
          ${data.subtotal ? `<div class="total-row"><span>Subtotal:</span><span>$${data.subtotal}</span></div>` : ''}
          ${data.tax ? `<div class="total-row"><span>Tax:</span><span>$${data.tax}</span></div>` : ''}
          <div class="total-row final-total"><span>Total:</span><span>$${data.total || '0.00'}</span></div>
        </div>
      </div>
    `;
  }

  // Create metadata section
  let metadataHTML = '';
  if (metadata) {
    metadataHTML = `
      <div class="metadata-section">
        <h3>📊 Processing Details</h3>
        <div class="metadata-grid">
          <div class="metadata-item">
            <span class="metadata-label">Confidence:</span>
            <span class="metadata-value">${metadata.confidence || 0}%</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Category:</span>
            <span class="metadata-value">${metadata.category || 'Other'}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Method:</span>
            <span class="metadata-value">Textract + Claude AI</span>
          </div>
        </div>
      </div>
    `;
  }

  output.innerHTML = `
    <div class="receipt-container enhanced">
      <div class="receipt-header">
        <h2>✅ Receipt Processed Successfully</h2>
        <div class="receipt-meta">
          <p><strong>🏪 Merchant:</strong> ${data.vendor || data.merchant}</p>
          <p><strong>📅 Date:</strong> ${data.date}</p>
          <p><strong>🆔 Receipt ID:</strong> <code>${receiptId}</code></p>
          <p><small>🤖 Processed with advanced AI technology</small></p>
        </div>
      </div>
      
      ${itemsTableHTML}
      ${totalsHTML}
      ${metadataHTML}
      
      <div class="actions-section">
        <button onclick="processAnotherReceipt()" class="primary-btn">
          📸 Process Another Receipt
        </button>
        <button onclick="viewRawData('${receiptId}')" class="secondary-btn">
          🔍 View Processing Details
        </button>
      </div>
    </div>
  `;
}

function processAnotherReceipt() {
  document.getElementById("imageUpload").value = '';
  document.getElementById("receiptInfo").innerHTML = '';
}

function viewRawData(receiptId) {
  // This could be expanded to show processing details
  alert(`Receipt ID: ${receiptId}\n\nProcessing details would be shown here in a future update.`);
}


