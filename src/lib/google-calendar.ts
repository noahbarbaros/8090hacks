import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export class GoogleCalendarService {
  private oauth2Client;

  constructor() {
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback";
    
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
}
