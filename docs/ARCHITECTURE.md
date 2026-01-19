# Just-Command: Architecture & Implementation Plan

> A superior MCP server combining the best of Filesystem MCP, Windows-MCP, and Desktop Commander

## Executive Summary

Just-Command aims to be a **next-generation MCP server** that provides:
- **PC Control**: File system, terminal, process management, desktop automation
- **Claude.ai Enhancement**: Seamless integration via Model Context Protocol
- **Superior Performance**: Streaming I/O, optimized search, efficient resource usage
- **Rock-Solid Stability**: Robust error handling, session management, graceful recovery
- **Security First**: Sandboxing, path validation, principle of least privilege

---

## Research Summary

### Analyzed MCP Servers

| Server | Strengths | Weaknesses |
|--------|-----------|------------|
| **Filesystem MCP** | Clean architecture, security model, path validation | Limited features, no terminal, no search |
| **Windows-MCP** | Full OS automation via accessibility tree | Windows-only, 0.7-2.5s latency per action |
| **Desktop Commander** | Feature-rich, ripgrep search, diff editing, sessions | Complexity, resource overhead |

### Key Insights from Research

1. **Transport**: Streamable HTTP is the new standard (SSE deprecated)
2. **Performance**: Streaming responses, chunked output, resource handles vs inline data
3. **Security**: Docker isolation, seccomp profiles, path validation, least privilege
4. **Architecture**: Modular tools, stateful sessions, structured outputs
5. **Cross-platform**: nut.js for desktop automation, NodeRT for Windows-specific features

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Just-Command MCP Server                      │
├─────────────────────────────────────────────────────────────────────┤
│  Transport Layer                                                     │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │    stdio    │  │ Streamable HTTP  │  │   Session Manager     │   │
│  └─────────────┘  └──────────────────┘  └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Security Layer                                                      │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │ Path Valid  │  │ Command Filter   │  │   Rate Limiting       │   │
│  └─────────────┘  └──────────────────┘  └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Tool Modules                                                        │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │ Filesystem  │  │    Terminal      │  │      Search           │   │
│  ├─────────────┤  ├──────────────────┤  ├───────────────────────┤   │
│  │ read_file   │  │ execute_command  │  │ search_files          │   │
│  │ write_file  │  │ read_output      │  │ search_content        │   │
│  │ edit_file   │  │ send_input       │  │ search_replace        │   │
│  │ list_dir    │  │ kill_process     │  │ (ripgrep-powered)     │   │
│  │ move_file   │  │ list_sessions    │  │                       │   │
│  │ get_info    │  │ (PTY sessions)   │  │                       │   │
│  └─────────────┘  └──────────────────┘  └───────────────────────┘   │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │   System    │  │     Config       │  │      Clipboard        │   │
│  ├─────────────┤  ├──────────────────┤  ├───────────────────────┤   │
│  │ get_info    │  │ get_config       │  │ read_clipboard        │   │
│  │ list_procs  │  │ set_config       │  │ write_clipboard       │   │
│  │ kill_proc   │  │ list_allowed     │  │                       │   │
│  │ screenshot  │  │                  │  │                       │   │
│  └─────────────┘  └──────────────────┘  └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Core Infrastructure                                                 │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │   Logger    │  │  Error Handler   │  │   Event Emitter       │   │
│  └─────────────┘  └──────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
Just-Command/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── server.ts                # MCP server setup
│   ├── transports/
│   │   ├── stdio.ts             # stdio transport
│   │   └── http.ts              # Streamable HTTP transport
│   ├── tools/
│   │   ├── index.ts             # Tool registry
│   │   ├── filesystem/
│   │   │   ├── index.ts
│   │   │   ├── read.ts          # read_file, read_multiple_files
│   │   │   ├── write.ts         # write_file
│   │   │   ├── edit.ts          # edit_file (diff-based)
│   │   │   ├── directory.ts     # list_directory, create_directory
│   │   │   └── operations.ts    # move_file, get_file_info
│   │   ├── terminal/
│   │   │   ├── index.ts
│   │   │   ├── execute.ts       # execute_command
│   │   │   ├── session.ts       # Session management (node-pty)
│   │   │   └── process.ts       # list_processes, kill_process
│   │   ├── search/
│   │   │   ├── index.ts
│   │   │   ├── files.ts         # search_files (glob patterns)
│   │   │   ├── content.ts       # search_content (ripgrep)
│   │   │   └── replace.ts       # search_and_replace
│   │   ├── system/
│   │   │   ├── index.ts
│   │   │   ├── info.ts          # get_system_info
│   │   │   ├── screenshot.ts    # capture_screenshot
│   │   │   └── clipboard.ts     # read/write clipboard
│   │   └── config/
│   │       ├── index.ts
│   │       └── settings.ts      # get/set configuration
│   ├── security/
│   │   ├── index.ts
│   │   ├── path-validator.ts    # Path validation & sandboxing
│   │   ├── command-filter.ts    # Command blocklist
│   │   └── rate-limiter.ts      # Request rate limiting
│   ├── utils/
│   │   ├── logger.ts            # Structured logging
│   │   ├── errors.ts            # Custom error types
│   │   ├── streams.ts           # Streaming utilities
│   │   └── schemas.ts           # Zod schemas
│   └── types/
│       ├── index.ts
│       ├── config.ts            # Configuration types
│       └── tools.ts             # Tool input/output types
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/
│   ├── install.sh
│   └── build.sh
├── package.json
├── tsconfig.json
├── .eslintrc.js
└── README.md
```

---

## Technology Stack

### Core Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation | ^1.11.0 |
| `zod` | Schema validation (MCP SDK peer dep) | ^3.25+ |
| `node-pty` | Terminal sessions with PTY | ^1.0.0 |
| `@vscode/ripgrep` | Fast content search | ^1.15.0 |
| `glob` | File pattern matching | ^10.0.0 |
| `chokidar` | File watching | ^3.6.0 |

### Optional Platform-Specific

| Package | Purpose | Platform |
|---------|---------|----------|
| `@nut-tree/nut-js` | Desktop automation (mouse, keyboard, screen) | Cross-platform |
| `@nodert-win10-21h1/windows.ui.uiautomation` | Windows UI Automation | Windows |
| `screenshot-desktop` | Screenshot capture | Cross-platform |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type-safe development |
| `tsx` | Fast TypeScript execution |
| `vitest` | Fast testing framework |
| `eslint` | Code linting |
| `prettier` | Code formatting |

---

## Tool Specifications

### 1. Filesystem Tools

#### `read_file`
```typescript
{
  name: "read_file",
  description: "Read file contents with streaming support for large files",
  inputSchema: {
    path: z.string().describe("Absolute path to file"),
    offset: z.number().optional().describe("Line offset (negative = from end)"),
    limit: z.number().optional().describe("Max lines to read"),
    encoding: z.enum(["utf8", "base64", "binary"]).optional()
  },
  outputSchema: {
    content: z.string(),
    totalLines: z.number(),
    truncated: z.boolean()
  }
}
```

#### `edit_file`
```typescript
{
  name: "edit_file",
  description: "Edit file using surgical diff-based replacements",
  inputSchema: {
    path: z.string(),
    edits: z.array(z.object({
      oldText: z.string(),
      newText: z.string()
    })),
    dryRun: z.boolean().optional()
  },
  outputSchema: {
    success: z.boolean(),
    diff: z.string(),
    changes: z.number()
  }
}
```

### 2. Terminal Tools

#### `execute_command`
```typescript
{
  name: "execute_command",
  description: "Execute shell command with timeout and streaming output",
  inputSchema: {
    command: z.string(),
    cwd: z.string().optional(),
    timeout: z.number().optional().default(30000),
    shell: z.string().optional(),
    env: z.record(z.string()).optional()
  },
  outputSchema: {
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    pid: z.number().optional(),
    timedOut: z.boolean()
  }
}
```

#### `create_terminal_session`
```typescript
{
  name: "create_terminal_session",
  description: "Create persistent PTY session for interactive commands",
  inputSchema: {
    name: z.string().optional(),
    shell: z.string().optional(),
    cwd: z.string().optional()
  },
  outputSchema: {
    sessionId: z.string(),
    pid: z.number()
  }
}
```

### 3. Search Tools

#### `search_content`
```typescript
{
  name: "search_content",
  description: "Search file contents using ripgrep (fast regex search)",
  inputSchema: {
    pattern: z.string(),
    path: z.string().optional(),
    filePattern: z.string().optional().describe("Glob pattern for files"),
    caseSensitive: z.boolean().optional(),
    maxResults: z.number().optional(),
    contextLines: z.number().optional()
  },
  outputSchema: {
    matches: z.array(z.object({
      file: z.string(),
      line: z.number(),
      content: z.string(),
      context: z.object({
        before: z.array(z.string()),
        after: z.array(z.string())
      }).optional()
    })),
    totalMatches: z.number(),
    truncated: z.boolean()
  }
}
```

### 4. System Tools

#### `get_system_info`
```typescript
{
  name: "get_system_info",
  description: "Get system information (OS, CPU, memory, etc.)",
  inputSchema: {},
  outputSchema: {
    platform: z.string(),
    arch: z.string(),
    hostname: z.string(),
    cpus: z.number(),
    totalMemory: z.number(),
    freeMemory: z.number(),
    uptime: z.number()
  }
}
```

---

## Security Model

### 1. Path Validation

```typescript
class PathValidator {
  private allowedPaths: Set<string>;
  private deniedPatterns: RegExp[];

