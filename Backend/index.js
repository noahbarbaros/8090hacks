import pkg from "@slack/bolt";
const { App, ExpressReceiver } = pkg;
import "dotenv/config";
import OpenAI from "openai";
import express from "express";
import { google } from "googleapis";
import { Octokit } from "octokit";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create an Express receiver so we can add custom routes
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Add JSON parsing and CORS for our custom API routes
receiver.router.use((req, res, next) => {
  // CORS headers for frontend
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  
  next();
});

// JSON parsing for API routes
receiver.router.use("/api", express.json());

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Helper function to get today's date string in YYYY-MM-DD format (for Supabase queries)
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

// ==================== USER CONNECTIONS HELPERS ====================

// Get user connection from Supabase
async function getUserConnection(slackUserId, teamId) {
  try {
    const { data, error } = await supabase
      .from("user_connections")
      .select("*")
      .eq("slack_user_id", slackUserId)
      .eq("team_id", teamId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error("❌ Error fetching user connection:", error);
      return null;
    }
    
    return data || null;
  } catch (error) {
    console.error("❌ Error in getUserConnection:", error);
    return null;
  }
}

// Save or update user connection in Supabase
async function saveUserConnection(slackUserId, teamId, updates) {
  try {
    // Check if connection exists
    const existing = await getUserConnection(slackUserId, teamId);
    
    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from("user_connections")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("slack_user_id", slackUserId)
        .eq("team_id", teamId)
        .select()
        .single();
      
      if (error) {
        console.error("❌ Error updating user connection:", error);
        return null;
      }
      
      return data;
    } else {
      // Insert new
      const { data, error } = await supabase
        .from("user_connections")
        .insert({
          slack_user_id: slackUserId,
          team_id: teamId,
          ...updates,
        })
        .select()
        .single();
      
      if (error) {
        console.error("❌ Error creating user connection:", error);
        return null;
      }
      
      return data;
    }
  } catch (error) {
    console.error("❌ Error in saveUserConnection:", error);
    return null;
  }
}

// ==================== GOOGLE CALENDAR HELPERS ====================

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
];

function createGoogleOAuth2Client() {
  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  // Use frontend callback route (Next.js runs on port 3001)
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
  const redirectUri = `${frontendUrl}/api/google/callback`;
  
  if (!client_id || !client_secret) {
    throw new Error("Google credentials not found in environment variables");
  }

  return new google.auth.OAuth2(
    client_id,
    client_secret,
    redirectUri
  );
}

