// netlify/functions/consent-register.js
const fetch = require("node-fetch");

// Reuse the same allowedOrigins as your getToken function
const allowedOrigins = [
  "https://leegality.webflow.io",
  "https://www.leegality.com",
  "https://consentin.webflow.io",
  "https://consent.in",
  "https://www.consent.in",
  "https://customer-onboarding-app.netlify.app",
  "https://digital-lending-app.figma.site",
  "https://digital-lending.figma.site",
  "https://*.figma.site",
  "https://yournaukri-hr-demo.netlify.app",
  "https://car-insurance-app.figma.site",
];

exports.handler = async function (event, context) {
  const requestOrigin = event.headers.origin || "";

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigins.includes(requestOrigin)
          ? requestOrigin
          : "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
      body: "",
    };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Allow": "POST, OPTIONS" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Block unknown browser origins (but allow non-browser callers without Origin)
  if (requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    return {
      statusCode: 403,
      headers: { "Access-Control-Allow-Origin": requestOrigin || "*" },
      body: JSON.stringify({ error: "Origin not allowed" }),
    };
  }

  const corsHeader = {
    "Access-Control-Allow-Origin": requestOrigin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  // Parse input from frontend
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeader,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { name, email, phone } = body;

  if (!name || !email || !phone) {
    return {
      statusCode: 400,
      headers: corsHeader,
      body: JSON.stringify({
        error: "Missing required fields",
        details: "name, email and phone are required",
      }),
    };
  }

  // Read credentials and config from environment variables
  const clientId = process.env.LEEGALITY_CLIENT_ID;
  const clientSecret = process.env.LEEGALITY_CLIENT_SECRET;
  const consentProfileId =
    process.env.CONSENT_PROFILE_ID || "ba39e63a-460e-43c9-88b0-70ddf7d282c7";
  const consentProfileVersion = Number(
    process.env.CONSENT_PROFILE_VERSION || 1
  );

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers: corsHeader,
      body: JSON.stringify({ error: "Client credentials are missing." }),
    };
  }

  const baseUrl =
    process.env.LEEGALITY_BASE_URL ||
    "https://sandbox-gateway.leegality.com"; // default to sandbox

  try {
    //
    // 1) Get OAuth token (same as getToken function)
    //
    const authHeader =
      "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenRes = await fetch(`${baseUrl}/auth/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "auth consent-runner",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return {
        statusCode: 500,
        headers: corsHeader,
        body: JSON.stringify({
          error: "Failed to obtain access token",
          details: tokenData,
        }),
      };
    }

    const accessToken = tokenData.access_token;

    //
    // 2) Build register payload
    //
    const cpid = `${email}-${Date.now()}`; // you can change this logic if needed

    const registerPayload = {
      consentProfileId,
      consentProfileVersion,
      principal: {
        id: cpid,
        email,
        name,
        phone,
      },
      publicUrlExpiry: 60,
      sessionExpiry: 60,
    };

    //
    // 3) Call register API from backend
    //
    const registerRes = await fetch(
      `${baseUrl}/consent-runner/api/v1/consents/client/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(registerPayload),
      }
    );

    const registerData = await registerRes.json();

    if (!registerRes.ok) {
      return {
        statusCode: registerRes.status,
        headers: corsHeader,
        body: JSON.stringify({
          error: "Consent registration failed",
          details: registerData,
        }),
      };
    }

    const consentUrl = registerData?.data?.consentCollectUrl;
    if (!consentUrl) {
      return {
        statusCode: 500,
        headers: corsHeader,
        body: JSON.stringify({
          error: "No consentCollectUrl returned",
          details: registerData,
        }),
      };
    }

    //
    // 4) Return ONLY safe data to the frontend
    //
    return {
      statusCode: 200,
      headers: corsHeader,
      body: JSON.stringify({
        consentUrl,
        cpid,
      }),
    };
  } catch (error) {
    console.error("consent-register error:", error);
    return {
      statusCode: 500,
      headers: corsHeader,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