  validate(path: string): ValidationResult {
    // 1. Normalize and resolve path
    const resolved = path.resolve(path);

    // 2. Check against denied patterns (.env, secrets, etc.)
    if (this.deniedPatterns.some(p => p.test(resolved))) {
      return { valid: false, reason: "Path matches denied pattern" };
    }

    // 3. Check path is within allowed directories
    if (!this.isWithinAllowed(resolved)) {
      return { valid: false, reason: "Path outside allowed directories" };
    }

    return { valid: true };
  }
}
```

### 2. Command Filtering

```typescript
const BLOCKED_COMMANDS = [
  /^rm\s+-rf\s+\//, // rm -rf /
  /^:(){ :|:& };:/, // fork bomb
  /^dd\s+if=.*of=\/dev/, // disk destruction
  /^mkfs/, // filesystem format
  />\s*\/dev\/sd[a-z]/, // overwrite disk
];

const DANGEROUS_FLAGS = [
  "--no-preserve-root",
  "-rf /",
];
```

### 3. Docker Isolation (Optional)

```dockerfile
FROM node:20-alpine

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

# Resource limits (set in docker-compose)
# CPU: 1 core, Memory: 512MB

# Seccomp profile for syscall filtering
SECURITY_OPT: ["seccomp:./seccomp-profile.json"]
```

---

## Performance Optimizations

### 1. Streaming File I/O

```typescript
async function* readFileStreaming(path: string, chunkSize = 64 * 1024) {
  const stream = fs.createReadStream(path, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    yield chunk;
  }
}
```

### 2. Resource Handles (Large Files)

Instead of returning huge content inline:
```typescript
// Instead of: { content: "<10MB of data>" }
// Return: { resourceUri: "file:///tmp/result-abc123", size: 10485760 }
```

### 3. Connection Pooling for PTY Sessions

```typescript
class SessionPool {
  private sessions = new Map<string, PTYSession>();
  private maxSessions = 10;

