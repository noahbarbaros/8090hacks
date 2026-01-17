# Daily Recap Bot

A Slack bot that generates AI-powered daily recaps by connecting to GitHub, Google Calendar, and Slack activity.

## Features

-   **Slack Integration**: Everything works through Slack - no dashboard needed!
-   **GitHub Integration**: Track commits and activity from your repositories
-   **Google Calendar**: Include calendar events in your daily recap
-   **AI-Powered Summaries**: Automatically generates progress, blockers, and plans
-   **Edit & Confirm**: Review and edit AI-generated summaries before saving

## Quick Start: Adding Slack Commands

**TL;DR:** Go to [api.slack.com/apps](https://api.slack.com/apps) → Your App → **Slash Commands** → Create 3 commands:
- `/connect-google` → Request URL: `YOUR_BACKEND_URL/slack/events`
- `/connect-github` → Request URL: `YOUR_BACKEND_URL/slack/events`  
- `/recap` → Request URL: `YOUR_BACKEND_URL/slack/events`

See detailed instructions below.

## Setup

### 1. Database Setup

Run the migration to create the `user_connections` table:

```sql
-- Run migrations/create_user_connections.sql in your Supabase SQL editor
```

### 2. Install Dependencies

**Backend:**
```bash
cd Backend
npm install
```

**Frontend (optional - dashboard still available):**
```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the `Backend` directory with:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CHANNEL_ID=your-channel-id
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CEREBRAS_API_KEY=your-cerebras-api-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
BACKEND_URL=http://localhost:3000
```

### 4. Configure Slack App

#### Step 1: Go to Slack App Settings
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select your app (or create a new one)

#### Step 2: Add Slash Commands
1. In the left sidebar, click **"Slash Commands"** (under Features)
2. Click **"Create New Command"** button
3. Add each command with these settings:

   **Command 1: `/connect-google`**
   - Command: `/connect-google`
   - Request URL: `http://localhost:3000/slack/events` (or your deployed backend URL)
   - Short Description: `Connect your Google Calendar`
   - Usage Hint: (leave empty)
   - Click **"Save"**

   **Command 2: `/connect-github`**
   - Command: `/connect-github`
   - Request URL: `http://localhost:3000/slack/events` (or your deployed backend URL)
   - Short Description: `Connect your GitHub repository`
   - Usage Hint: (leave empty)
   - Click **"Save"**

   **Command 3: `/recap`**
   - Command: `/recap`
   - Request URL: `http://localhost:3000/slack/events` (or your deployed backend URL)
   - Short Description: `Generate your daily recap`
   - Usage Hint: (leave empty)
   - Click **"Save"**

   **Note:** The Request URL should be your backend server URL + `/slack/events`. Slack Bolt automatically handles this route.

#### Step 3: Configure OAuth & Permissions
1. In the left sidebar, click **"OAuth & Permissions"** (under Features)
2. Scroll down to **"Scopes"** section
3. Under **"Bot Token Scopes"**, add these scopes:
   - `chat:write` - Send messages
   - `commands` - Handle slash commands
   - `users:read` - Read user information
   - `users:read.email` - Read user email addresses
   - `channels:read` - View basic channel information
   - `channels:history` - View messages in public channels
4. Scroll to the top and click **"Reinstall to Workspace"** to apply the new scopes

#### Step 4: Get Your Credentials
1. Still in **"OAuth & Permissions"**, copy your **"Bot User OAuth Token"** (starts with `xoxb-`)
   - This is your `SLACK_BOT_TOKEN`
2. In the left sidebar, click **"Basic Information"**
3. Under **"App Credentials"**, copy your **"Signing Secret"**
   - This is your `SLACK_SIGNING_SECRET`

#### Step 5: Install App to Workspace
1. Go back to **"OAuth & Permissions"**
2. Click **"Install to Workspace"** (or **"Reinstall to Workspace"** if already installed)
3. Authorize the app in your workspace

#### Step 6: Get Channel ID (Optional, for Slack message fetching)
1. In Slack, right-click on the channel you want to track
2. Click **"View channel details"** (or open channel info)
3. Scroll down to find the Channel ID (or use the channel URL - the ID is the part after the last `/`)
4. This is your `SLACK_CHANNEL_ID`

### 5. Run the Backend

```bash
cd Backend
node index.js
```

## Usage

### Connect Services

1. **Connect Google Calendar:**
   ```
   /connect-google
   ```
   Click the button to authorize Google Calendar access.

2. **Connect GitHub:**
   ```
   /connect-github
   ```
   Enter your GitHub Personal Access Token (with `repo` scope), repository owner, and repository name.

### Generate Daily Recap

```
/recap
```

The bot will:
1. Fetch your GitHub commits
2. Fetch your Google Calendar events (today and yesterday)
3. Fetch your Slack messages from the configured channel
4. Generate an AI-powered summary
5. Open a modal for you to review and edit
6. Save to Supabase when you submit

## Tech Stack

-   **Backend**: Node.js, Slack Bolt, Express
-   **Database**: Supabase (PostgreSQL)
-   **AI**: Cerebras AI (Llama 3.3 70B)
-   **APIs**: GitHub API, Google Calendar API, Slack API
-   **Frontend** (optional): Next.js, TypeScript, Tailwind CSS
