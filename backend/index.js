const AWS = require("aws-sdk");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const imageBase64 = body.image;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Image received",
        length: imageBase64.length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
