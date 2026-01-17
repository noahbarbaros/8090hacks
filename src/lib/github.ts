import { Octokit } from "octokit";

export class GitHubService {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getCommits(owner: string, repo: string) {
    try {
      const response = await this.octokit.request("GET /repos/{owner}/{repo}/commits", {
        owner,
        repo,
        per_page: 10,
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching commits:", error);
      throw error;
    }
  }

  async getPullRequests(owner: string, repo: string) {
    try {
      const response = await this.octokit.request("GET /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        state: "all",
        per_page: 10,
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching PRs:", error);
      throw error;
    }
  }

  async getIssues(owner: string, repo: string) {
    try {
      const response = await this.octokit.request("GET /repos/{owner}/{repo}/issues", {
        owner,
        repo,
        state: "all",
        per_page: 10,
      });
      // Filter out pull requests, as the issues endpoint returns both
      return response.data.filter((issue: any) => !issue.pull_request);
    } catch (error) {
      console.error("Error fetching issues:", error);
      throw error;
    }
  }
  
  async getUser() {
    try {
        const { data } = await this.octokit.request("GET /user");
        return data;
    } catch (error) {
        console.error("Error fetching user:", error);
        throw error;
    }
  }
}

