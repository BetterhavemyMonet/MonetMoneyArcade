import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Fixed repo configuration for MonetMoneyArcade
const OWNER = 'BetterhavemyMonet';
const REPO = 'MonetMoneyArcade';

console.log(`[AI-AGENT] Initialized for repo: ${OWNER}/${REPO}`);

/**
 * Tools that ChatGPT can use to interact with the MonetMoneyArcade repo
 */
const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from the MonetMoneyArcade repository',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to repo root (e.g., "package.json", "server.js")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or update a file in the MonetMoneyArcade repository',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to repo root',
        },
        content: {
          type: 'string',
          description: 'The file content',
        },
        message: {
          type: 'string',
          description: 'Commit message explaining the change',
        },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory of the MonetMoneyArcade repository',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (empty string for root). Example: "src" or ""',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_branch',
    description: 'Create a new branch for changes in MonetMoneyArcade',
    parameters: {
      type: 'object',
      properties: {
        branch_name: {
          type: 'string',
          description: 'Name for the new branch (e.g., "feature/chatgpt-enhancement")',
        },
        base_branch: {
          type: 'string',
          description: 'Base branch to branch from (default: main)',
        },
      },
      required: ['branch_name'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a pull request for the changes in MonetMoneyArcade',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'PR title',
        },
        body: {
          type: 'string',
          description: 'PR description explaining the changes',
        },
        head: {
          type: 'string',
          description: 'Source branch',
        },
        base: {
          type: 'string',
          description: 'Target branch (default: main)',
        },
      },
      required: ['title', 'body', 'head'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for code patterns in the MonetMoneyArcade repository',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "function sendPayout")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_file_structure',
    description: 'Get the structure of files and directories in MonetMoneyArcade',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (optional, defaults to root)',
        },
        depth: {
          type: 'number',
          description: 'How many levels deep to show (default: 2)',
        },
      },
    },
  },
];

/**
 * Verify authorization for MonetMoneyArcade
 */
async function verifyAuthorization() {
  try {
    const user = await octokit.users.getAuthenticated();
    const repos = await octokit.repos.listForAuthenticatedUser({ per_page: 100 });
    const hasAccess = repos.data.some(
      r => r.owner.login === OWNER && r.name === REPO
    );

    if (!hasAccess) {
      console.error(`[AI-AGENT] ❌ No access to ${OWNER}/${REPO}`);
      console.error(`[AI-AGENT] Token user: ${user.data.login}`);
      return false;
    }

    console.log(`[AI-AGENT] ✓ Authorized as ${user.data.login} for ${OWNER}/${REPO}`);
    return true;
  } catch (e) {
    console.error(`[AI-AGENT] Authorization check failed: ${e.message}`);
    return false;
  }
}

/**
 * Execute tool calls from ChatGPT
 */
async function executeTool(toolName, params) {
  console.log(`[AI-AGENT] Executing tool: ${toolName}`, JSON.stringify(params).substring(0, 100));

  switch (toolName) {
    case 'read_file':
      return await readFile(params.path);

    case 'write_file':
      return await writeFile(params.path, params.content, params.message);

    case 'list_files':
      return await listFiles(params.path);

    case 'create_branch':
      return await createBranch(params.branch_name, params.base_branch || 'main');

    case 'create_pull_request':
      return await createPullRequest(params.title, params.body, params.head, params.base || 'main');

    case 'search_code':
      return await searchCode(params.query);

    case 'get_file_structure':
      return await getFileStructure(params.path || '', params.depth || 2);

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Read a file from MonetMoneyArcade repository
 */
async function readFile(filePath) {
  try {
    const response = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: filePath,
    });

    if (response.data.type === 'file') {
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      console.log(`[AI-AGENT] ✓ Read ${filePath} (${content.length} bytes)`);
      return { ok: true, content, path: filePath, size: content.length };
    } else {
      return { error: `${filePath} is a directory, not a file` };
    }
  } catch (e) {
    return { error: `Failed to read ${filePath}: ${e.message}` };
  }
}

