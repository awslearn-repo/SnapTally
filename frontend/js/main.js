document.getElementById("processBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("imageUpload");
  const file = fileInput.files[0];

  if (!file) {
    alert("Please select an image first.");
    return;
  }

  // Show loading state
  const output = document.getElementById("receiptInfo");
  output.innerHTML = "<p>Processing receipt... Please wait.</p>";

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
    if (result.data && typeof result.data === 'object') {
      // New API response format with processed receipt data
      output.innerHTML = `
        <p><strong>Vendor:</strong> ${result.data.vendor || "N/A"}</p>
        <p><strong>Date:</strong> ${result.data.date || "N/A"}</p>
        <p><strong>Total:</strong> ${result.data.total || "N/A"}</p>
        <p><strong>Items:</strong></p>
        <ul>
          ${
            (result.data.items || [])
              .map((item) => `<li>${item}</li>`)
              .join("") || "<li>No items found.</li>"
          }
        </ul>
      `;
    } else if (result.message) {
      // Fallback: Old API response or simple message - use client-side OCR
      console.log("API returned simple message, falling back to client-side OCR");
      await processWithTesseract(file, output);
    } else {
      output.innerHTML =
        "<p>Could not extract receipt details. Please try another image.</p>";
    }
  } catch (error) {
    console.error("Error:", error);
    // Fallback to client-side OCR if API fails
    console.log("API failed, falling back to client-side OCR");
    await processWithTesseract(file, output);
  }
});

// Fallback function using Tesseract.js for client-side OCR
async function processWithTesseract(file, output) {
  try {
    output.innerHTML = "<p>Processing receipt with local OCR... Please wait.</p>";
    
    const { data: { text } } = await Tesseract.recognize(file, 'eng', {
      logger: m => console.log(m)
    });
    
    console.log('Extracted text:', text);
    
    // Parse the extracted text
    const receiptData = parseReceiptText(text);
    
    output.innerHTML = `
      <p><strong>Vendor:</strong> ${receiptData.vendor}</p>
      <p><strong>Date:</strong> ${receiptData.date}</p>
      <p><strong>Total:</strong> ${receiptData.total}</p>
      <p><strong>Items:</strong></p>
      <ul>
        ${receiptData.items.map((item) => `<li>${item}</li>`).join("")}
      </ul>
      <p><em>Processed using local OCR</em></p>
    `;
  } catch (error) {
    console.error("Tesseract error:", error);
    output.innerHTML = "<p>Something went wrong. Please try again.</p>";
  }
}

// Receipt text parsing function (same as backend)
function parseReceiptText(text) {
  const lines = text.split('\n').filter(line => line.trim());
  
  let vendor = null;
  let date = null;
  let total = null;
  const items = [];

  // Simple patterns for common receipt elements
  const datePattern = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/;
  const pricePattern = /\$?\d+\.\d{2}/g;
  const totalPattern = /total.*?(\$?\d+\.\d{2})/i;

  for (const line of lines) {
    // Extract vendor (usually first meaningful line)
    if (!vendor && line.length > 3 && !datePattern.test(line) && !pricePattern.test(line)) {
      vendor = line.trim();
    }

    // Extract date
    if (!date && datePattern.test(line)) {
      const dateMatch = line.match(datePattern);
      if (dateMatch) {
        date = dateMatch[0];
      }
    }

    // Extract total
    if (!total && totalPattern.test(line)) {
      const totalMatch = line.match(totalPattern);
      if (totalMatch) {
        total = totalMatch[1];
      }
    }

    // Extract items (lines with prices that aren't totals)
    if (pricePattern.test(line) && !totalPattern.test(line)) {
      items.push(line.trim());
    }
  }

  return {
    vendor: vendor || "Unknown",
    date: date || "Unknown", 
    total: total || "Unknown",
    items: items.length > 0 ? items : ["No items found"]
  };
}
