# GitHub Tracker

A simple Next.js application that connects to a GitHub repository and tracks Commits, Pull Requests, and Issues.

## Getting Started

1.  **Install dependencies**:
    ```bash
    npm install
    ```
    pip install --upgrade google-api-python-client google-auth-httplib2 google-auth-oauthlib

2.  **Run the development server**:
    ```bash
    npm run dev
    ```

3.  **Open the app**:
    Visit [http://localhost:3000](http://localhost:3000) in your browser.

4.  **Connect to GitHub**:
    - Enter your **Personal Access Token** (with `repo` scope).
    - Enter the **Owner** (e.g., `noahbarbaros`).
    - Enter the **Repository** (e.g., `8090hacks`).

## Features

-   **Commits**: View the latest commits with author and date.
-   **Pull Requests**: Track open and closed PRs.
-   **Issues**: Monitor issue status.

## Tech Stack

-   Next.js (App Router)
-   TypeScript
-   Tailwind CSS
-   Octokit (GitHub API)
