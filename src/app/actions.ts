"use server";

import { GitHubService } from "@/lib/github";

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

