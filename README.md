# Just-Command

> A next-generation MCP server that combines the best of Filesystem MCP, Windows-MCP, and Desktop Commander

**Control your PC and enhance Claude.ai** with a powerful, stable, optimized, and fast Model Context Protocol server.

## Vision

Just-Command aims to be the most capable MCP server for desktop control and file management, providing:

- **Superior Performance** - Streaming I/O, ripgrep-powered search, efficient resource usage
- **Rock-Solid Stability** - Robust error handling, PTY session management, graceful recovery
- **Security First** - Path validation, command filtering, Docker isolation, audit logging
- **Modern Protocol** - Streamable HTTP transport, structured outputs, session resumability

## Planned Features

### Core Capabilities

| Module | Features |
|--------|----------|
| **Filesystem** | Read/write/edit files, directory operations, streaming for large files |
| **Terminal** | Execute commands, PTY sessions, process management |
| **Search** | Ripgrep-powered content search, glob file patterns, search & replace |
| **System** | System info, process list, clipboard, screenshots |

### Key Improvements Over Existing Servers

| Feature | Just-Command | Desktop Commander | Filesystem MCP |
|---------|-------------|-------------------|----------------|
| Streamable HTTP | ✅ | ❌ | ❌ |
| Streaming file I/O | ✅ | ❌ | ❌ |
| PTY sessions | ✅ | ✅ | ❌ |
| Session resumability | ✅ | ❌ | ❌ |
| Progress reporting | ✅ | ❌ | ❌ |
| Structured outputs | ✅ | Partial | ❌ |

## Technology Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Protocol**: @modelcontextprotocol/sdk
- **Search**: @vscode/ripgrep
- **Terminal**: node-pty
- **Validation**: Zod

## Documentation

- [Architecture & Implementation Plan](./docs/ARCHITECTURE.md)

## Status

🚧 **Planning Phase** - Architecture designed, implementation pending

## License

MIT
