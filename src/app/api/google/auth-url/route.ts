import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const state = searchParams.get("state"); // slack_user_id|team_id
    const backendUrl = searchParams.get("backend_url") || process.env.BACKEND_URL || "http://localhost:3000";
    
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!client_id || !client_secret) {
      return NextResponse.json(
        { error: "Google credentials not found" },
        { status: 500 }
      );
    }
    
    // Use backend callback URL
    const redirectUri = `${backendUrl}/api/google/callback`;
    
    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid'
      ],
      prompt: 'consent',
      state: state || undefined,
    });
    
    return NextResponse.json({ authUrl });
  } catch (error: any) {
    console.error("Error generating Google auth URL:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}

