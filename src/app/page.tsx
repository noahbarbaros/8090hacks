"use client";

import { useState } from "react";
import { fetchGitHubData } from "./actions";
import { GitCommit, GitPullRequest, CircleDot, Github, Loader2 } from "lucide-react";

export default function Home() {
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setData(null);

    try {
      const result = await fetchGitHubData(token, owner, repo);
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-black">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center space-x-4 mb-8">
          <Github className="w-10 h-10" />
          <h1 className="text-3xl font-bold">GitHub Tracker</h1>
        </div>

        {/* Connection Form */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">Connection Details</h2>
          <form onSubmit={handleConnect} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Personal Access Token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Owner</label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. facebook"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Repository</label>
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="e.g. react"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-black text-white p-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Connect"}
            </button>
          </form>
          {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
        </div>

        {/* Dashboard */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Commits Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center space-x-2 mb-6">
                <GitCommit className="w-6 h-6 text-blue-500" />
                <h3 className="text-lg font-bold">Recent Commits</h3>
              </div>
              <div className="space-y-4">
                {data.commits.map((commit: any) => (
                  <div key={commit.sha} className="border-b border-gray-100 pb-4 last:border-0">
                    <p className="font-medium text-sm truncate">{commit.commit.message}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span>{commit.commit.author.name}</span>
                      <span>{new Date(commit.commit.author.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
                {data.commits.length === 0 && <p className="text-gray-500">No commits found</p>}
              </div>
            </div>

            {/* PRs Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center space-x-2 mb-6">
                <GitPullRequest className="w-6 h-6 text-purple-500" />
                <h3 className="text-lg font-bold">Pull Requests</h3>
              </div>
              <div className="space-y-4">
                {data.prs.map((pr: any) => (
                  <div key={pr.id} className="border-b border-gray-100 pb-4 last:border-0">
                    <p className="font-medium text-sm truncate">{pr.title}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full ${
                        pr.state === 'open' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {pr.state}
                      </span>
                      <span>#{pr.number}</span>
                    </div>
                  </div>
                ))}
                {data.prs.length === 0 && <p className="text-gray-500">No pull requests found</p>}
              </div>
            </div>

            {/* Issues Column */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center space-x-2 mb-6">
                <CircleDot className="w-6 h-6 text-orange-500" />
                <h3 className="text-lg font-bold">Issues</h3>
              </div>
              <div className="space-y-4">
                {data.issues.map((issue: any) => (
                  <div key={issue.id} className="border-b border-gray-100 pb-4 last:border-0">
                    <p className="font-medium text-sm truncate">{issue.title}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full ${
                        issue.state === 'open' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {issue.state}
                      </span>
                      <span>#{issue.number}</span>
                    </div>
                  </div>
                ))}
                {data.issues.length === 0 && <p className="text-gray-500">No issues found</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
