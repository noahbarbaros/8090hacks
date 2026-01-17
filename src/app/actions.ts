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

    return {
      success: true,
      data: {
        commits,
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

export async function fetchSlackMessages(channelId: string) {
    const token = process.env.SLACK_BOT_TOKEN;
    
    if (!token) {
        return { success: false, error: "Slack bot token not found" };
    }

    try {
        const slack = new SlackService(token);
        const messages = await slack.getChannelHistory(channelId);
        return { success: true, data: messages };
    } catch (error: any) {
        return { success: false, error: error.message || "Failed to fetch Slack messages" };
    }
}

export async function sendSlackPrompts(commits?: any[], slackMessages?: any[], calendarEvents?: any[], userEmail?: string) {
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
                userEmail: userEmail || null,
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
