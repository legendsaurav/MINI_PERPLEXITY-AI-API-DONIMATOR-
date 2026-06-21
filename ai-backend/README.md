# AI Backend — Centralized Workspace Gateway

A production-quality Go backend that routes secure API keys to isolated AI workspaces with persistent browser profiles.

## Architecture

```
Client → Authorization: Bearer <API_KEY> → Auth Middleware → Workspace Resolver
→ Project Resolver → Browser Pool → Provider (ChatGPT/Gemini/Claude) → SSE Stream → Client
```

The client only provides an API key and a project name. Everything else is resolved internally.

## Quick Start

```bash
# 1. Install dependencies
go mod tidy

# 2. Set up PostgreSQL & run migrations
psql -U postgres -d ai_backend -f internal/database/migrations/001_initial.sql

# 3. Run the server
go run cmd/server/main.go
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/health` | No | Health check + pool stats |
| POST | `/v1/chat` | Yes | Send a message and stream response (SSE) |
| POST | `/v1/project/create` | Yes | Create a new project |
| GET | `/v1/projects` | Yes | List all projects in workspace |
| GET | `/v1/workspace` | Yes | Get workspace info |
| GET | `/v1/providers` | Yes | List available AI providers |

## Usage Example

### 🔑 Active API Key for External Models
We have generated a pre-configured, active API key for you:
- **API Key**: `sk-2ffc5d5769594673b2ae8b5173108d91`
- **Username**: `other_models`
- **Device**: `external_api`

To generate additional API keys:
```bash
go run cmd/keygen/main.go -user <username> -device <device_name>
```

### Chat with AI
```bash
curl -N -H "Authorization: Bearer sk-2ffc5d5769594673b2ae8b5173108d91" \
  -H "Content-Type: application/json" \
  -d '{"project":"Coding","message":"Explain Go interfaces"}' \
  http://localhost:8080/v1/chat
```


## Project Structure

```
ai-backend/
├── cmd/server/main.go          # Entry point
├── config.yaml                 # Configuration
├── internal/
│   ├── api/                    # HTTP router & handlers
│   ├── auth/                   # API key validation middleware
│   ├── browser/                # Browser pool & profile manager
│   ├── config/                 # YAML + env config loader
│   ├── database/               # PostgreSQL connection & models
│   ├── engine/                 # BrowserEngine interface + stubs
│   ├── maintenance/            # Background cleanup workers
│   ├── providers/              # Provider interface + registry
│   │   └── chatgpt/            # ChatGPT DOM automation
│   ├── scheduler/              # Browser slot allocator
│   ├── streaming/              # SSE streaming engine
│   └── workspace/              # Workspace & project resolver
└── data/browser_profiles/      # Persistent browser profiles
```

## Configuration

Environment variable overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_BACKEND_SERVER_PORT` | 8080 | HTTP server port |
| `AI_BACKEND_DB_HOST` | localhost | PostgreSQL host |
| `AI_BACKEND_DB_NAME` | ai_backend | Database name |
| `AI_BACKEND_BROWSER_MAX` | 3 | Max concurrent browsers |
| `AI_BACKEND_BROWSER_IDLE_TIMEOUT` | 300 | Idle browser timeout (seconds) |
