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
  output.innerHTML = "<p>Processing receipt with AWS Textract... Please wait.</p>";

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
    } else {
      output.innerHTML =
        "<p>Could not extract receipt details from AWS Textract. Please try another image or ensure the image is clear.</p>";
    }
  } catch (error) {
    console.error("Error:", error);
    output.innerHTML = `
      <p>Error processing receipt with AWS Textract: ${error.message}</p>
      <p>Please try again or check if the image is clear and properly formatted.</p>
    `;
  }
});