async function fetchUserCalendarEvents(slackUserId, teamId) {
  const connection = await getUserConnection(slackUserId, teamId);
  
  if (!connection || !connection.google_tokens) {
    return [];
  }
  
  try {
    const oauth2Client = createGoogleOAuth2Client();
    oauth2Client.setCredentials(connection.google_tokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    return res.data.items || [];
  } catch (error) {
    console.error("❌ Error fetching calendar events:", error);
    return [];
  }
}

async function getUserEmailFromGoogleTokens(tokens) {
  // First, try to get email from id_token if available
  if (tokens.id_token) {
    try {
      const base64Url = tokens.id_token.split('.')[1];
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
  
  // Fallback: try API call
  const oauth2Client = createGoogleOAuth2Client();
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  
  try {
    const res = await oauth2.userinfo.get();
    return res.data.email || null;
  } catch (error) {
    console.error('Error getting user email:', error);
    return null;
  }
}

// ==================== GITHUB HELPERS ====================

async function fetchUserGitHubCommits(slackUserId, teamId) {
  const connection = await getUserConnection(slackUserId, teamId);
  
  if (!connection || !connection.github_token) {
    return [];
  }
  
  try {
    const octokit = new Octokit({ auth: connection.github_token });
    
    // Get the authenticated user
    const userResponse = await octokit.request("GET /user");
    const userLogin = userResponse.data.login;
    
    // Get all repositories the user has access to
    const reposResponse = await octokit.request("GET /user/repos", {
      per_page: 100,
      sort: "updated",
      direction: "desc",
    });
    
    const repos = reposResponse.data;
    const allCommits = [];
    
    // Fetch commits from each repository
    // Limit to most recently updated repos to avoid too many API calls
    const reposToCheck = repos.slice(0, 20); // Check top 20 most recently updated repos
    
    // Calculate date range for yesterday and today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const sinceDate = yesterday.toISOString();
    
    for (const repo of reposToCheck) {
      try {
        const commitsResponse = await octokit.request("GET /repos/{owner}/{repo}/commits", {
          owner: repo.owner.login,
          repo: repo.name,
          per_page: 10,
          author: userLogin, // Filter by author to get only user's commits
          since: sinceDate, // Only get commits since yesterday
        });
        
        // Filter commits to ensure only those authored by the user
        // Check both author.login and committer.login to be thorough
        const userCommits = commitsResponse.data.filter((commit) => {
          const authorLogin = commit.author?.login;
          const committerLogin = commit.committer?.login;
          return authorLogin === userLogin || committerLogin === userLogin;
        });
        
        // Additional filter: only commits from yesterday and today
        const recentCommits = userCommits.filter((commit) => {
          const commitDate = new Date(commit.commit.author.date);
          commitDate.setHours(0, 0, 0, 0);
          // Check if commit is from today or yesterday
          return commitDate.getTime() === today.getTime() || commitDate.getTime() === yesterday.getTime();
        });
        
        // Add repo info to each commit
        const commitsWithRepo = recentCommits.map(commit => ({
          ...commit,
          repo: repo.name,
          owner: repo.owner.login,
        }));
        
        allCommits.push(...commitsWithRepo);
      } catch (error) {
        // Skip repos that fail (might be private repos without access, etc.)
        console.log(`⚠️ Could not fetch commits from ${repo.owner.login}/${repo.name}:`, error.message);
        continue;
      }
    }
    
    // Sort by date (most recent first) and limit to 50 commits
    const sortedCommits = allCommits
      .sort((a, b) => {
        const dateA = new Date(a.commit.author.date);
        const dateB = new Date(b.commit.author.date);
        return dateB - dateA;
      })
      .slice(0, 50);
    
    return sortedCommits;
  } catch (error) {
    console.error("❌ Error fetching GitHub commits:", error);
    return [];
  }
}

async function fetchUserSlackMessages(slackUserId, channelId) {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const oldestTimestamp = (yesterday.getTime() / 1000).toString();

    const result = await app.client.conversations.history({
      channel: channelId,
      oldest: oldestTimestamp,
      limit: 100,
    });

    if (!result.messages) {
      return [];
    }

    // Filter messages to only include those from the user
    const filteredMessages = result.messages
      .filter((msg) => !msg.subtype && msg.user === slackUserId)
      .map((msg) => ({
        text: msg.text || "",
        user: msg.user || "Unknown User",
        ts: msg.ts,
      }));

    return filteredMessages;
  } catch (error) {
    console.error(`❌ Error fetching Slack messages for user ${slackUserId}:`, error);
    return [];
  }
}

// Helper function to save AI-generated summary to Supabase
async function saveSummaryToSupabase(userId, teamId, summary) {
  const today = getTodayDateString();
  
  try {
    // Check if a recap already exists for today
    const { data: existing } = await supabase
      .from("daily_recaps")
      .select("id")
      .eq("user_id", userId)
      .eq("team_id", teamId)
      .gte("submitted_at", `${today}T00:00:00Z`)
      .lt("submitted_at", `${today}T23:59:59Z`)
      .single();

    const normalizedSummary = normalizeSummary(summary);
    
    if (existing) {
      // Update existing record with AI-generated content
      const { data, error } = await supabase
        .from("daily_recaps")
        .update({
          progress: normalizedSummary.progress,
          blockers: normalizedSummary.blockers,
          plan: normalizedSummary.plan,
          // Keep notes if they exist, otherwise null
          notes: existing.notes || null,
          // Mark as AI-generated draft
          is_ai_generated: true,
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) {
        console.error("❌ Failed to update summary in Supabase:", error);
        return null;
      }
      
      console.log(`✅ Updated AI summary in Supabase for user ${userId} (recap ID: ${data.id})`);
      return data.id;
    } else {
      // Insert new record with AI-generated content
      const { data, error } = await supabase
        .from("daily_recaps")
        .insert({
          user_id: userId,
          team_id: teamId,
          submitted_at: new Date().toISOString(),
          progress: normalizedSummary.progress,
          blockers: normalizedSummary.blockers,
          plan: normalizedSummary.plan,
          notes: null,
          is_ai_generated: true,
        })
        .select()
        .single();

      if (error) {
        console.error("❌ Failed to save summary to Supabase:", error);
        return null;
      }
      
      console.log(`✅ Saved AI summary to Supabase for user ${userId} (recap ID: ${data.id})`);
      return data.id;
    }
  } catch (error) {
    console.error("❌ Error saving summary to Supabase:", error);
    return null;
  }
}

// Helper function to load summary from Supabase
async function loadSummaryFromSupabase(userId, teamId) {
  const today = getTodayDateString();
  
  try {
    const { data, error } = await supabase
      .from("daily_recaps")
      .select("progress, blockers, plan, notes, id")
      .eq("user_id", userId)
      .eq("team_id", teamId)
      .gte("submitted_at", `${today}T00:00:00Z`)
      .lt("submitted_at", `${today}T23:59:59Z`)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No record found - this is fine
        return null;
      }
      console.error("❌ Failed to load summary from Supabase:", error);
      return null;
    }

    return {
      progress: data.progress || "",
      blockers: data.blockers || "",
      plan: data.plan || "",
      notes: data.notes || "",
      recap_id: data.id, // Store the ID so we can update it later
    };
  } catch (error) {
    console.error("❌ Error loading summary from Supabase:", error);
    return null;
  }
}

// Summarize commits, Slack messages, and calendar events using OpenAI - returns bullet point format
async function summarizeActivity(commits, slackMessages = [], calendarEvents = []) {
  if ((!commits || commits.length === 0) && (!slackMessages || slackMessages.length === 0) && (!calendarEvents || calendarEvents.length === 0)) {
    return null;
  }

  // Format commits - handle both Supabase format and GitHub API format
  const commitList = commits && commits.length > 0
    ? commits.map((c) => {
        // GitHub API format: c.commit.message
        // Supabase format: c.message
        const message = c.commit?.message || c.message || "No message";
        const repo = c.repo || "8090hacks";
        return `- ${repo}: ${message}`;
      }).join("\n")
    : "No commits today.";

  // Format Slack messages
  const slackList = slackMessages && slackMessages.length > 0
    ? slackMessages.map((m) => `- ${m.text}`).join("\n")
    : "";

  // Format calendar events
  const calendarList = calendarEvents && calendarEvents.length > 0
    ? calendarEvents.map((e) => {
        const title = e.summary || "Untitled event";
        const dateTime = e.start?.dateTime 
          ? new Date(e.start.dateTime).toLocaleString()
          : e.start?.date || "All day";
        return `- ${title} (${dateTime})`;
      }).join("\n")
    : "";

  const contextParts = [];
  if (commits && commits.length > 0) {
    contextParts.push(`Git commits:\n${commitList}`);
  }
  if (slackMessages && slackMessages.length > 0) {
    contextParts.push(`Recent Slack activity:\n${slackList}`);
  }
  if (calendarEvents && calendarEvents.length > 0) {
    contextParts.push(`Calendar events (today and yesterday):\n${calendarList}`);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that summarizes developer work for daily standups.
Given git commits, Slack messages, and/or calendar events, generate a summary in bullet point format.

Return JSON with these fields (all must be strings):
- progress: A bullet point list (using • symbol) of what was accomplished, grouped by feature/area
- blockers: A bullet point list of potential challenges (or "• None identified" if unclear)
- plan: A bullet point list of suggested next steps based on the work done

Example format for each field:
"• Implemented user authentication flow
• Fixed bug in payment processing
• Updated API documentation"

IMPORTANT: Each field MUST be a string. Use 3-5 bullet points per field. Be concise and professional.`,
        },
        {
          role: "user",
          content: `Here is today's activity:\n\n${contextParts.join("\n\n")}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Ensure all fields are strings (fix for Slack API requirement)
    return {
      progress: String(result.progress || ""),
      blockers: String(result.blockers || ""),
      plan: String(result.plan || ""),
    };
  } catch (e) {
    console.error("OpenAI error:", e.message);
    return null;
  }
}


// ==================== OAUTH CALLBACK ROUTES ====================

// Google OAuth callback - receives code, exchanges via frontend, saves to Supabase
receiver.router.get("/api/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).send("No authorization code provided");
    }
    
    if (!state) {
      return res.status(400).send("No state parameter provided");
    }
    
    // Parse state: format is "slack_user_id|team_id"
    const [slackUserId, teamId] = state.split('|');
    
    if (!slackUserId || !teamId) {
      return res.status(400).send("Invalid state parameter");
    }
    
    // Exchange code for tokens via frontend API
    // Ensure code is a string (it might be an array from query params)
    const codeString = Array.isArray(code) ? code[0] : code;
    
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
    const exchangeResponse = await fetch(`${frontendUrl}/api/google/exchange-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeString }),
    });
    
    if (!exchangeResponse.ok) {
      const errorData = await exchangeResponse.json().catch(() => ({}));
      const errorMessage = errorData.error || "Failed to exchange code for tokens";
      console.error(`❌ Token exchange failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }
    
    const { tokens, email } = await exchangeResponse.json();
    
    if (!tokens) {
      throw new Error("No tokens returned from frontend");
    }
    
    // Get Slack user info (name)
    const userInfo = await getSlackUserInfo(slackUserId);
    
    // Save tokens to Supabase with user name
    const connection = await saveUserConnection(slackUserId, teamId, {
      slack_user_name: userInfo.name,
      google_tokens: tokens,
    });
    
    if (!connection) {
      return res.status(500).send("Failed to save connection. Please try again.");
    }
    
    // Notify user in Slack
    try {
      await app.client.chat.postMessage({
        channel: slackUserId,
        text: email 
          ? `✅ Google Calendar connected successfully! (${email})\n\nYou can close this browser window and return to Slack.`
          : "✅ Google Calendar connected successfully!\n\nYou can close this browser window and return to Slack.",
      });
    } catch (slackError) {
      console.error("Failed to send Slack notification:", slackError);
    }
    
    res.send(`
      <html>
        <body>
          <h1>✅ Google Calendar Connected!</h1>
          <p>You can close this window and return to Slack.</p>
          <script>setTimeout(() => window.close(), 2000);</script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ Error in Google OAuth callback:", error);
    res.status(500).send("Authentication failed. Please try again.");
  }
});

// API endpoint for frontend to trigger sending prompts to a specific user
// Accepts optional commits, slackMessages, calendarEvents, and googleEmail from frontend
// Sends prompt only to the Slack account associated with the Google Calendar email
receiver.router.post("/api/send-prompts", async (req, res) => {
  try {
    const { commits, slackMessages, calendarEvents, googleEmail } = req.body || {};
    console.log("📤 Triggering Slack prompt to specific user...");
    console.log(`📊 Received from frontend: ${commits?.length || 0} commits, ${slackMessages?.length || 0} Slack messages, ${calendarEvents?.length || 0} calendar events`);
    
    if (!googleEmail) {
      return res.status(400).json({ error: "Google email is required. Please connect Google Calendar first." });
    }
    
    // Get Slack user ID from Google email
    const slackUserId = await getSlackUserIdFromEmail(googleEmail);
    if (!slackUserId) {
      return res.status(404).json({ error: `Could not find Slack user for email ${googleEmail}. Make sure the email matches your Slack account.` });
    }
    
    console.log(`✅ Found Slack user ${slackUserId} for email ${googleEmail}`);
    
    // Filter Slack messages to only include those from the user
    let filteredSlackMessages = slackMessages || [];
    if (slackMessages && slackMessages.length > 0) {
      filteredSlackMessages = slackMessages.filter((msg) => msg.user === slackUserId);
      console.log(`🔍 Filtered Slack messages: ${slackMessages.length} -> ${filteredSlackMessages.length} (user: ${slackUserId})`);
    }
    
    await sendPromptsNow(commits, filteredSlackMessages, calendarEvents, slackUserId);
    res.json({ success: true, message: `Prompt sent to ${googleEmail}` });
  } catch (e) {
    console.error("Error in /api/send-prompts:", e);
    res.status(500).json({ error: e.message });
  }
});

// API endpoint for frontend to trigger Slack recap
receiver.router.post("/api/send-recap", async (req, res) => {
  try {
    const { email, slackUserId, commits, slackMessages, calendarEvents } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Get commits from frontend (required)
    if (!commits || commits.length === 0) {
      return res.status(400).json({ error: "Commits are required from frontend" });
    }

    // Generate AI summary
    console.log(`🤖 Generating AI summary for ${commits.length} commits`);
    const summary = await summarizeActivity(commits, slackMessages || [], calendarEvents || []);

    if (!summary) {
      return res.status(500).json({ error: "Failed to generate AI summary" });
    }

    // If slackUserId provided, send DM with prefilled recap
    if (slackUserId) {
      await app.client.chat.postMessage({
        channel: slackUserId,
        text: "Here's your AI-generated daily recap:",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "📋 Your Daily Recap", emoji: true },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Progress:*\n${summary.progress}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Blockers:*\n${summary.blockers}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Plan:*\n${summary.plan}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "✏️ Edit & Save", emoji: true },
                action_id: "open_recap_modal",
                style: "primary",
              },
            ],
          },
        ],
      });
    }

    res.json({ 
      success: true, 
      summary,
      message: slackUserId ? "Recap sent to Slack" : "Summary generated" 
    });
  } catch (e) {
    console.error("Error in /api/send-recap:", e);
    res.status(500).json({ error: e.message });
  }
});

// Helper to generate script for a single recap
async function generateScriptForRecap(recap) {
  try {
    // Get user name
    const userInfo = await getSlackUserInfo(recap.user_id);
    const userName = userInfo.name || "Unknown User";
    
    // Construct prompt content from recap
    const recapContent = `
      Progress: ${recap.progress || "None"}
      Blockers: ${recap.blockers || "None"}
      Plan: ${recap.plan || "None"}
      Notes: ${recap.notes || "None"}
    `;
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a scriptwriter. Convert this technical daily standup update into a natural, spoken script for a podcast. 
The user is ${userName}. Start with "Hi, I'm ${userName}". 
Avoid bullet points, use full sentences. Keep it under 1 minute spoken (approx 150 words).
Make it sound conversational but professional.`,
        },
        {
          role: "user",
          content: recapContent,
        },
      ],
    });
    
    const scriptText = response.choices[0].message.content;
    
    return {
      recap_id: recap.id,
      user_id: recap.user_id,
      user_name: userName,
      script: scriptText,
    };
  } catch (e) {
    console.error(`❌ OpenAI generation failed for user ${recap.user_id}:`, e.message);
    return null;
  }
}

