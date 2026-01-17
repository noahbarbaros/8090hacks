import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Type definitions
interface DailyRecap {
  id: string;
  user_id: string;
  team_id: string;
  submitted_at: string;
  progress: string | null;
  blockers: string | null;
  plan: string | null;
  notes: string | null;
  is_ai_generated: boolean;
}

interface UserConnection {
  slack_user_id: string;
  slack_user_name: string | null;
}

interface FormattedRecap {
  oduserId: string;
  name: string;
  progress: string;
  blockers: string;
  plan: string;
  notes: string;
}

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
          segments: [],
          recapCount: 0,
        },
        { status: 200 }
      );
    }

    // Get user names for context
    const userIds = [...new Set(recaps.map((r: DailyRecap) => r.user_id))];
    const { data: connections } = await supabase
      .from("user_connections")
      .select("slack_user_id, slack_user_name")
      .in("slack_user_id", userIds);

    const userNameMap = new Map(
      (connections || []).map((c: UserConnection) => [
        c.slack_user_id,
        c.slack_user_name || "Team Member",
      ])
    );

    // Format recaps for the AI prompt
    const recapsFormatted: FormattedRecap[] = recaps.map((recap: DailyRecap) => {
      const userName = userNameMap.get(recap.user_id) || "Team Member";
      return {
        oduserId: recap.user_id,
        name: userName,
        progress: recap.progress || "No progress noted",
        blockers: recap.blockers || "No blockers",
        plan: recap.plan || "No plan specified",
        notes: recap.notes || "",
      };
    });

    // Generate individual scripts for each person
    const segments = [];
    
    for (let i = 0; i < recapsFormatted.length; i++) {
      const person = recapsFormatted[i];
      const isFirst = i === 0;
      const isLast = i === recapsFormatted.length - 1;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are writing a first-person standup update script for ${person.name}. 
They will read this aloud as if they're speaking in a standup meeting.

Guidelines:
- Write in FIRST PERSON ("I worked on...", "My blockers are...", "I'm planning to...")
- Start with a brief greeting like "Hey everyone!" or "Morning team!" ${isFirst ? "since they're going first" : ""}
- Keep it conversational and natural - this will be read aloud
- Mention what they accomplished, any blockers, and their plan
- Keep it concise - about 30-45 seconds when spoken (~75-100 words)
- Sound enthusiastic but professional
- ${isLast ? "End with something like 'That\\'s all from me!' or 'Back to you!'" : "End naturally, ready for the next person"}
- Don't use bullet points - write in flowing sentences
- Add natural pauses with "..." where appropriate`,
          },
          {
            role: "user",
            content: `Write ${person.name}'s standup update based on their recap:

Progress: ${person.progress}
Blockers: ${person.blockers}
Plan: ${person.plan}
${person.notes ? `Notes: ${person.notes}` : ""}

Generate their first-person standup script.`,
          },
        ],
        temperature: 0.8,
        max_tokens: 300,
      });

      const script = completion.choices[0]?.message?.content || "";
      
      segments.push({
        oduserId: person.oduserId,
        name: person.name,
        script: script,
        order: i,
      });
    }

    // Also create a combined script for backwards compatibility
    const combinedScript = segments.map(s => `**${s.name}:**\n${s.script}`).join("\n\n---\n\n");

    // Return the generated segments
    return NextResponse.json({
      script: combinedScript,
      segments: segments,
      recapCount: recaps.length,
      date: targetDate,
      participants: recapsFormatted.map((r: FormattedRecap) => ({ userId: r.oduserId, name: r.name })),
    });
  } catch (error: unknown) {
    console.error("Error in POST /api/generate-standup-script:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
