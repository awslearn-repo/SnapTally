// Receipt processing using AWS Textract exclusively (no local OCR fallback)
document.getElementById("processBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("imageUpload");
  const file = fileInput.files[0];

  if (!file) {
    alert("Please select an image first.");
    return;
  }

  // Show loading state
  const output = document.getElementById("receiptInfo");
  output.innerHTML = `
    <div class="loading">
      <p>🔄 Processing receipt with AWS Textract...</p>
      <p><small>Please wait while we extract the receipt data...</small></p>
    </div>
  `;

  try {
    // Convert file to base64
    const base64Image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]; // Remove data:image/...;base64, prefix
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

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
      throw new Error(result.error || "Error processing receipt.");
    }

    // Check if we got the expected data structure
    if (result.success && result.data) {
      displayReceiptData(result.data, result.receiptId);
    } else {
      output.innerHTML = `
        <div class="error">
          <p>❌ Could not extract receipt details from AWS Textract.</p>
          <p>Please try another image or ensure the image is clear and properly formatted.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error:", error);
    output.innerHTML = `
      <div class="error">
        <p>❌ Error processing receipt with AWS Textract: ${error.message}</p>
        <p>Please try again or check if the image is clear and properly formatted.</p>
      </div>
    `;
  }
});

function displayReceiptData(data, receiptId) {
  const output = document.getElementById("receiptInfo");
  
  // Create the receipt display
  let itemsTableHTML = '';
  
  if (data.items && data.items.length > 0) {
    itemsTableHTML = `
      <div class="items-section">
        <h3>📋 Items</h3>
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
                  <td class="item-price">${item.price || 'N/A'}</td>
                  <td class="item-total">${item.lineTotal || item.price || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Create totals section
  let totalsHTML = '';
  if (data.subtotal || data.tax || data.total) {
    totalsHTML = `
      <div class="totals-section">
        <h3>💰 Summary</h3>
        <div class="totals-grid">
          ${data.subtotal ? `<div class="total-row"><span>Subtotal:</span><span>${data.subtotal}</span></div>` : ''}
          ${data.tax ? `<div class="total-row"><span>Tax:</span><span>${data.tax}</span></div>` : ''}
          <div class="total-row final-total"><span>Total:</span><span>${data.total}</span></div>
        </div>
      </div>
    `;
  }

  output.innerHTML = `
    <div class="receipt-container">
      <div class="receipt-header">
        <h2>✅ Receipt Processed Successfully</h2>
        <div class="receipt-meta">
          <p><strong>🏪 Vendor:</strong> ${data.vendor}</p>
          <p><strong>📅 Date:</strong> ${data.date}</p>
          <p><strong>🆔 Receipt ID:</strong> <code>${receiptId}</code></p>
          <p><small>💾 Saved to database automatically</small></p>
        </div>
      </div>
      
      ${itemsTableHTML}
      ${totalsHTML}
      
      <div class="actions-section">
        <button onclick="processAnotherReceipt()" class="secondary-btn">
          📸 Process Another Receipt
        </button>
      </div>
    </div>
  `;
}

function processAnotherReceipt() {
  document.getElementById("imageUpload").value = '';
  document.getElementById("receiptInfo").innerHTML = '';
}