/**
 * Write/create a file in MonetMoneyArcade repository
 */
async function writeFile(filePath, content, message) {
  try {
    let sha = null;

    // Check if file exists to get SHA for update
    try {
      const existing = await octokit.repos.getContent({
        owner: OWNER,
        repo: REPO,
        path: filePath,
      });
      if (existing.data.type === 'file') {
        sha = existing.data.sha;
      }
    } catch (e) {
      // File doesn't exist, that's OK for create
    }

    const response = await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: filePath,
      message: message || `Update ${filePath}`,
      content: Buffer.from(content).toString('base64'),
      ...(sha && { sha }),
    });

    const action = sha ? 'updated' : 'created';
    console.log(`[AI-AGENT] ✓ File ${action}: ${filePath}`);

    return {
      ok: true,
      path: filePath,
      message: `File ${action} successfully`,
      commit: response.data.commit.sha,
      action,
    };
  } catch (e) {
    console.error(`[AI-AGENT] ❌ Write failed for ${filePath}: ${e.message}`);
    return { error: `Failed to write ${filePath}: ${e.message}` };
  }
}

/**
 * List files in a directory of MonetMoneyArcade
 */
async function listFiles(dirPath) {
  try {
    const response = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: dirPath || '',
    });

    if (Array.isArray(response.data)) {
      const files = response.data.map(item => ({
        name: item.name,
        type: item.type,
        path: item.path,
        size: item.size,
      }));
      console.log(`[AI-AGENT] ✓ Listed ${files.length} items in ${dirPath || 'root'}`);
      return { ok: true, files, path: dirPath || 'root' };
    } else {
      return { error: `${dirPath} is not a directory` };
    }
  } catch (e) {
    return { error: `Failed to list ${dirPath}: ${e.message}` };
  }
}

/**
 * Create a new branch in MonetMoneyArcade
 */
async function createBranch(branchName, baseBranch = 'main') {
  try {
    // Get the SHA of the base branch
    const baseRef = await octokit.git.getRef({
      owner: OWNER,
      repo: REPO,
      ref: `heads/${baseBranch}`,
    });

    const baseSha = baseRef.data.object.sha;

    // Create new branch
    await octokit.git.createRef({
      owner: OWNER,
      repo: REPO,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    console.log(`[AI-AGENT] ✓ Branch created: ${branchName} from ${baseBranch}`);

    return {
      ok: true,
      branch: branchName,
      base: baseBranch,
      message: `Branch ${branchName} created successfully`,
    };
  } catch (e) {
    console.error(`[AI-AGENT] ❌ Failed to create branch: ${e.message}`);
    return { error: `Failed to create branch: ${e.message}` };
  }
}

/**
 * Create a pull request in MonetMoneyArcade
 */
async function createPullRequest(title, body, head, base = 'main') {
  try {
    const response = await octokit.pulls.create({
      owner: OWNER,
      repo: REPO,
      title,
      body: body || `Automated PR from AI agent\n\n${title}`,
      head,
      base,
    });

    console.log(`[AI-AGENT] ✓ PR created: #${response.data.number}`);

    return {
      ok: true,
      pr_number: response.data.number,
      pr_url: response.data.html_url,
      message: `PR #${response.data.number} created successfully`,
    };
  } catch (e) {
    console.error(`[AI-AGENT] ❌ Failed to create PR: ${e.message}`);
    return { error: `Failed to create PR: ${e.message}` };
  }
}

/**
 * Search code in MonetMoneyArcade repository
 */
async function searchCode(query) {
  try {
    const response = await octokit.search.code({
      q: `${query} repo:${OWNER}/${REPO}`,
      per_page: 10,
    });

    const results = response.data.items.map(item => ({
      file: item.path,
      name: item.name,
      url: item.html_url,
      matches: item.text_matches ? item.text_matches.length : 0,
    }));

    console.log(`[AI-AGENT] ✓ Search found ${results.length} results for "${query}"`);

    return {
      ok: true,
      results,
      total: response.data.total_count,
      query,
    };
  } catch (e) {
    return { error: `Search failed: ${e.message}` };
  }
}

/**
 * Get file structure of MonetMoneyArcade
 */
async function getFileStructure(dirPath = '', depth = 2, currentDepth = 0) {
  if (currentDepth >= depth) return [];

  try {
    const response = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: dirPath,
    });

    if (!Array.isArray(response.data)) {
      return [];
    }

    let structure = [];
    for (const item of response.data) {
      const indent = '  '.repeat(currentDepth);
      if (item.type === 'dir') {
        structure.push(`${indent}📁 ${item.name}/`);
        const subStructure = await getFileStructure(item.path, depth, currentDepth + 1);
        structure = structure.concat(subStructure);
      } else {
        structure.push(`${indent}📄 ${item.name}`);
      }
    }
    return structure;
  } catch (e) {
    console.warn(`[AI-AGENT] Could not get structure for ${dirPath}: ${e.message}`);
    return [];
  }
}

