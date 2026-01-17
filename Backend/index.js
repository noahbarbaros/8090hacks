import { App } from "@slack/bolt";
import "dotenv/config";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const app = new App({
  token: process.env.SLACK_BOT_TOKEN, // xoxb-...
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

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

async function sendPromptsNow() {
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

  for (const user of userIds) {
    try {
      await app.client.chat.postMessage({
        channel: user,
        text: "Daily recap: Want to capture your day?",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Daily recap*\nCapture highlights, challenges, and tomorrow's plan.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Write recap" },
                action_id: "open_recap_modal",
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

      console.log(`✅ Sent recap prompt to ${user}`);
    } catch (e) {
      console.error(`❌ DM failed for ${user}:`, e.data || e.message);
    }
  }
}

// Button -> open modal
app.action("open_recap_modal", async ({ ack, body, client }) => {
  await ack();

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
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Slack recap bot running");

  // DM on startup
  await sendPromptsNow();
})();