// API endpoint to generate TTS scripts from daily recaps
receiver.router.post("/api/generate-scripts", async (req, res) => {
  try {
    const { recap_id, date, team_id } = req.body;
    
    console.log("🎬 Generating TTS scripts...");
    
    let query = supabase
      .from("daily_recaps")
      .select("*");
      
    if (recap_id) {
      query = query.eq("id", recap_id);
    } else {
      // Default to today if no date provided
      const targetDate = date || getTodayDateString();
      query = query
        .gte("submitted_at", `${targetDate}T00:00:00Z`)
        .lt("submitted_at", `${targetDate}T23:59:59Z`);
        
      if (team_id) {
        query = query.eq("team_id", team_id);
      }
    }
    
    const { data: recaps, error } = await query;
    
    if (error) {
      console.error("❌ Supabase query failed:", error);
      return res.status(500).json({ error: "Failed to fetch recaps" });
    }
    
    if (!recaps || recaps.length === 0) {
      return res.json({ scripts: [] });
    }
    
    console.log(`📝 Found ${recaps.length} recaps to process`);
    
    const scripts = [];
    
    for (const recap of recaps) {
      const script = await generateScriptForRecap(recap);
      if (script) {
        scripts.push(script);
        
        // Save to DB (upsert based on recap_id)
        const { error: saveError } = await supabase
          .from("daily_recap_scripts")
          .upsert({
            recap_id: script.recap_id,
            user_id: script.user_id,
            script_text: script.script,
          }, { onConflict: "recap_id" });
          
        if (saveError) {
          console.error(`⚠️ Failed to save script for recap ${script.recap_id}:`, saveError);
        }
      }
    }
    
    res.json({ scripts });
    
  } catch (e) {
    console.error("Error in /api/generate-scripts:", e);
    res.status(500).json({ error: e.message });
  }
});

