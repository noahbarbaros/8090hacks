import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();
    
    if (!code) {
      return NextResponse.json(
        { error: "No authorization code provided" },
        { status: 400 }
      );
    }
    
    // Ensure code is a string
    const codeString = String(code).trim();
    
    if (!codeString) {
      return NextResponse.json(
        { error: "Invalid authorization code" },
        { status: 400 }
      );
    }
    
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
    
    if (!client_id || !client_secret) {
      return NextResponse.json(
        { error: "Google credentials not found" },
        { status: 500 }
      );
    }
    
    // Use the same redirect URI as the auth URL (backend callback)
    // Must match exactly what was used in the auth URL
    const redirectUri = `${backendUrl}/api/google/callback`;
    
    console.log(`🔄 Exchanging code with redirect URI: ${redirectUri}`);
    
    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );
    
    // Exchange code for tokens
    // Note: OAuth codes are single-use and expire quickly (usually within minutes)
    const { tokens } = await oauth2Client.getToken(codeString);
    
    // Get user email from tokens
    let email = null;
    if (tokens.id_token) {
      try {
        const base64Url = tokens.id_token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(Buffer.from(base64, 'base64').toString().split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        const decoded = JSON.parse(jsonPayload);
        if (decoded.email) {
          email = decoded.email;
        }
      } catch (e) {
        console.log('Could not decode id_token, trying API call...');
      }
    }
    
    // Fallback: try API call
    if (!email) {
      try {
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const res = await oauth2.userinfo.get();
        email = res.data.email || null;
      } catch (error: any) {
        console.error('Error getting user email:', error);
        // Don't fail if we can't get email, tokens are still valid
      }
    }
    
    return NextResponse.json({ tokens, email });
  } catch (error: any) {
    console.error("Error exchanging code for tokens:", error);
    return NextResponse.json(
      { error: error.message || "Failed to exchange code for tokens" },
      { status: 500 }
    );
  }
}

