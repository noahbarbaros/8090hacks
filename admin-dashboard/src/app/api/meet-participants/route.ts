import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const teamId = searchParams.get("team_id");
    const channelId = searchParams.get("channel_id");

    if (!teamId && !channelId) {
      return NextResponse.json(
        { error: "Either team_id or channel_id is required" },
        { status: 400 }
      );
    }

    const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
    let members: any[] = [];

    if (channelId) {
      // Fetch from backend channel-members API (includes profile images)
      const url = `${backendUrl}/api/channel-members?channel_id=${encodeURIComponent(channelId)}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch members" }));
        return NextResponse.json(
          { error: errorData.error || "Failed to fetch members" },
          { status: response.status }
        );
      }

      const data = await response.json();
      members = data.members || [];
    } else if (teamId) {
      // For team_id, use group-members API and then fetch profile images from backend
      const groupMembersResponse = await fetch(
        `${request.nextUrl.origin}/api/group-members?team_id=${encodeURIComponent(teamId)}`
      );

      if (!groupMembersResponse.ok) {
        const errorData = await groupMembersResponse.json().catch(() => ({ error: "Failed to fetch group members" }));
        return NextResponse.json(
          { error: errorData.error || "Failed to fetch group members" },
          { status: groupMembersResponse.status }
        );
      }

      const groupData = await groupMembersResponse.json();
      const slackUserIds = (groupData.members || []).map((m: any) => m.slackUserId);

      // Fetch profile images from backend for each user
      // We'll need to create an endpoint or use the Slack API directly
      // For now, let's fetch profile images by making individual requests to backend
      // But that's inefficient, so let's create a batch endpoint or use a different approach
      
      // Actually, let's fetch profile images from Slack API via backend
      // We can create a simple endpoint that takes user IDs and returns profile images
      // Or we can use the existing channel-members approach by getting a channel from the team
      
      // For simplicity, let's fetch profile images from backend using a new endpoint
      // But for now, let's just use the group members data and fetch images separately
      // Actually, the best approach is to add profile image fetching to the backend
      
      // For now, let's use the group members and try to get profile images from Slack
      // We'll need to add a backend endpoint to get user profile images by user IDs
      
      members = (groupData.members || []).map((m: any) => ({
        slackUserId: m.slackUserId,
        name: m.name,
        profileImage: null, // Will be fetched below
      }));

      // Fetch profile images from backend
      try {
        const userIds = members.map((m: any) => m.slackUserId).join(",");
        const profileResponse = await fetch(
          `${backendUrl}/api/user-profile-images?user_ids=${encodeURIComponent(userIds)}`
        );
        
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          members = members.map((member: any) => ({
            ...member,
            profileImage: profileData.profileImages?.[member.slackUserId] || null,
          }));
        }
      } catch (e) {
        console.error("Failed to fetch profile images:", e);
        // Continue without profile images
      }
    }
    
    // Return members with profile images
    const participants = members.map((member: any) => ({
      slackUserId: member.slackUserId,
      name: member.name,
      profileImage: member.profileImage || null,
    }));

    return NextResponse.json({ participants });
  } catch (error: any) {
    console.error("Error in GET /api/meet-participants:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

