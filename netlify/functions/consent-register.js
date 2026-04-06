// netlify/functions/consent-combined.js
const fetch = require("node-fetch");
const https = require("https");

// Create a reusable HTTPS agent to keep TCP connections alive
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
});

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
  "https://kcc-app.figma.site",
  "https://car-insurance-app.figma.site",
  "https://tajconsent.figma.site",
];

// --- CACHE VARIABLES ---
// Storing these outside the handler allows them to persist across warm invocations
let cachedAccessToken = null;
let tokenExpirationTime = 0;

exports.handler = async function (event) {
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

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { Allow: "POST, OPTIONS" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Allow non-browser callers (no origin), restrict browsers
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

  // Parse body
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

  const action = (body.action || "register").toLowerCase();
  const clientId = process.env.LEEGALITY_CLIENT_ID;
  const clientSecret = process.env.LEEGALITY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers: corsHeader,
      body: JSON.stringify({ error: "Client credentials are missing." }),
    };
  }

  const baseUrl = process.env.LEEGALITY_BASE_URL || "https://sandbox-gateway.leegality.com";

  try {
    // --------------------------------------------------
    // 1) GET OAUTH TOKEN (Using In-Memory Cache)
    // --------------------------------------------------
    let accessToken = cachedAccessToken;
    const currentTime = Date.now();

    // If we don't have a token, or it expires in the next 60 seconds, fetch a new one
    if (!accessToken || currentTime > tokenExpirationTime - 60000) {
      const authHeader = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      const tokenRes = await fetch(`${baseUrl}/auth/oauth2/token`, {
        method: "POST",
        agent: httpsAgent, // Use Keep-Alive
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
          body: JSON.stringify({ error: "Failed to obtain access token", details: tokenData }),
        };
      }

      accessToken = tokenData.access_token;
      cachedAccessToken = accessToken;
      
      // Calculate expiration time (defaulting to 1 hour if not provided by the API)
      const expiresInSeconds = tokenData.expires_in || 3600;
      tokenExpirationTime = currentTime + (expiresInSeconds * 1000);
    }

    // --------------------------------------------------
    // 2) REGISTER LOGIC
    // --------------------------------------------------
    if (action === "register") {
      const { name, email, phone, consentProfileId, consentProfileVersion } = body;

      if (!name || !email || !phone) {
        return {
          statusCode: 400,
          headers: corsHeader,
          body: JSON.stringify({ error: "Missing required fields: name, email, phone" }),
        };
      }

      const profileId = consentProfileId || process.env.CONSENT_PROFILE_ID;
      const profileVersion = Number(consentProfileVersion || process.env.CONSENT_PROFILE_VERSION || 1);

      if (!profileId) {
        return {
          statusCode: 400,
          headers: corsHeader,
          body: JSON.stringify({ error: "consentProfileId is required." }),
        };
      }

      const cpid = `${email}-${Date.now()}`;

      const registerPayload = {
        consentProfileId: profileId,
        consentProfileVersion: profileVersion,
        principal: { id: cpid, email, name, phone },
        publicUrlExpiry: Number(body.publicUrlExpiry || 60),
        sessionExpiry: Number(body.sessionExpiry || 60),
      };

      const registerRes = await fetch(`${baseUrl}/consent-runner/api/v1/consents/client/register`, {
        method: "POST",
        agent: httpsAgent, // Use Keep-Alive
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(registerPayload),
      });

      const registerData = await registerRes.json();

      if (!registerRes.ok) {
        return {
          statusCode: registerRes.status,
          headers: corsHeader,
          body: JSON.stringify({ error: "Consent registration failed", details: registerData }),
        };
      }

      const consentUrl = registerData?.data?.consentCollectUrl;
      if (!consentUrl) {
        return {
          statusCode: 500,
          headers: corsHeader,
          body: JSON.stringify({ error: "No consentCollectUrl returned", details: registerData }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeader,
        body: JSON.stringify({ consentUrl, cpid, profileId, profileVersion }),
      };
    }

    // --------------------------------------------------
    // 3) UPDATE LOGIC
    // --------------------------------------------------
    if (action === "update") {
      const { principalId, preferenceUrlType = "PRIVACY" } = body;
      const publicUrlExpiry = Number(body.publicUrlExpiry || 60);
      const sessionExpiry = Number(body.sessionExpiry || 60);

      if (!principalId) {
        return {
          statusCode: 400,
          headers: corsHeader,
          body: JSON.stringify({ error: "principalId is required for update" }),
        };
      }

      const updatePayload = { principalId, preferenceUrlType, publicUrlExpiry, sessionExpiry };

      const updateRes = await fetch(`${baseUrl}/consent-runner/api/v1/consents/client/update`, {
        method: "POST",
        agent: httpsAgent, // Use Keep-Alive
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(updatePayload),
      });

      const updateData = await updateRes.json();

      if (!updateRes.ok) {
        return {
          statusCode: updateRes.status,
          headers: corsHeader,
          body: JSON.stringify({ error: "Consent update failed", details: updateData }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeader,
        body: JSON.stringify({
          consentUrl: updateData?.data?.privacyCenterUrl,
          principalId,
        }),
      };
    }

    // Fallback if action is neither
    return {
      statusCode: 400,
      headers: corsHeader,
      body: JSON.stringify({ error: "Invalid action. Use 'register' or 'update'." }),
    };

  } catch (error) {
    console.error("consent function error:", error);
    return {
      statusCode: 500,
      headers: corsHeader,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
