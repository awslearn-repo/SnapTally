document.getElementById("processBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("imageUpload");
  const file = fileInput.files[0];

  if (!file) {
    alert("Please select an image first.");
    return;
  }

  const formData = new FormData();
  formData.append("receipt", file);

  // Show loading state
  const output = document.getElementById("receiptInfo");
  output.innerHTML = "<p>Processing receipt... Please wait.</p>";

  try {
    const response = await fetch(
      "https://vppubumnr7.execute-api.us-east-1.amazonaws.com/prod/receipt",
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error("Error processing receipt.");
    }

    const result = await response.json();

    if (result.error || !result.data) {
      output.innerHTML =
        "<p>Could not extract receipt details. Please try another image.</p>";
    } else {
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
    }
  } catch (error) {
    console.error("Error:", error);
    output.innerHTML = "<p>Something went wrong. Please try again.</p>";
  }
});
