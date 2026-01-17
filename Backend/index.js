import pkg from "@slack/bolt";
const { App, ExpressReceiver } = pkg;
import "dotenv/config";
import OpenAI from "openai";
import express from "express";

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

// In-memory cache for pre-generated AI summaries (userId -> summary)
const summaryCache = new Map();

// Get commits from Supabase for a user
async function getCommitsFromSupabase(email) {
  try {
    const today = new Date().toISOString().split("T")[0];
    console.log(`🔍 Looking for commits for ${email} on ${today}`);
    
    // Try exact email match first
    let { data, error } = await supabase
      .from("github_commits")
      .select("commits, github_username, email")
      .eq("email", email.toLowerCase())
      .eq("date", today)
      .maybeSingle();

    // If no match, try to find by date only (in case email format differs)
    if (!data) {
      const allToday = await supabase
        .from("github_commits")
        .select("commits, github_username, email")
        .eq("date", today);
      
      if (allToday.data && allToday.data.length > 0) {
        console.log(`📋 Available commits in Supabase for today: ${allToday.data.map(d => d.email).join(", ")}`);
      }
    }

    if (error && error.code !== "PGRST116") {
      console.log(`📭 No commits in Supabase for ${email}: ${error.message}`);
      return null;
    }

    if (data) {
      console.log(`✅ Found ${data.commits?.length || 0} commits for ${data.github_username} (${data.email})`);
      return data.commits;
    }

    return null;
  } catch (e) {
    console.error("Error fetching commits from Supabase:", e);
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

// Legacy function for backward compatibility
async function summarizeCommits(commits) {
  return summarizeActivity(commits, []);
}

// API endpoint for frontend to trigger sending prompts to all channel members
// Accepts optional commits, slackMessages, calendarEvents, and userEmail from frontend for pre-generation
receiver.router.post("/api/send-prompts", async (req, res) => {
  try {
    const { commits, slackMessages, calendarEvents, userEmail } = req.body || {};
    console.log("📤 Triggering Slack prompts to all channel members...");
    console.log(`📊 Received from frontend: ${commits?.length || 0} commits, ${slackMessages?.length || 0} Slack messages, ${calendarEvents?.length || 0} calendar events`);
    
    // Filter Slack messages to only include those from the user
    let filteredSlackMessages = slackMessages || [];
    if (userEmail && slackMessages && slackMessages.length > 0) {
      const slackUserId = await getSlackUserIdFromEmail(userEmail);
      if (slackUserId) {
        filteredSlackMessages = slackMessages.filter((msg) => msg.user === slackUserId);
        console.log(`🔍 Filtered Slack messages: ${slackMessages.length} -> ${filteredSlackMessages.length} (user: ${slackUserId})`);
      } else {
        console.log(`⚠️ Could not find Slack user ID for email ${userEmail}, using all messages`);
      }
    }
    
    await sendPromptsNow(commits, filteredSlackMessages, calendarEvents);
    res.json({ success: true, message: "Prompts sent to all channel members" });
  } catch (e) {
    console.error("Error in /api/send-prompts:", e);
    res.status(500).json({ error: e.message });
  }
});

// API endpoint for frontend to trigger Slack recap
receiver.router.post("/api/send-recap", async (req, res) => {
  try {
    const { email, slackUserId } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Get commits from Supabase
    const commits = await getCommitsFromSupabase(email);
    
    if (!commits || commits.length === 0) {
      return res.status(404).json({ error: "No commits found for today" });
    }

    // Generate AI summary
    console.log(`🤖 Generating AI summary for ${commits.length} commits`);
    const summary = await summarizeCommits(commits);

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

async function sendPromptsNow(frontendCommits = null, frontendSlackMessages = null, frontendCalendarEvents = null) {
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!channelId) {
    console.log("No SLACK_CHANNEL_ID set. Skipping DM send.");
    return;
  }

  let userIds;
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

  // Clear old cache entries
  summaryCache.clear();
  console.log("🧹 Cleared summary cache");

  // If frontend provided commits, Slack messages, or calendar events, use those for ALL users
  // This is the "your commits from the dashboard" scenario
  if (frontendCommits || frontendSlackMessages || frontendCalendarEvents) {
    console.log("🤖 Using frontend data for summary generation...");
    const commits = frontendCommits || [];
    const slackMsgs = frontendSlackMessages || [];
    const calendarEvts = frontendCalendarEvents || [];
    
    if (commits.length > 0 || slackMsgs.length > 0 || calendarEvts.length > 0) {
      console.log(`🤖 Generating summary from ${commits.length} commits + ${slackMsgs.length} Slack messages + ${calendarEvts.length} calendar events`);
      const summary = await summarizeActivity(commits, slackMsgs, calendarEvts);
      
      if (summary) {
        // Normalize summary before caching
        const normalizedSummary = normalizeSummary(summary);
        // Cache the same summary for all users (since it's from the dashboard)
        for (const userId of userIds) {
          summaryCache.set(userId, normalizedSummary);
        }
        console.log(`✅ Cached normalized summary for all ${userIds.length} users`);
      }
    }
  } else {
    // Fall back to per-user Supabase lookups
    console.log("🤖 Pre-generating AI summaries for all users from Supabase...");
    for (const userId of userIds) {
      try {
        const email = await getSlackUserEmail(userId);
        if (email) {
          const commits = await getCommitsFromSupabase(email);
          if (commits && commits.length > 0) {
            console.log(`🤖 Generating summary for ${email} (${commits.length} commits)`);
            const summary = await summarizeActivity(commits, []);
            if (summary) {
              // Normalize summary before caching
              const normalizedSummary = normalizeSummary(summary);
              summaryCache.set(userId, normalizedSummary);
              console.log(`✅ Cached normalized summary for ${userId}`);
            }
          } else {
            console.log(`📭 No commits for ${email}, skipping summary`);
          }
        }
      } catch (e) {
        console.error(`❌ Failed to pre-generate summary for ${userId}:`, e.message);
      }
    }
  }
  console.log(`📦 Pre-generated ${summaryCache.size} summaries`);

  // Now send prompts to all users
  for (const user of userIds) {
    try {
      const hasSummary = summaryCache.has(user);
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

      console.log(`✅ Sent recap prompt to ${user}${hasSummary ? " (with pre-generated summary)" : ""}`);
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
  
  // Check if we have a pre-generated summary in cache
  let prefill = summaryCache.get(userId) || null;
  
  // If we have a cached summary, open the modal immediately with the content
  if (prefill) {
    console.log(`⚡ Using cached summary for ${userId}`);
    console.log(`📋 Cached summary:`, JSON.stringify(prefill));
    
    // Normalize the summary to ensure all fields are strings
    prefill = normalizeSummary(prefill);
    console.log(`✅ Normalized summary:`, JSON.stringify(prefill));
    
    // Remove from cache after use (one-time use)
    summaryCache.delete(userId);
    
    // Open modal directly with prefilled content - no loading state needed!
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
          submitted_at: new Date().toISOString(),
        }),
      },
    });
    return;
  }
  
  // No cached summary - fall back to loading state and generate on-the-fly
  console.log(`⏳ No cached summary for ${userId}, generating on-the-fly...`);
  
  // Initialize prefill (reuse the variable)
  prefill = { progress: "", blockers: "", plan: "" };
  
  // Open modal with loading state
  const modalResult = await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "recap_submit",
      title: { type: "plain_text", text: "Daily Recap" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "⏳ *Loading AI summary from your commits...*" },
        },
      ],
      private_metadata: JSON.stringify({
        user_id: body.user.id,
        submitted_at: new Date().toISOString(),
      }),
    },
  });

  // Fetch commits and AI summary
  const email = await getSlackUserEmail(userId);
  const commits = email ? await getCommitsFromSupabase(email) : null;
  
  if (commits && commits.length > 0) {
    console.log(`🤖 Summarizing ${commits.length} commits for ${email}`);
    const summary = await summarizeActivity(commits, []);
    if (summary) {
      // Normalize summary before using
      prefill = normalizeSummary(summary);
    }
  } else {
    console.log(`📭 No commits found for ${email || userId}`);
  }

  // Update the modal with the AI-generated content
  await client.views.update({
    view_id: modalResult.view.id,
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
        submitted_at: new Date().toISOString(),
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

// Modal submission -> just log
app.view("recap_submit", async ({ ack, body, view, client }) => {
    await ack();
  
    const meta = JSON.parse(view.private_metadata || "{}");
  
    const recap = {
      user_id: meta.user_id,
      team_id: body.team?.id ?? null,
      submitted_at: meta.submitted_at, // ISO string is fine; Supabase casts to timestamptz
      progress: view.state.values.Progress.value.value,
      blockers: view.state.values.Blockers.value.value,
      plan: view.state.values.Plan.value.value,
      notes: view.state.values.Notes?.value?.value || null
    };
  
    const { data, error } = await supabase
      .from("daily_recaps")
      .insert(recap)
      .select()
      .single();
  
    if (error) {
      console.error("❌ Supabase insert failed:", error);
      await client.chat.postMessage({
        channel: meta.user_id,
        text: "Saved failed ❌ (Supabase error). Check server logs."
      });
      return;
    }
  
    console.log("✅ Saved to Supabase:", data.id);
  
    await client.chat.postMessage({
      channel: meta.user_id,
      text: "Saved ✅ (uploaded to Supabase)."
    });
  });
  

// Start once
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Slack recap bot running on port ${port}`);
  console.log(`📡 API endpoints ready:`);
  console.log(`   POST /api/send-prompts - Send prompts to all channel members`);
  console.log(`   POST /api/send-recap - Send recap for a specific user`);
  console.log(`💡 Use the frontend to send recaps to Slack`);
})();