// Get Slack user's email
async function getSlackUserEmail(userId) {
  try {
    const result = await app.client.users.info({
      user: userId,
    });
    const email = result.user?.profile?.email?.toLowerCase();
    if (!email) {
      console.log(`⚠️ No email found for Slack user ${userId}. Make sure 'users:read.email' scope is enabled.`);
    }
    return email;
  } catch (e) {
    console.error("Failed to get user email:", e.message);
    return null;
  }
}

// Get Slack user's name and email
async function getSlackUserInfo(userId) {
  try {
    const result = await app.client.users.info({
      user: userId,
    });
    const user = result.user;
    return {
      name: user?.real_name || user?.display_name || user?.name || "Unknown",
      email: user?.profile?.email?.toLowerCase() || null,
    };
  } catch (e) {
    console.error("Failed to get user info:", e.message);
    return {
      name: "Unknown",
      email: null,
    };
  }
}

// Get Slack user ID from email (reverse lookup)
async function getSlackUserIdFromEmail(email) {
  if (!email) return null;
  
  try {
    // List all users and find the one with matching email
    const result = await app.client.users.list();
    const user = result.members?.find(
      (u) => u.profile?.email?.toLowerCase() === email.toLowerCase()
    );
    return user?.id || null;
  } catch (e) {
    console.error("Failed to get Slack user ID from email:", e.message);
    return null;
  }
}

