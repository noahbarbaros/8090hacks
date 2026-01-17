# Admin Dashboard

Admin dashboard for managing team daily recaps. Runs on port 3002.

## Features

- View all team members in a group
- See who has completed their daily recap for today
- Send notifications to team members to complete their daily recap
- Custom notification messages

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file with the following variables:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
BACKEND_URL=http://localhost:3000
```

3. Run the development server:
```bash
npm run dev
```

The dashboard will be available at http://localhost:3002

## Usage

1. Enter your Slack Team ID in the input field
2. Click "Load Members" to fetch team members and their daily recap status
3. Customize the notification message if needed
4. Click "Send Notification" next to any member to send them a reminder to complete their daily recap

## Requirements

- The backend server (Backend/index.js) must be running on port 3000
- Supabase database with `user_connections` and `daily_recaps` tables
- Slack bot token configured in the backend

