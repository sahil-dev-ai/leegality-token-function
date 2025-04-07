// netlify/functions/getToken.js
const fetch = require("node-fetch");

exports.handler = async function (event, context) {
    try {
        // Read your credentials from environment variables (we'll set these in Netlify)
        const clientId = process.env.LEEGALITY_CLIENT_ID;
        const clientSecret = process.env.LEEGALITY_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Client credentials are missing." }),
            };
        }

        // Create the basic auth header
        const authHeader =
            "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        // Call the OAuth token endpoint
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
                    scope: "auth consent-runner",
                }),
            }
        );

        const tokenData = await response.json();

        if (!tokenData.access_token) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: "No access token returned",
                    details: tokenData,
                }),
            };
        }

        // Return the token data
        return {
            statusCode: 200,
            body: JSON.stringify(tokenData),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
