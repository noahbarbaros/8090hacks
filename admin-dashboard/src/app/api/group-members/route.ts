import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper function to get today's date string in YYYY-MM-DD format
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  try {
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Supabase configuration is missing. Please check your environment variables (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 500 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase client is not initialized. Please check your environment variables." },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const teamId = searchParams.get("team_id");
    const channelId = searchParams.get("channel_id");

    // Support both team_id and channel_id
    if (!teamId && !channelId) {
      return NextResponse.json(
        { error: "Either team_id or channel_id is required" },
        { status: 400 }
      );
    }

    // If channel_id is provided, get members from backend Slack API
    if (channelId) {
      console.log("🔍 Fetching members for channel_id:", channelId);
      
      // Remove trailing slash from backend URL to prevent double-slash issues
      const backendUrl = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");
      const response = await fetch(`${backendUrl}/api/channel-members?channel_id=${encodeURIComponent(channelId)}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch channel members" }));
        return NextResponse.json(
          { error: errorData.error || "Failed to fetch channel members" },
          { status: response.status }
        );
      }

      const channelData = await response.json();
      const channelMemberIds = channelData.members.map((m: any) => m.slackUserId);
      const resolvedTeamId = channelData.teamId || teamId;

      if (!resolvedTeamId) {
        return NextResponse.json(
          { error: "Could not determine team_id from channel. Please provide team_id." },
          { status: 400 }
        );
      }

      // Get user connections for these members
      const { data: connections, error: connectionsError } = await supabase
        .from("user_connections")
        .select("slack_user_id, slack_user_name, team_id, google_tokens, github_token, github_owner, github_repo")
        .eq("team_id", resolvedTeamId)
        .in("slack_user_id", channelMemberIds);

      if (connectionsError) {
        console.error("❌ Error fetching user connections:", connectionsError);
        // Fallback: return members from channel API even if we can't match with user_connections
        const today = getTodayDateString();
        return NextResponse.json({
          members: channelData.members.map((m: any) => ({
            slackUserId: m.slackUserId,
            name: m.name,
            hasCompletedRecap: false, // Can't check without user_connections
          })),
          warning: "Could not check recap status - user connections not found"
        });
      }

      // Create a map of slack_user_id to connection data
      const connectionMap = new Map(
        (connections || []).map((c) => [c.slack_user_id, c])
      );

      // Merge channel members with connection data
      const mergedMembers = channelData.members.map((m: any) => {
        const connection = connectionMap.get(m.slackUserId);
        return {
          slackUserId: m.slackUserId,
          name: connection?.slack_user_name || m.name,
          hasCompletedRecap: false, // Will update below
          integrations: {
            slack: true, // Always true since they're in Slack
            calendar: !!connection?.google_tokens,
            github: !!connection?.github_token,
          },
          githubInfo: connection?.github_token ? {
            owner: connection.github_owner,
            repo: connection.github_repo,
          } : null,
        };
      });

      // Get today's recaps for these users
      const today = getTodayDateString();
      const slackUserIds = mergedMembers.map((m: any) => m.slackUserId);
      
      const { data: recaps } = await supabase
        .from("daily_recaps")
        .select("user_id, submitted_at")
        .eq("team_id", resolvedTeamId)
        .in("user_id", slackUserIds)
        .gte("submitted_at", `${today}T00:00:00Z`)
        .lt("submitted_at", `${today}T23:59:59Z`);

      const completedUserIds = new Set((recaps || []).map((r: any) => r.user_id));

      const members = mergedMembers.map((m: any) => ({
        ...m,
        hasCompletedRecap: completedUserIds.has(m.slackUserId),
      }));

      return NextResponse.json({ members });
    }

    // Original team_id lookup
    if (!teamId) {
      return NextResponse.json(
        { error: "team_id is required when channel_id is not provided" },
        { status: 400 }
      );
    }

    console.log("🔍 Fetching members for team_id:", teamId);

    // Get all users in the team from user_connections
    // Handle both exact match and null team_id (for backwards compatibility)
    let query = supabase
      .from("user_connections")
      .select("slack_user_id, slack_user_name, team_id, google_tokens, github_token, github_owner, github_repo");
    
    // Query for exact team_id match
    const { data: connections, error: connectionsError } = await query
      .eq("team_id", teamId);

    console.log("📊 Query result:", {
      connectionsCount: connections?.length || 0,
      error: connectionsError?.message,
      sampleConnection: connections?.[0]
    });

    if (connectionsError) {
      console.error("❌ Error fetching user connections:", connectionsError);
      return NextResponse.json(
        { 
          error: "Failed to fetch group members",
          details: connectionsError.message 
        },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      console.log("⚠️ No connections found for team_id:", teamId);
      // Try to see if there are any connections at all (for debugging)
      const { data: allConnections } = await supabase
        .from("user_connections")
        .select("team_id")
        .limit(5);
      console.log("📋 Sample team_ids in database:", allConnections?.map(c => c.team_id));
      
      return NextResponse.json({ 
        members: [],
        debug: {
          searchedTeamId: teamId,
          sampleTeamIds: allConnections?.map(c => c.team_id) || []
        }
      });
    }

    const today = getTodayDateString();
    const slackUserIds = connections.map((c) => c.slack_user_id);

    // Get today's recaps for all users in the team
    const { data: recaps, error: recapsError } = await supabase
      .from("daily_recaps")
      .select("user_id, submitted_at")
      .eq("team_id", teamId)
      .in("user_id", slackUserIds)
      .gte("submitted_at", `${today}T00:00:00Z`)
      .lt("submitted_at", `${today}T23:59:59Z`);

    if (recapsError) {
      console.error("Error fetching daily recaps:", recapsError);
      // Continue even if recaps query fails
    }

    // Create a set of user IDs who have completed today's recap
    const completedUserIds = new Set(
      (recaps || []).map((r) => r.user_id)
    );

    // Combine connection data with recap status and integrations
    const members = connections.map((connection) => ({
      slackUserId: connection.slack_user_id,
      name: connection.slack_user_name || connection.slack_user_id,
      hasCompletedRecap: completedUserIds.has(connection.slack_user_id),
      integrations: {
        slack: true, // Always true since they're in the user_connections table
        calendar: !!connection.google_tokens,
        github: !!connection.github_token,
      },
      githubInfo: connection.github_token ? {
        owner: connection.github_owner,
        repo: connection.github_repo,
      } : null,
    }));

    return NextResponse.json({ members });
  } catch (error: any) {
    console.error("Error in GET /api/group-members:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

