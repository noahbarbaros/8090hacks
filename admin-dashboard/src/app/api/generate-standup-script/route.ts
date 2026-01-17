import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to get today's date string in YYYY-MM-DD format
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split("T")[0];
}

export async function POST(request: NextRequest) {
  try {
    // Check if OpenAI API is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "OpenAI API key is not configured. Please set OPENAI_API_KEY in your environment variables.",
        },
        { status: 500 }
      );
    }

    // Check if Supabase is configured
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        { error: "Supabase configuration is missing." },
        { status: 500 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase client is not initialized." },
        { status: 500 }
      );
    }

    const { teamId, channelId, date } = await request.json();

    // Determine team ID
    let resolvedTeamId = teamId;
    if (channelId && !teamId) {
      // Try to get team ID from channel
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
      try {
        const response = await fetch(
          `${backendUrl}/api/channel-members?channel_id=${encodeURIComponent(channelId)}`
        );
        if (response.ok) {
          const data = await response.json();
          resolvedTeamId = data.teamId;
        }
      } catch (e) {
        console.error("Error fetching team ID from channel:", e);
      }
    }

    if (!resolvedTeamId && !channelId) {
      return NextResponse.json(
        {
          error:
            "Team ID or Channel ID is required. Please load members first.",
        },
        { status: 400 }
      );
    }

    // Use provided date or default to today
    const targetDate = date || getTodayDateString();

    // Fetch all recaps for the team/date
    let query = supabase
      .from("daily_recaps")
      .select(
        "id, user_id, team_id, submitted_at, progress, blockers, plan, notes, is_ai_generated"
      )
      .gte("submitted_at", `${targetDate}T00:00:00Z`)
      .lte("submitted_at", `${targetDate}T23:59:59Z`)
      .order("submitted_at", { ascending: true });

    if (resolvedTeamId) {
      query = query.eq("team_id", resolvedTeamId);
    }

    const { data: recaps, error: recapsError } = await query;

    if (recapsError) {
      console.error("Error fetching recaps:", recapsError);
      return NextResponse.json(
        { error: "Failed to fetch recap data from database." },
        { status: 500 }
      );
    }

    if (!recaps || recaps.length === 0) {
      return NextResponse.json(
        {
          error: `No daily recaps found for ${targetDate}. Make sure team members have submitted their recaps.`,
          script: null,
          recapCount: 0,
        },
        { status: 200 }
      );
    }

    // Get user names for context
    const userIds = [...new Set(recaps.map((r) => r.user_id))];
    const { data: connections } = await supabase
      .from("user_connections")
      .select("slack_user_id, slack_user_name")
      .in("slack_user_id", userIds);

    const userNameMap = new Map(
      (connections || []).map((c) => [
        c.slack_user_id,
        c.slack_user_name || "Team Member",
      ])
    );

    // Format recaps for the AI prompt
    const recapsFormatted = recaps.map((recap) => {
      const userName = userNameMap.get(recap.user_id) || "Team Member";
      return {
        name: userName,
        progress: recap.progress || "No progress noted",
        blockers: recap.blockers || "No blockers",
        plan: recap.plan || "No plan specified",
        notes: recap.notes || "",
      };
    });

    // Build the prompt for OpenAI
    const recapSummary = recapsFormatted
      .map(
        (r, i) =>
          `**${r.name}**:
- Progress: ${r.progress}
- Blockers: ${r.blockers}
- Plan: ${r.plan}${r.notes ? `\n- Notes: ${r.notes}` : ""}`
      )
      .join("\n\n");

    // Generate the standup script using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional standup meeting host. Your job is to create an engaging, natural-sounding script for a team standup meeting based on daily recap submissions.

Guidelines:
- Start with a warm, energetic greeting (e.g., "Good morning team!" or "Hey everyone, welcome to today's standup!")
- Introduce each team member's update conversationally, not robotically
- Highlight key achievements and celebrate wins
- Note blockers clearly so the team is aware
- Mention plans briefly to set expectations
- Keep transitions smooth between speakers
- End with an encouraging closer
- Keep the tone professional yet friendly
- The script should sound natural when read aloud (it will be used for TTS)
- Avoid overly formal language - make it feel like a real team meeting
- Use natural pauses with "..." where appropriate
- Total length should be around 2-3 minutes when spoken (~300-450 words)`,
        },
        {
          role: "user",
          content: `Create a standup meeting script for ${targetDate} based on these team updates:\n\n${recapSummary}\n\nGenerate a natural, engaging standup script that covers all team members' updates.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 1000,
    });

    const script = completion.choices[0]?.message?.content || "";

    // Return the generated script
    return NextResponse.json({
      script,
      recapCount: recaps.length,
      date: targetDate,
      participants: recapsFormatted.map((r) => r.name),
    });
  } catch (error: unknown) {
    console.error("Error in POST /api/generate-standup-script:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

