import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid' // Required to get id_token with email
];

export class GoogleCalendarService {
  private oauth2Client;

  constructor() {
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    // Default to frontend URL (Next.js runs on port 3001)
    const frontendUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3001";
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${frontendUrl}/api/google/callback`;
    
    if (!client_id || !client_secret) {
      throw new Error("Google credentials not found in environment variables");
    }

    this.oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );
  }

  generateAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to get refresh token and id_token
    });
  }

  async setCredentials(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  async listEvents(authTokens: any) {
    this.oauth2Client.setCredentials(authTokens);
    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    
    try {
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return res.data.items;
    } catch (error) {
      console.error('The API returned an error: ' + error);
      throw error;
    }
  }

  async getUserEmail(authTokens: any) {
    // First, try to get email from id_token if available
    if (authTokens.id_token) {
      try {
        // Decode the JWT id_token to get email (without verification for simplicity)
        const base64Url = authTokens.id_token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(Buffer.from(base64, 'base64').toString().split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        const decoded = JSON.parse(jsonPayload);
        if (decoded.email) {
          return decoded.email;
        }
      } catch (e) {
        console.log('Could not decode id_token, trying API call...');
      }
    }
    
    // Fallback: try API call (requires userinfo.email scope)
    this.oauth2Client.setCredentials(authTokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    
    try {
      const res = await oauth2.userinfo.get();
      return res.data.email || null;
    } catch (error: any) {
      // If API call fails due to missing scope, check if we can refresh token
      if (error.message && error.message.includes('authentication credential')) {
        throw new Error('Please reconnect Google Calendar to grant email access. The current connection doesn\'t have permission to read your email.');
      }
      console.error('Error getting user email: ' + error);
      throw error;
    }
  }
}
