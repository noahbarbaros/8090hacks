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

// Helper function to get today's date string in YYYY-MM-DD format (for Supabase queries)
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
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

// Modal submission -> save or update in Supabase
app.view("recap_submit", async ({ ack, body, view, client }) => {
    await ack();
  
    const meta = JSON.parse(view.private_metadata || "{}");
    const recapId = meta.recap_id;
    
    const recapData = {
      user_id: meta.user_id,
      team_id: meta.team_id || (body.team?.id ?? null),
      submitted_at: meta.submitted_at, // ISO string is fine; Supabase casts to timestamptz
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
        channel: meta.user_id,
        text: "Save failed ❌ (Supabase error). Check server logs."
      });
      return;
    }
  
    console.log(`✅ ${recapId ? 'Updated' : 'Saved'} recap in Supabase:`, data.id);
  
    await client.chat.postMessage({
      channel: meta.user_id,
      text: `Saved ✅ ${recapId ? '(updated in Supabase)' : '(uploaded to Supabase)'}.`
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
