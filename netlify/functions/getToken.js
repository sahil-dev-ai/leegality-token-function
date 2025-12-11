const fetch = require("node-fetch");

exports.handler = async function (event, context) {
  // Define allowed origins
  const allowedOrigins = [
    "https://leegality.webflow.io",
    "https://www.leegality.com",
    "https://consentin.webflow.io",
    "https://consent.in",
    "https://www.consent.in",
    "https://customer-onboarding-app.netlify.app",
    "https://5chdjf-5000.csb.app",
    "https://digital-lending-app.figma.site",
    "https://digital-lending.figma.site",
    "https://*.figma.site",
    "https://yournaukri-hr-demo.netlify.app",
    "https://szvwdt-5173.csb.app" // 👈 add your CodeSandbox URL here
  ];

  const requestOrigin = event.headers.origin || "";

  // Handle preflight (OPTIONS) requests
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigins.includes(requestOrigin)
          ? requestOrigin
          : "*", // fallback for dev
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
      body: "",
    };
  }

  // Check if the request origin is allowed
  if (!allowedOrigins.includes(requestOrigin)) {
    return {
      statusCode: 403,
      headers: { "Access-Control-Allow-Origin": requestOrigin || "*" },
      body: JSON.stringify({ error: "Origin not allowed" }),
    };
  }

  // Set the CORS header
  const corsHeader = {
    "Access-Control-Allow-Origin": requestOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  try {
    // Read your credentials from environment variables
    const clientId = process.env.LEEGALITY_CLIENT_ID;
    const clientSecret = process.env.LEEGALITY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return {
        statusCode: 500,
        headers: corsHeader,
        body: JSON.stringify({ error: "Client credentials are missing." }),
      };
    }

    const authHeader =
      "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await fetch(
      "https://sandbox-gateway.leegality.com/auth/oauth2/token",
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "auth consent-runner", // 👈 fixed scopes
        }),
      }
    );

    const tokenData = await response.json();

    if (!tokenData.access_token) {
      return {
        statusCode: 500,
        headers: corsHeader,
        body: JSON.stringify({
          error: "No access token returned",
          details: tokenData,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeader,
      body: JSON.stringify(tokenData),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeader,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