async function getChannelMembers(channelId) {
  const members = [];
  let cursor;

  do {
    const result = await app.client.conversations.members({
      channel: channelId,
      cursor,
      limit: 200,
    });
    members.push(...result.members);
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  // Filter out bots by checking user info
  const humanMembers = [];
  for (const userId of members) {
    try {
      const userInfo = await app.client.users.info({ user: userId });
      if (!userInfo.user.is_bot && !userInfo.user.id.startsWith("USLACKBOT")) {
        humanMembers.push(userId);
      }
    } catch (e) {
      console.error(`Failed to get info for ${userId}:`, e.message);
    }
  }

  return humanMembers;
}

async function sendPromptsNow(frontendCommits = null, frontendSlackMessages = null, frontendCalendarEvents = null, targetSlackUserId = null) {
  // If targetSlackUserId is provided, send only to that user
  // Otherwise, send to all channel members (legacy behavior)
  let userIds;
  
  if (targetSlackUserId) {
    // Send only to the specific user
    userIds = [targetSlackUserId];
    console.log(`📤 Sending prompt to specific user: ${targetSlackUserId}`);
  } else {
    // Legacy: send to all channel members
    const channelId = process.env.SLACK_CHANNEL_ID;
    if (!channelId) {
      console.log("No SLACK_CHANNEL_ID set. Skipping DM send.");
      return;
    }

    try {
      userIds = await getChannelMembers(channelId);
      console.log(`📋 Found ${userIds.length} users in channel ${channelId}`);
    } catch (e) {
      console.error("❌ Failed to fetch channel members:", e.data || e.message);
      return;
    }

    if (userIds.length === 0) {
      console.log("No users found in channel. Skipping DM send.");
      return;
    }
  }

  // If frontend provided commits, Slack messages, or calendar events WITH ACTUAL CONTENT, use those for ALL users
  // This is the "your commits from the dashboard" scenario
  // Check if arrays exist AND have content (empty arrays are truthy but have no data)
  // Handle null, undefined, and empty arrays properly
  const hasFrontendCommits = Array.isArray(frontendCommits) && frontendCommits.length > 0;
  const hasFrontendSlackMessages = Array.isArray(frontendSlackMessages) && frontendSlackMessages.length > 0;
  const hasFrontendCalendarEvents = Array.isArray(frontendCalendarEvents) && frontendCalendarEvents.length > 0;
  
  console.log(`🔍 Frontend data check: commits=${hasFrontendCommits} (${frontendCommits?.length || 0}), slack=${hasFrontendSlackMessages} (${frontendSlackMessages?.length || 0}), calendar=${hasFrontendCalendarEvents} (${frontendCalendarEvents?.length || 0})`);
  
  if (hasFrontendCommits || hasFrontendSlackMessages || hasFrontendCalendarEvents) {
    console.log("🤖 Using frontend data for summary generation...");
    const commits = frontendCommits || [];
    const slackMsgs = frontendSlackMessages || [];
    const calendarEvts = frontendCalendarEvents || [];
    
    console.log(`🤖 Generating summary from ${commits.length} commits + ${slackMsgs.length} Slack messages + ${calendarEvts.length} calendar events`);
    const summary = await summarizeActivity(commits, slackMsgs, calendarEvts);
    
    if (summary) {
      // Get team_id from auth context (workspace ID)
      let teamId = null;
      try {
        const authResult = await app.client.auth.test();
        teamId = authResult.team_id || null;
      } catch (e) {
        console.log("⚠️ Could not get team_id from auth, will use null");
      }
      
      // Save summaries to Supabase for each user
      for (const userId of userIds) {
        try {
          await saveSummaryToSupabase(userId, teamId, summary);
        } catch (e) {
          console.error(`❌ Failed to save summary for user ${userId}:`, e.message);
        }
      }
      console.log(`✅ Saved AI summaries to Supabase for ${userIds.length} user(s)`);
    } else {
      console.log("⚠️ No summary generated from frontend data");
    }
  }
  
  // If no frontend data was provided, we can't generate summaries (commits must come from frontend)
  if (!hasFrontendCommits && !hasFrontendSlackMessages && !hasFrontendCalendarEvents) {
    console.log("⚠️ No frontend data provided. Summaries will be generated on-demand when users click the button.");
    console.log("💡 Frontend should provide commits, Slack messages, or calendar events for pre-generation.");
  }

  // Get team_id from auth context (workspace ID) - do this once for all users
  let teamId = null;
  try {
    const authResult = await app.client.auth.test();
    teamId = authResult.team_id || null;
  } catch (e) {
    console.log("⚠️ Could not get team_id from auth, will use null");
  }

  // Now send prompts to all users
  for (const user of userIds) {
    try {
      // Check if user has a summary in Supabase for today
      const existingSummary = await loadSummaryFromSupabase(user, teamId);
      const hasSummary = !!existingSummary;
      
      await app.client.chat.postMessage({
        channel: user,
        text: "Daily recap: Want to capture your day?",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: hasSummary 
                ? "*Daily recap*\n✨ Your AI-generated summary is ready! Click below to review and edit."
                : "*Daily recap*\nCapture highlights, challenges, and tomorrow's plan.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: hasSummary ? "📝 Review recap" : "Write recap" },
                action_id: "open_recap_modal",
                style: hasSummary ? "primary" : undefined,
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Skip today" },
                action_id: "skip_today",
              },
            ],
          },
        ],
      });

      console.log(`✅ Sent recap prompt to ${user}${hasSummary ? " (with pre-generated summary in Supabase)" : ""}`);
    } catch (e) {
      console.error(`❌ DM failed for ${user}:`, e.data || e.message);
    }
  }
}

