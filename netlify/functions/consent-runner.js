// netlify/functions/consent-runner.js
const fetch = require("node-fetch");

/**
 * Old allowed origins (kept for reference / future tightening)
 * Currently we still allow "*"
 */
const allowedOrigins = [
  "https://leegality.webflow.io",
  "https://www.leegality.com",
  "https://consentin.webflow.io",
  "https://consent.in",
  "https://www.consent.in",
  "https://customer-onboarding-app.netlify.app",
  "https://digital-lending-app.figma.site",
  "https://digital-lending.figma.site",
  "https://yournaukri-hr-demo.netlify.app",
  "https://car-insurance-app.figma.site",
  "https://*.figma.site"
];

exports.handler = async function (event) {
  const requestOrigin = event.headers.origin || "";

  /**
   * ✅ CURRENT CORS STRATEGY
   * - Allow all origins to avoid CORS issues across demos
   * - Old origins list kept for logging / future restriction
   */
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed. Use POST." }),
    };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  /**
   * Expected body:
   * {
   *   action: "register" | "update",
   *   name?: string,
   *   email?: string,
   *   phone?: string,
   *   consentProfileId?: string,
   *   consentProfileVersion?: number,
   *   principalId?: string,
   *   preferenceUrlType?: "PRIVACY",
   *   publicUrlExpiry?: number,
   *   sessionExpiry?: number
   * }
   */
  const action = (body.action || "register").toLowerCase();
  const publicUrlExpiry = Number(body.publicUrlExpiry || 60);
  const sessionExpiry = Number(body.sessionExpiry || 60);

  const clientId = process.env.LEEGALITY_CLIENT_ID;
  const clientSecret = process.env.LEEGALITY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Client credentials are missing." }),
    };
  }

  const baseUrl =
    process.env.LEEGALITY_BASE_URL ||
    "https://sandbox-gateway.leegality.com"; // OLD URL preserved

  try {
    // --------------------------------------------------
    // 1️⃣ Get OAuth Token (backend-only)
    // --------------------------------------------------
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
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Failed to obtain access token",
          details: tokenData,
        }),
      };
    }

    const accessToken = tokenData.access_token;

    // --------------------------------------------------
    // 2️⃣ REGISTER (Consent Collect)
    // --------------------------------------------------
    if (action === "register") {
      const { name, email, phone, consentProfileId, consentProfileVersion } =
        body || {};

      if (!name || !email || !phone) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Missing required fields",
            details: "name, email and phone are required",
          }),
        };
      }

      const profileId =
        consentProfileId || process.env.CONSENT_PROFILE_ID;
      const profileVersion = Number(
        consentProfileVersion || process.env.CONSENT_PROFILE_VERSION || 1
      );

      if (!profileId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "consentProfileId is required",
          }),
        };
      }

      // Backend-generated CPID (OLD BEHAVIOR preserved)
      const cpid = `${email}-${Date.now()}`;

      const registerPayload = {
        consentProfileId: profileId,
        consentProfileVersion: profileVersion,
        principal: {
          id: cpid,
          email,
          name,
          phone,
        },
        publicUrlExpiry,
        sessionExpiry,
      };

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
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Consent registration failed",
            details: registerData,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          consentUrl: registerData?.data?.consentCollectUrl || null,
          cpid,
          profileId,
          profileVersion,
        }),
      };
    }

    // --------------------------------------------------
    // 3️⃣ UPDATE (Privacy Center)
    // --------------------------------------------------
    if (action === "update") {
      const principalId = body.principalId;
      const preferenceUrlType = body.preferenceUrlType || "PRIVACY";

      if (!principalId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "principalId is required for update",
          }),
        };
      }

      const updatePayload = {
        principalId,
        preferenceUrlType,
        publicUrlExpiry,
        sessionExpiry,
      };

      const updateRes = await fetch(
        `${baseUrl}/consent-runner/api/v1/consents/client/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(updatePayload),
        }
      );

      const updateData = await updateRes.json();

      if (!updateRes.ok) {
        return {
          statusCode: updateRes.status,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Consent update failed",
            details: updateData,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          privacyCenterUrl: updateData?.data?.privacyCenterUrl,
          principalId,
        }),
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Invalid action. Use 'register' or 'update'.",
      }),
    };
  } catch (error) {
    console.error("consent-runner error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