/**
 * Main AI agent function - processes user request and uses tools as needed
 */
export async function aiAgentChat(userRequest, previousMessages = []) {
  const systemPrompt = `You are an AI agent with exclusive authorization to modify the MonetMoneyArcade GitHub repository.
Repository: ${OWNER}/${REPO}
Authorization: Active and verified

Your capabilities:
- Read and analyze files in the repository
- Create and modify files with descriptive commit messages
- Create feature branches following Git best practices
- Create pull requests for code review
- Search for code patterns and dependencies
- View repository structure

Guidelines:
1. ALWAYS create a new branch before making changes (never commit to main directly)
2. Use descriptive commit messages explaining WHAT and WHY
3. Create pull requests with clear descriptions of changes
4. Search for related code before making changes
5. Ask clarifying questions if the request is ambiguous
6. Warn about potential breaking changes
7. Suggest best practices for the codebase

Example workflow:
1. User: "Add a new feature"
2. You: Create branch → Make changes → Create PR → Explain what was done

You have authorization for MonetMoneyArcade only. Do not attempt to modify other repositories.`;

  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...previousMessages,
    {
      role: 'user',
      content: userRequest,
    },
  ];

  console.log(`[AI-AGENT] Processing request from user`);

  let response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    max_tokens: 4096,
  });

  let toolCallCount = 0;

  // Handle tool use in a loop
  while (response.finish_reason === 'tool_calls') {
    if (!response.tool_calls || response.tool_calls.length === 0) break;

    toolCallCount += response.tool_calls.length;
    console.log(`[AI-AGENT] Tool calls to execute: ${response.tool_calls.length}`);

    // Add assistant response to messages
    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // Execute all tool calls and collect results
    const toolResults = [];
    for (const toolCall of response.tool_calls) {
      const toolName = toolCall.function.name;
      const toolParams = JSON.parse(toolCall.function.arguments);

      console.log(`[AI-AGENT] → Executing: ${toolName}`);

      const result = await executeTool(toolName, toolParams);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    // Add tool results to messages
    messages.push({
      role: 'user',
      content: toolResults,
    });

    // Get next response from Claude
    response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 4096,
    });
  }

  // Extract final text response
  const finalResponse = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  console.log(`[AI-AGENT] Completed request (${toolCallCount} tools executed)`);

  return {
    response: finalResponse,
    messages,
    toolsExecuted: toolCallCount,
  };
}

// Verify authorization on module load
console.log('[AI-AGENT] Verifying authorization...');
verifyAuthorization().catch(e => {
  console.error(`[AI-AGENT] ❌ Authorization verification failed:`, e.message);
});

export { TOOLS, executeTool, OWNER, REPO, verifyAuthorization };
export default { aiAgentChat, executeTool, TOOLS, OWNER, REPO };