  async acquire(id: string): Promise<PTYSession> {
    if (this.sessions.size >= this.maxSessions) {
      await this.evictOldest();
    }
    // ...
  }
}
```

### 4. Ripgrep for Search

Using `@vscode/ripgrep` provides 10-100x faster search than pure JS:
```typescript
import { rgPath } from '@vscode/ripgrep';
import { spawn } from 'child_process';

async function search(pattern: string, path: string) {
  const rg = spawn(rgPath, ['--json', pattern, path]);
  // Process streaming JSON output
}
```

---

## Configuration Schema

```typescript
interface JustCommandConfig {
  // Security
  allowedDirectories: string[];
  blockedCommands: string[];
  blockedPatterns: string[];

  // Limits
  maxFileSize: number;           // Default: 10MB
  maxOutputSize: number;         // Default: 1MB
  commandTimeout: number;        // Default: 30000ms
  maxConcurrentSessions: number; // Default: 10

  // Features
  enableTerminal: boolean;
  enableSearch: boolean;
  enableClipboard: boolean;
  enableScreenshot: boolean;

  // Logging
  logLevel: "debug" | "info" | "warn" | "error";
  logFile: string | null;
  auditLog: boolean;

  // Transport
  transport: "stdio" | "http";
  httpPort: number;              // Default: 3000
  httpHost: string;              // Default: 127.0.0.1
}
```

---

## Implementation Phases

### Phase 1: Core Foundation
- [ ] Project setup (TypeScript, ESLint, testing)
- [ ] MCP server infrastructure with stdio transport
- [ ] Security layer (path validation, command filtering)
- [ ] Basic filesystem tools (read, write, list)
- [ ] Structured logging

### Phase 2: Terminal & Search
- [ ] Terminal execution with timeout
- [ ] PTY session management (node-pty)
- [ ] Ripgrep-powered content search
- [ ] File pattern search (glob)

### Phase 3: Advanced Features
- [ ] Diff-based file editing
- [ ] Streamable HTTP transport
- [ ] Session resumability
- [ ] Progress reporting for long operations

### Phase 4: System Integration
- [ ] System information tools
- [ ] Process management
- [ ] Clipboard access
- [ ] Screenshot capture

### Phase 5: Production Hardening
- [ ] Docker containerization
- [ ] Comprehensive test suite
- [ ] Performance benchmarks
- [ ] Documentation

---

## Comparison: Just-Command vs Existing

| Feature | Filesystem MCP | Desktop Commander | Just-Command |
|---------|---------------|-------------------|--------------|
| File read/write | ✅ | ✅ | ✅ Streaming |
| Diff editing | ❌ | ✅ | ✅ Improved |
| Terminal | ❌ | ✅ | ✅ PTY sessions |
| Search (ripgrep) | ❌ | ✅ | ✅ Optimized |
| Streamable HTTP | ❌ | ❌ | ✅ |
| Docker isolation | ❌ | ✅ | ✅ Enhanced |
| Path validation | ✅ | ✅ | ✅ Strict |
| Command filtering | ❌ | ✅ | ✅ Configurable |
| Audit logging | ❌ | ✅ | ✅ Structured |
| Progress reporting | ❌ | ❌ | ✅ |
| Session resumability | ❌ | ❌ | ✅ |
| Cross-platform | ✅ | ✅ | ✅ |

---

## References

### Official Documentation
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Server Development Guide](https://github.com/cyanheads/model-context-protocol-resources)

### Analyzed Implementations
- [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP)
- [Official Filesystem Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)

### Best Practices
- [15 Best Practices for MCP Servers](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)
- [Docker MCP Best Practices](https://www.docker.com/blog/mcp-server-best-practices/)
- [MCP Security Hardening](https://socradar.io/mcp-for-cybersecurity/security-controls-hardening-the-mcp-ecosystem/)

### Libraries
- [nut.js - Desktop Automation](https://nutjs.dev/)
- [node-pty - PTY Sessions](https://github.com/microsoft/node-pty)
- [ripgrep - Fast Search](https://github.com/BurntSushi/ripgrep)
