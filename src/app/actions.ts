"use server";

import { GitHubService } from "@/lib/github";
import { GoogleCalendarService } from "@/lib/google-calendar";
import { SlackService } from "@/services/slackService";
import { cookies } from "next/headers";

export async function fetchGitHubData(token: string, owner: string, repo: string) {
  const github = new GitHubService(token);

  try {
    const [commits, prs, issues, user] = await Promise.all([
      github.getCommits(owner, repo),
      github.getPullRequests(owner, repo),
      github.getIssues(owner, repo),
      github.getUser(),
    ]);

    // Filter commits to only show those from the authenticated user
    const userLogin = user.login;
    const filteredCommits = commits.filter((commit: any) => {
      const authorLogin = commit.author?.login;
      const committerLogin = commit.committer?.login;
      return authorLogin === userLogin || committerLogin === userLogin;
    });

    return {
      success: true,
      data: {
        commits: filteredCommits,
        prs,
        issues,
        user
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to fetch GitHub data",
    };
  }
}

export async function getGoogleAuthUrl() {
  const calendarService = new GoogleCalendarService();
  return calendarService.generateAuthUrl();
}

export async function disconnectGoogleCalendar() {
  try {
    const cookieStore = await cookies();
    // Delete the cookie by setting it with an expired date
    cookieStore.set("google_tokens", "", {
      expires: new Date(0),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to disconnect" };
  }
}

export async function fetchCalendarEvents() {
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get("google_tokens");
  
  if (!tokenCookie) {
    return { success: false, error: "Not authenticated with Google" };
  }

  try {
    const tokens = JSON.parse(tokenCookie.value);
    const calendarService = new GoogleCalendarService();
    const events = await calendarService.listEvents(tokens);
    return { success: true, data: events };
  } catch (error: any) {
     return { success: false, error: error.message || "Failed to fetch calendar events" };
  }
}

export async function getGoogleUserEmail() {
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get("google_tokens");
  
  if (!tokenCookie) {
    return { success: false, error: "Not authenticated with Google" };
  }

  try {
    const tokens = JSON.parse(tokenCookie.value);
    const calendarService = new GoogleCalendarService();
    const email = await calendarService.getUserEmail(tokens);
    return { success: true, email };
  } catch (error: any) {
     return { success: false, error: error.message || "Failed to get user email" };
  }
}

export async function fetchSlackMessages(channelId: string, userEmail?: string) {
    const token = process.env.SLACK_BOT_TOKEN;
    
    if (!token) {
        return { success: false, error: "Slack bot token not found" };
    }

    try {
        const slack = new SlackService(token);
        const messages = await slack.getChannelHistory(channelId);
        
        // Filter messages by user if email is provided
        let filteredMessages = messages;
        if (userEmail) {
            const slackUserId = await slack.getSlackUserIdFromEmail(userEmail);
            if (slackUserId) {
                filteredMessages = messages.filter((msg: any) => msg.user === slackUserId);
            } else {
                // If we can't find the user, return empty array
                filteredMessages = [];
            }
        }
        
        return { success: true, data: filteredMessages };
    } catch (error: any) {
        return { success: false, error: error.message || "Failed to fetch Slack messages" };
    }
}

export async function sendSlackPrompts(commits?: any[], slackMessages?: any[], calendarEvents?: any[], googleEmail?: string) {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
    
    try {
        const response = await fetch(`${backendUrl}/api/send-prompts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                commits: commits || [],
                slackMessages: slackMessages || [],
                calendarEvents: calendarEvents || [],
                googleEmail: googleEmail || null, // Email from Google Calendar connection
            }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            return { success: false, error: data.error || "Failed to send Slack prompts" };
        }
        
        return { success: true, message: data.message };
    } catch (error: any) {
        return { success: false, error: error.message || "Failed to connect to backend" };
    }
}