// Helper to safely get initial_value for Slack input (must be non-empty string or undefined)
function getInitialValue(value) {
  // Convert to string and trim
  const strValue = String(value || "").trim();
  if (strValue.length > 0) {
    return { initial_value: strValue };
  }
  return {};
}

// Helper to normalize summary object - ensures all fields are strings
function normalizeSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return { progress: "", blockers: "", plan: "" };
  }
  return {
    progress: String(summary.progress || "").trim(),
    blockers: String(summary.blockers || "").trim(),
    plan: String(summary.plan || "").trim(),
  };
}

// Button -> open modal with AI-prefilled content
app.action("open_recap_modal", async ({ ack, body, client }) => {
  await ack();

  const userId = body.user.id;
  const teamId = body.team?.id || null;
  
  // Load summary from Supabase
  let prefill = await loadSummaryFromSupabase(userId, teamId);
  
  // If we have a summary in Supabase, use it
  if (prefill) {
    console.log(`⚡ Loaded summary from Supabase for ${userId}`);
    console.log(`📋 Summary:`, JSON.stringify(prefill));
    
    // Normalize the summary to ensure all fields are strings
    prefill = normalizeSummary(prefill);
    console.log(`✅ Normalized summary:`, JSON.stringify(prefill));
    
    // Open modal with prefilled content
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "recap_submit",
        title: { type: "plain_text", text: "Daily Recap" },
        submit: { type: "plain_text", text: "Save" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "Progress",
            optional: true,
            label: { type: "plain_text", text: "What have you been working on the past day?" },
            element: {
              type: "plain_text_input",
              action_id: "value",
              multiline: true,
              ...getInitialValue(prefill.progress),
            },
          },
          {
            type: "input",
            block_id: "Blockers",
            optional: true,
            label: { type: "plain_text", text: "What are some challenges/blockers you faced in the past day of work?" },
            element: {
              type: "plain_text_input",
              action_id: "value",
              multiline: true,
              ...getInitialValue(prefill.blockers),
            },
          },
          {
            type: "input",
            block_id: "Plan",
            optional: true,
            label: { type: "plain_text", text: "What is your plan for today?" },
            element: {
              type: "plain_text_input",
              action_id: "value",
              multiline: true,
              ...getInitialValue(prefill.plan),
            },
          },
          {
            type: "input",
            block_id: "Notes",
            optional: true,
            label: { type: "plain_text", text: "Any additional notes you might have" },
            element: {
              type: "plain_text_input",
              action_id: "value",
              multiline: true,
              ...getInitialValue(prefill.notes),
            },
          },
        ],
        private_metadata: JSON.stringify({
          user_id: body.user.id,
          team_id: teamId,
          submitted_at: new Date().toISOString(),
          recap_id: prefill.recap_id || null, // Store the recap ID so we can update it
        }),
      },
    });
    return;
  }
  
  // No summary in Supabase - open modal with empty fields
  console.log(`⏳ No summary found in Supabase for ${userId}, opening empty modal`);
  
  // Initialize prefill as empty
  prefill = { progress: "", blockers: "", plan: "", notes: "" };
  
  // Open modal with empty fields
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "recap_submit",
      title: { type: "plain_text", text: "Daily Recap" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "Progress",
          optional: true,
          label: { type: "plain_text", text: "What have you been working on the past day?" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            ...getInitialValue(prefill.progress),
          },
        },
        {
          type: "input",
          block_id: "Blockers",
          optional: true,
          label: { type: "plain_text", text: "What are some challenges/blockers you faced in the past day of work?" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            ...getInitialValue(prefill.blockers),
          },
        },
        {
          type: "input",
          block_id: "Plan",
          optional: true,
          label: { type: "plain_text", text: "What is your plan for today?" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            ...getInitialValue(prefill.plan),
          },
        },
        {
          type: "input",
          block_id: "Notes",
          optional: true,
          label: { type: "plain_text", text: "Any additional notes you might have" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
          },
        },
      ],
      private_metadata: JSON.stringify({
        user_id: body.user.id,
        team_id: teamId,
        submitted_at: new Date().toISOString(),
        recap_id: null,
      }),
    },
  });
});

// Skip button
app.action("skip_today", async ({ ack, body, client }) => {
  await ack();
  await client.chat.postMessage({
    channel: body.user.id,
    text: "No problem — I won’t bug you again today.",
  });
});

// ==================== SLASH COMMANDS ====================

