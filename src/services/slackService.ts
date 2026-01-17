import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import path from 'path';

// Initialize dotenv to load environment variables for local testing
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

export class SlackService {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  /**
   * Fetches messages from a Slack channel from the last 24 hours
   * @param channelId The ID of the channel to fetch history from
   */
  async getChannelHistory(channelId: string) {
    try {
      // Calculate timestamp for 24 hours ago
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const oldestTimestamp = (yesterday.getTime() / 1000).toString();

      const result = await this.client.conversations.history({
        channel: channelId,
        oldest: oldestTimestamp,
        limit: 100, // Reasonable limit
      });

      if (!result.messages) {
        return [];
      }

      // Filter messages:
      // 1. Exclude subtype (system messages like channel join/leave)
      // 2. Only return text and user
      const filteredMessages = result.messages
        .filter((msg) => !msg.subtype) // Exclude system messages
        .map((msg) => ({
          text: msg.text || "",
          user: msg.user || "Unknown User",
          ts: msg.ts,
        }));

      return filteredMessages;
    } catch (error) {
      console.error(`Error fetching history for channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Helper to list public channels so we can find the ID
   */
  async listChannels() {
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel', // Only fetch public channels to match available scopes
        limit: 1000,
      });
      return result.channels?.map(c => ({ id: c.id, name: c.name })) || [];
    } catch (error) {
      console.error("Error listing channels:", error);
      throw error;
    }
  }
}

// --- Test Execution Block ---
// This will only run if the file is executed directly (e.g. npx tsx src/services/slackService.ts)
if (require.main === module) {
  (async () => {
    // You can hardcode the token here for the test script or use env var
    const token = process.env.SLACK_BOT_TOKEN;
    
    if (!token) {
      console.error("Please set SLACK_BOT_TOKEN env var or update the script.");
      process.exit(1);
    }

    const slackService = new SlackService(token);

    console.log("1. Listing channels to find #all-8090-hackathon...");
    const channels = await slackService.listChannels();
    
    const targetChannelName = "all-8090-hackathon"; // Adjust if needed
    const targetChannel = channels.find(c => c.name === targetChannelName);

    if (targetChannel && targetChannel.id) {
      console.log(`Found channel #${targetChannel.name} (ID: ${targetChannel.id})`);
      console.log("2. Fetching last 24h of messages...");
      
      const messages = await slackService.getChannelHistory(targetChannel.id);
      
      console.log(`Found ${messages.length} messages:`);
      messages.forEach(msg => {
        console.log(`- [${msg.user}]: ${msg.text}`);
      });
    } else {
      console.log(`Channel #${targetChannelName} not found. Available channels:`);
      channels.forEach(c => console.log(`- #${c.name} (${c.id})`));
      
      // Fallback: try fetching from the first available channel if specific one fails
      if (channels.length > 0 && channels[0].id) {
          console.log(`\nTesting with first available channel: #${channels[0].name}...`);
          const messages = await slackService.getChannelHistory(channels[0].id);
          console.log(`Found ${messages.length} messages.`);
      }
    }
  })();
}

