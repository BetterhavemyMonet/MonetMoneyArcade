# 🤖 ChatGPT AI Agent Setup Guide - MonetMoneyArcade

Your ChatGPT AI Agent is now ready to make autonomous changes to your repository!

## 📋 Quick Setup (5 minutes)

### Step 1: Install Dependencies

```bash
npm install openai @octokit/rest
```

### Step 2: Get Your API Keys

**OpenAI API Key:**
- Go to https://platform.openai.com/api-keys
- Create a new secret key
- Copy it

**GitHub Personal Access Token:**
- Go to https://github.com/settings/tokens
- Click "Generate new token (classic)"
- Select these scopes:
  - ✅ `repo` (Full control of private repositories)
  - ✅ `workflow` (Update GitHub Action workflows)
- Generate and copy the token

**Create AI Agent Token:**
```bash
openssl rand -hex 32
# Copy the output
```

### Step 3: Set Environment Variables

Add to your `.env` file or deployment environment:

```env
OPENAI_API_KEY=sk-your-openai-key-here
GITHUB_TOKEN=ghp_your-github-token-here
AI_AGENT_TOKEN=your-random-secure-token-from-above
```

### Step 4: Update server.js

Add these lines to `server.js`:

**At the top (after other imports on line 13):**
```javascript
import { setupAIRoutes } from './ai-api-routes.js';
```

**Before static files (around line 1920, before `app.use(express.static(__dirname))`):**
```javascript
// ─── Routes: AI Agent ──────────────────────────────────────────────────────
setupAIRoutes(app);
```

### Step 5: Start Your Server

```bash
npm start
```

You should see:
```
[AI-AGENT] Initialized for repo: BetterhavemyMonet/MonetMoneyArcade
[AI-AGENT] Verifying authorization...
[AI-AGENT] ✓ Authorized as your-github-username for BetterhavemyMonet/MonetMoneyArcade
[AI-AGENT] Routes initialized
```

## 🎯 Usage Examples

### Example 1: Make ChatGPT Add a New API Endpoint

```bash
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-secure-token" \
  -d '{
    "request": "Create a new endpoint /api/ai/health that returns {ok: true, status: \"AI Agent Active\"}. Create a branch called feature/ai-health-check and make a PR",
    "sessionId": "session-1"
  }'
```

### Example 2: Ask ChatGPT to Fix Bugs

```bash
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-secure-token" \
  -d '{
    "request": "Find the sendPayout function and add comprehensive error logging. Then create a branch feature/better-payout-logging and make a PR",
    "sessionId": "session-1"
  }'
```

### Example 3: Analyze Code Structure

```bash
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-secure-token" \
  -d '{
    "request": "Show me the repository structure. Then find where the challenge routes are defined and explain how they work",
    "sessionId": "session-1"
  }'
```

### Example 4: Multi-Turn Conversation

```bash
# First message
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-secure-token" \
  -d '{
    "request": "What games are currently in the MonetMoneyArcade?",
    "sessionId": "session-1"
  }'

# Second message (uses history from session-1)
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-secure-token" \
  -d '{
    "request": "For the Mario game, find where it handles scoring and add better score validation",
    "sessionId": "session-1"
  }'
```

## 🛠️ Available Tools

ChatGPT can use these tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read any file from the repo |
| `write_file` | Create or update files with commits |
| `list_files` | List files in a directory |
| `create_branch` | Create feature branches |
| `create_pull_request` | Create PRs for review |
| `search_code` | Find code patterns |
| `get_file_structure` | Visualize repo structure |

## 📡 API Endpoints

### `POST /api/ai/chat`
Send a request to ChatGPT
- Headers: `x-ai-token: your-token`
- Body: `{ "request": "...", "sessionId": "session-1" }`
- Returns: AI response + any files modified

### `GET /api/ai/session/:sessionId`
Get conversation history
- Headers: `x-ai-token: your-token`
- Returns: All messages in the session

### `DELETE /api/ai/session/:sessionId`
Clear session history
- Headers: `x-ai-token: your-token`
- Returns: Confirmation

### `GET /api/ai/tools`
List available tools
- Headers: `x-ai-token: your-token`
- Returns: Array of available tools

### `POST /api/ai/direct-tool`
Execute a tool directly (for testing)
- Headers: `x-ai-token: your-token`
- Body: `{ "tool": "read_file", "params": { "path": "package.json" } }`
- Returns: Tool execution result

## 🔒 Security Features

✅ **Token-based Authentication** - All requests require `x-ai-token` header  
✅ **Branch-based Workflow** - No direct commits to main  
✅ **PR-based Review** - All changes go through pull requests  
✅ **Authorization Verification** - Confirms access to MonetMoneyArcade only  
✅ **Audit Logging** - All AI actions are logged  
✅ **Session Management** - Separate conversation histories  

## 🚀 Workflow Best Practices

1. **Always create a branch first**
   - ChatGPT will create branches like `feature/description`

2. **Review PRs before merging**
   - All changes go to PRs, not directly to main
   - You can review and approve manually

3. **Keep sessions organized**
   - Use meaningful sessionIds: `session-auth-upgrade`, `session-performance-fix`
   - This maintains conversation context

4. **Start with small changes**
   - Ask ChatGPT to read files first
   - Then ask it to make targeted changes
   - Build up to larger refactors

## ⚡ Example Workflow

```bash
# 1. Ask ChatGPT to read server.js
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-token" \
  -d '{
    "request": "Read server.js and summarize what major routes exist",
    "sessionId": "workflow-1"
  }'

# 2. Ask it to find a specific function
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-token" \
  -d '{
    "request": "Find and explain the sendPayout function in detail",
    "sessionId": "workflow-1"
  }'

# 3. Ask it to make a specific improvement
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-ai-token: your-token" \
  -d '{
    "request": "Create a new branch feature/improved-sendpayout. Update sendPayout to include transaction retry logic with exponential backoff. Make a PR titled \"Add retry logic to sendPayout\"",
    "sessionId": "workflow-1"
  }'

# 4. Check what happened
git log --oneline
# You should see the commits!
```

## 🐛 Troubleshooting

### "Invalid AI token"
- Check that your `x-ai-token` header matches `AI_AGENT_TOKEN` env var

### "No access to BetterhavemyMonet/MonetMoneyArcade"
- Your GitHub token doesn't have access to the repo
- Generate a new token with `repo` and `workflow` scopes
- Make sure the token is valid: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`

### "OpenAI API not configured"
- Set `OPENAI_API_KEY` environment variable
- Test it's valid: ChatGPT API should respond

### "Branch already exists"
- Use a different branch name in your request
- Or ask ChatGPT to delete and recreate

## 📚 Next Steps

1. Test with simple requests first
2. Gradually give ChatGPT more complex tasks
3. Monitor PRs it creates
4. Build a library of successful prompts
5. Integrate into your CI/CD workflow

## 💡 Example Prompts

```
"Add comprehensive error handling to the verifyEntryFee function"

"Create a new utility module utils/validation.js with reusable validation functions for game scores"

"Refactor the challenge routes to use a separate router file"

"Add rate limiting middleware to all /api routes"

"Create an admin dashboard endpoint that returns server statistics"

"Add webhooks support for payment notifications"

"Optimize the leaderboard query to use indexes"
```

---

**Your AI Agent is now ready to boost your development speed! 🚀**

For more help, check the README in the repo or reach out to the team.