// /connect-google - Initiate Google Calendar OAuth (uses frontend for auth URL)
app.command("/connect-google", async ({ ack, body, client }) => {
  try {
    await ack();
  } catch (ackError) {
    console.error("❌ Failed to acknowledge command:", ackError);
    return;
  }
  
  const userId = body.user_id;
  const teamId = body.team_id;
  
  try {
    // Get auth URL from frontend (which has the Google credentials)
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
    const state = `${userId}|${teamId}`;
    
    const response = await fetch(`${frontendUrl}/api/google/auth-url?state=${encodeURIComponent(state)}&backend_url=${encodeURIComponent(backendUrl)}`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to get Google auth URL from frontend");
    }
    
    const { authUrl } = await response.json();
    
    if (!authUrl) {
      throw new Error("No auth URL returned from frontend");
    }
    
    await client.chat.postMessage({
      channel: userId,
      text: `Connect Google Calendar\n\nClick here to authorize: ${authUrl}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔗 *Connect Google Calendar*\n\nClick the button below to open Google's authorization page in your browser. You'll be asked to sign in and grant access to your Google Calendar.",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🔐 Authorize Google Calendar", emoji: true },
              url: authUrl,
              style: "primary",
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Or copy this link: <${authUrl}|Open in browser>`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("❌ Error in /connect-google:", error);
    await client.chat.postMessage({
      channel: userId,
      text: error.message && error.message.includes("frontend")
        ? "❌ Failed to connect to frontend. Make sure the frontend is running and accessible."
        : "❌ Failed to generate Google Calendar connection link. Please try again later.",
    });
  }
});

// /connect-github - Open modal to enter GitHub token only
app.command("/connect-github", async ({ ack, body, client }) => {
  try {
    await ack();
  } catch (ackError) {
    console.error("❌ Failed to acknowledge command:", ackError);
    return;
  }
  
  const userId = body.user_id;
  const teamId = body.team_id;
  
  try {
    // Check if already connected
    const connection = await getUserConnection(userId, teamId);
    const hasGitHub = connection && connection.github_token;
    
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "github_connect",
        title: { type: "plain_text", text: "Connect GitHub" },
        submit: { type: "plain_text", text: "Connect" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: hasGitHub 
                ? "🔗 *Update GitHub Connection*\n\nEnter your GitHub Personal Access Token. We'll fetch commits from all repositories you have access to."
                : "🔗 *Connect GitHub*\n\nEnter your GitHub Personal Access Token. We'll fetch commits from all repositories you have access to.",
            },
          },
          {
            type: "input",
            block_id: "github_token",
            label: { type: "plain_text", text: "GitHub Personal Access Token" },
            element: {
              type: "plain_text_input",
              action_id: "value",
              placeholder: { type: "plain_text", text: "ghp_..." },
              ...(hasGitHub && connection.github_token ? { initial_value: connection.github_token } : {}),
            },
            hint: { type: "plain_text", text: "Create a token at github.com/settings/tokens with 'repo' scope" },
          },
        ],
        private_metadata: JSON.stringify({
          user_id: userId,
          team_id: teamId,
        }),
      },
    });
  } catch (error) {
    console.error("❌ Error in /connect-github:", error);
    try {
      await client.chat.postMessage({
        channel: userId,
        text: "❌ Failed to open GitHub connection modal. Please try again later.",
      });
    } catch (postError) {
      console.error("❌ Failed to send error message:", postError);
    }
  }
});

// Handle GitHub connection modal submission
app.view("github_connect", async ({ ack, body, view, client }) => {
  await ack();
  
  const meta = JSON.parse(view.private_metadata || "{}");
  const userId = meta.user_id;
  const teamId = meta.team_id;
  
  const token = view.state.values.github_token?.value?.value || "";
  
  if (!token) {
    await client.chat.postMessage({
      channel: userId,
      text: "❌ Token is required. Please try again.",
    });
    return;
  }
  
  // Validate token by making a test API call
  try {
    const octokit = new Octokit({ auth: token });
    const userResponse = await octokit.request("GET /user");
    const username = userResponse.data.login;
    
    // Get Slack user info (name)
    const userInfo = await getSlackUserInfo(userId);
    
    // Save connection (only token, no owner/repo) with user name
    const connection = await saveUserConnection(userId, teamId, {
      slack_user_name: userInfo.name,
      github_token: token,
      github_owner: null,
      github_repo: null,
    });
    
    if (connection) {
      await client.chat.postMessage({
        channel: userId,
        text: `✅ GitHub connected successfully! (${username})\n\nWe'll fetch commits from all repositories you have access to.`,
      });
    } else {
      await client.chat.postMessage({
        channel: userId,
        text: "❌ Failed to save GitHub connection. Please try again.",
      });
    }
  } catch (error) {
    console.error("❌ Error validating GitHub token:", error);
    await client.chat.postMessage({
      channel: userId,
      text: "❌ Invalid GitHub token. Please check your token and try again.",
    });
  }
});

