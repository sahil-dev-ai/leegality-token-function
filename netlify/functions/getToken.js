const fetch = require("node-fetch");

exports.handler = async function (event, context) {
    // Define allowed origins
    const allowedOrigins = ["https://leegality.webflow.io", "https://www.leegality.com"];
    const requestOrigin = event.headers.origin || "";

    // Check if the request origin is allowed
    if (!allowedOrigins.includes(requestOrigin)) {
        return {
            statusCode: 403,
            headers: { "Access-Control-Allow-Origin": requestOrigin },
            body: JSON.stringify({ error: "Origin not allowed" })
        };
    }

    // Set the CORS header
    const corsHeader = { "Access-Control-Allow-Origin": requestOrigin };

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

        const response = await fetch("https://sandbox-gateway.leegality.com/auth/oauth2/token", {
            method: "POST",
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                scope: "auth consent-runner",
            }),
        });

        const tokenData = await response.json();

        if (!tokenData.access_token) {
            return {
                statusCode: 500,
                headers: corsHeader,
                body: JSON.stringify({ error: "No access token returned", details: tokenData }),
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