// /recap - Generate daily recap from all connected services
app.command("/recap", async ({ ack, body, client }) => {
  try {
    await ack();
  } catch (ackError) {
    console.error("❌ Failed to acknowledge command:", ackError);
    return;
  }
  
  // Always use the actual Slack user who ran the command
  const userId = body.user_id;
  const teamId = body.team_id;
  
  console.log(`📝 /recap command executed by Slack user: ${userId} (team: ${teamId})`);
  
  try {
    // Send initial message
    const loadingMessage = await client.chat.postMessage({
      channel: userId,
      text: "🔄 Generating your daily recap...",
    });
    
    // Fetch data from all connected services
    const [commits, calendarEvents, slackMessages] = await Promise.all([
      fetchUserGitHubCommits(userId, teamId),
      fetchUserCalendarEvents(userId, teamId),
      fetchUserSlackMessages(userId, process.env.SLACK_CHANNEL_ID || ""),
    ]);
    
    console.log(`📊 Fetched data for user ${userId}: ${commits.length} commits, ${calendarEvents.length} calendar events, ${slackMessages.length} Slack messages`);
    
    // Filter calendar events to today and yesterday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const filteredCalendarEvents = calendarEvents.filter((event) => {
      if (!event.start?.dateTime && !event.start?.date) return false;
      
      const eventDate = event.start.dateTime 
        ? new Date(event.start.dateTime)
        : new Date(event.start.date);
      eventDate.setHours(0, 0, 0, 0);
      
      return eventDate.getTime() === today.getTime() || eventDate.getTime() === yesterday.getTime();
    });
    
    // Generate AI summary
    const summary = await summarizeActivity(commits, slackMessages, filteredCalendarEvents);
    
    if (!summary) {
      await client.chat.update({
        channel: loadingMessage.channel,
        ts: loadingMessage.ts,
        text: "⚠️ No activity found to summarize. Make sure you've connected GitHub and Google Calendar, and have some recent activity.",
      });
      return;
    }
    
    // Save summary to Supabase (using actual Slack user ID)
    console.log(`💾 Saving summary to Supabase for user ${userId}`);
    await saveSummaryToSupabase(userId, teamId, summary);
    
    // Update message with button to open modal
    await client.chat.update({
      channel: loadingMessage.channel,
      ts: loadingMessage.ts,
      text: "✅ Your daily recap is ready!",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "✅ *Your daily recap is ready!*\n\nClick the button below to review and edit your AI-generated summary.",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "📝 Review & Edit Recap", emoji: true },
              action_id: "open_recap_modal",
              style: "primary",
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("❌ Error in /recap:", error);
    await client.chat.postMessage({
      channel: userId,
      text: "❌ Failed to generate recap. Please try again later.",
    });
  }
});

// Modal submission -> save or update in Supabase
app.view("recap_submit", async ({ ack, body, view, client }) => {
    await ack();
  
    // Always use the actual Slack user who submitted the form
    const userId = body.user.id;
    const teamId = body.team?.id || null;
    
    const meta = JSON.parse(view.private_metadata || "{}");
    const recapId = meta.recap_id;
    
    const recapData = {
      user_id: userId, // Use actual user from body, not metadata
      team_id: teamId,
      submitted_at: meta.submitted_at || new Date().toISOString(), // ISO string is fine; Supabase casts to timestamptz
      progress: view.state.values.Progress?.value?.value || "",
      blockers: view.state.values.Blockers?.value?.value || "",
      plan: view.state.values.Plan?.value?.value || "",
      notes: view.state.values.Notes?.value?.value || null,
      is_ai_generated: false, // Mark as user-edited
    };
  
    let data, error;
    
    if (recapId) {
      // Update existing record
      console.log(`🔄 Updating existing recap ${recapId} in Supabase`);
      const result = await supabase
        .from("daily_recaps")
        .update(recapData)
        .eq("id", recapId)
        .select()
        .single();
      
      data = result.data;
      error = result.error;
    } else {
      // Insert new record
      console.log(`➕ Inserting new recap to Supabase`);
      const result = await supabase
        .from("daily_recaps")
        .insert(recapData)
        .select()
        .single();
      
      data = result.data;
      error = result.error;
    }
  
    if (error) {
      console.error("❌ Supabase save failed:", error);
      await client.chat.postMessage({
        channel: userId,
        text: "Save failed ❌ (Supabase error). Check server logs."
      });
      return;
    }
  
    console.log(`✅ ${recapId ? 'Updated' : 'Saved'} recap in Supabase for user ${userId} (recap ID: ${data.id})`);
  
    await client.chat.postMessage({
      channel: userId,
      text: `Saved ✅ ${recapId ? '(updated in Supabase)' : '(uploaded to Supabase)'}.`
    });

    // Auto-generate script immediately in background
    // Don't wait for ack() to complete
    try {
      console.log(`🎬 Auto-generating script for recap ${data.id}...`);
      const scriptData = await generateScriptForRecap(data);
      if (scriptData) {
        console.log(`✅ Script generated successfully for ${data.id}`);
        
        // Save script to Supabase (upsert based on recap_id)
        const { error: scriptError } = await supabase
          .from("daily_recap_scripts")
          .upsert({
            recap_id: scriptData.recap_id,
            user_id: scriptData.user_id,
            script_text: scriptData.script,
          }, { onConflict: "recap_id" });
          
        if (scriptError) {
          console.error(`❌ Failed to save script to DB:`, scriptError);
        } else {
          console.log(`💾 Script saved to daily_recap_scripts table`);
        }
      }
    } catch (bgError) {
      console.error("❌ Background script generation failed:", bgError);
    }
  });
  

// Start once
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Slack recap bot running on port ${port}`);
  console.log(`📡 API endpoints ready:`);
  console.log(`   POST /api/send-prompts - Send prompts to all channel members`);
  console.log(`   POST /api/send-recap - Send recap for a specific user`);
  console.log(`   GET  /api/google/callback - Google OAuth callback`);
  console.log(`💬 Slack commands available:`);
  console.log(`   /connect-google - Connect Google Calendar`);
  console.log(`   /connect-github - Connect GitHub repository`);
  console.log(`   /recap - Generate and edit daily recap`);
  console.log(`💡 Everything works through Slack - no dashboard needed!`);
})();
