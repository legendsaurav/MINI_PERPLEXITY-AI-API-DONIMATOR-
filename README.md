# Desktop AI (MINI PERPLEXITY)

**Universal Desktop AI Copilot** is a powerful Electron-based assistant that bridges the gap between your desktop applications and your favorite AI providers without needing API keys. It provides a context-aware, persistent overlay that understands what you're working on and automates provider web UIs in hidden browser windows.

---

## 🌟 Key Features

- **Zero-Config Multi-AI Integration:** Runs hidden browser instances to interact with your favorite AI web platforms including **ChatGPT**, **Gemini**, **Claude**, **Kimi Chat**, **DeepSeek**, **Perplexity**, and **Google Search AI Mode (SGE)**. No API keys required!
- **Universal Context ID (UCID):** Automatically detects the active project or document you're working on in VS Code, Android Studio, Microsoft Word, PowerPoint, and more to dynamically isolate chat sessions.
- **Dynamic Provider Cycling:** Quickly swap between AI engines on the fly using a global hotkey with automatic state synchronization.
- **Context-Aware Chat:** Maintains separate conversation histories for different projects, allowing for seamless context switching.
- **Screen Analysis (Visual Search):** Captures your active screen, uploads the screenshot natively to the active AI provider (including ChatGPT and Google AI Mode), and gets detailed context-aware assistance.
- **Floating Overlay:** A sleek, semi-transparent, always-on-top chat interface designed with modern glassmorphism that stays accessible while you work.
- **Response Sanitization:** Implements robust real-time DOM selectors and MutationObserver filter pipelines to ensure assistant responses are clean markdown, filtering out sharing links, export buttons, and feedback widgets.

---

## ⌨️ Global Shortcuts

The Copilot is designed to be keyboard-first. Use these shortcuts from any application:

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Shift+Space` | **Analyze Screen:** Captures a screenshot and opens the input window. |
| `Ctrl+Shift+Q` | **Quick Question:** Opens a text-only input window. |
| `Ctrl+Shift+O` | **Toggle Overlay:** Show or hide the floating chat window. |
| `Ctrl+Shift+P` | **Toggle Projects:** Manage your projects and context mappings. |
| `Ctrl+Shift+H` | **Conversation History:** Browse previous chats. |
| `Ctrl+Shift+M` | **Cycle Providers:** Dynamically switch AI models in the provider ring. |
| `Ctrl+Shift+N` | **New Project:** Quickly create a new context-mapped project. |
| `Ctrl+Shift+R` | **Reload AI:** Refresh the underlying AI provider state (reloads WebView). |
| `Escape` | **Cancel/Close:** Cancel an active request or close windows. |

---

## 🛠️ How It Works

### Context Detection
On Windows, the application uses PowerShell to monitor the foreground window. It extracts metadata like window titles and process names to generate a **Universal Context ID (UCID)**.
- **VS Code:** `vscode::[Project Name]`
- **Android Studio:** `androidstudio::[Project Name]`
- **Word/PowerPoint:** `[word/powerpnt]::[Document Name]`

### Zero-API Browser Automation
Instead of using expensive REST APIs or paying subscription surcharges, this app manages "hidden browsers" (Electron BrowserViews). It automates the web UI of your selected provider by:
1. **Injecting Prompts:** Escaping and inserting prompts directly into the provider's inputs. For visual search, it encodes screenshots to Blob files and injects them via mock `DataTransfer` paste actions.
2. **Streaming Observer:** Listens for DOM changes with a `MutationObserver`. If the UI buttons don't send a clean complete signal, a **3.5s text inactivity fallback** auto-completes the stream.
3. **Sanitization Filter:** The extraction parser converts HTML elements dynamically into clean markdown. It strips interactive elements like `<button>`, `<input>`, `<textarea>`, hidden elements, and specific sharing/feedback overlays (like Google SGE's `fbproxy` and `shrproxy`).

---

## 🤖 Supported AI Providers

The copilot currently automates and parses responses from the following platforms:
1. **ChatGPT:** Matches contenteditable prompt areas and streams assistant markdown.
2. **Gemini:** Interacts with Gemini's rich textareas and parses dynamic stream wrappers.
3. **Claude:** Connects securely to Claude's conversation panels with stream monitoring.
4. **Kimi Chat:** Harnesses Kimi's custom markdown renderer.
5. **DeepSeek:** Uses DeepSeek's high-speed markdown renderer.
6. **Perplexity:** Automates Perplexity search input and parses prose search queries.
7. **Google Search AI Mode:** Standard Google Search integrated with Lens-based visual search upload and clean AI Overview/SGE extraction.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm**
- **Windows OS** (Required for PowerShell-based context detection; basic features work on other OSs)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/desktop-ai-copilot.git
   cd desktop-ai-copilot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```

### Usage
- Upon startup, the app will initialize in the system tray.
- Use `Ctrl+Shift+O` to open the overlay.
- Select your preferred AI provider in the settings.
- Log in to the AI provider through the browser window if prompted.

---

## 📁 Project Structure

- `src/main/`: Electron main process logic (shortcuts, state, context detection).
- `src/providers/`: Logic for managing hidden browsers and AI-specific selectors.
- `src/overlay/`: Frontend for the main chat interface.
- `src/input/`: Frontend for the quick command bar.
- `src/projects/`: UI for project and context management.

---

## 🔑 API Key Gateway & Authentication System

The Copilot includes a secure, Supabase-backed API Key management and gateway authentication system. The backend gateway (`backend-gateway`) acts as a secure reverse proxy that authenticates incoming external requests, maintains conversation context, and enforces model access permissions.

### ⚙️ How It Works

```mermaid
sequenceDiagram
    participant External Client
    participant Backend Gateway (Go)
    participant Supabase DB
    participant Mock/Downstream LLM

    External Client->>Backend Gateway (Go): POST /v1/chat/completions (Header: Authorization: Bearer sk_copilot_...)
    Backend Gateway (Go)->>Supabase DB: Query key in 'conversations' where id = key
    Supabase DB-->>Backend Gateway (Go): Return key metadata config
    Note over Backend Gateway (Go): Validate status (active)<br/>Validate requested model<br/>Enforce or inject Conversation ID
    alt Validation Failed
        Backend Gateway (Go)-->>External Client: Return 401 Unauthorized or 403 Forbidden
    else Validation Successful
        Backend Gateway (Go)->>Supabase DB: Create conv/messages & save user input
        Backend Gateway (Go)->>Mock/Downstream LLM: Forward request with prompt context
        Mock/Downstream LLM-->>Backend Gateway (Go): Return chat completion
        Backend Gateway (Go)->>Supabase DB: Save assistant response in messages
        Backend Gateway (Go)-->>External Client: Return 200 OK Response
    end
```

### 🔐 API Key Management (Electron UI)

API keys are managed directly from the **Settings** screen inside the Electron app. 

1. **Generation:** 
   - Generates a cryptographically secure key (`sk_copilot_...`).
   - Securely stores the key as a configuration record in the remote Supabase database `conversations` table, marked with `type: "api_key_config"` inside the `metadata` JSONB column.
   - Saves username, password hash (SHA-256), allowed models, and a unique linked conversation ID.
2. **Access Control (Verify & Reveal):**
   - For security, generated keys are never shown in plain text in lists.
   - To view/reveal the plain API key, the user must authenticate by providing their username and verification password. The application verifies this against the hashed password stored in Supabase.
3. **Key Revocation:**
   - Keys can be set to `"active"` or `"inactive"`. Inactive keys are immediately rejected by the gateway.

### 🚀 Backend Gateway Setup

1. **Compile & Build the Gateway:**
   ```bash
   cd backend-gateway
   go build ./cmd/gateway
   ```
2. **Configure Environment Variables:**
   Create or update the `.env` file in the root directory:
   ```env
   SUPABASE_URL=https://cowmafailphyzkvodjdl.supabase.co
   SUPABASE_KEY=your-supabase-service-role-key
   PORT=8080
   ```
3. **Run the Server:**
   ```bash
   go run cmd/gateway/main.go
   ```

### 📡 Gateway API Validation Rules

When an external client requests the `/v1/chat/completions` endpoint:
- **Authentication:** Must provide an `Authorization: Bearer sk_copilot_...` header or an `x-api-key` header.
- **Status Check:** The key must have `status: "active"`.
- **Model Authorization:** The gateway compares the requested `model` field in the JSON body with the allowed models list (`available_models` in key metadata). Supports wildcard `*` to allow all models. Mismatched models return `403 Forbidden`.
- **Context Linkage (Conversation ID):**
  - If `conversation_id` is omitted in the JSON body, the gateway automatically injects the linked `conversation_id` from the key's metadata configuration.
  - If `conversation_id` is provided in the JSON body, it **must match** the linked `conversation_id` for that key, otherwise the gateway returns `403 Forbidden` to enforce security boundaries.

### 🧪 Automated Integration Verification

We have provided a complete integration test suite to verify the authentication system end-to-end against remote Supabase keys without needing upstream LLM accounts.

Run the test suite:
```bash
node test-api-key-bot.js
```
The test suite:
1. Dynamically provisions mock active, inactive, and wildcard keys in remote Supabase.
2. Boots up a downstream mock LLM server on port `8081`.
3. Runs the Go gateway local server on port `8080` configured to proxy to the mock LLM server.
4. Executes test cases asserting:
   - Rejected fake/missing keys (`401 Unauthorized`)
   - Rejected inactive keys (`401 Unauthorized`)
   - Model access filters (`403 Forbidden`)
   - Conversation ID context enforcement (`403 Forbidden`)
   - Successful proxying and message record verification inside the remote Supabase `messages` table (`200 OK`)
5. Tears down test keys and messages to keep database clean.

---

## ⚖️ License

[MIT License](LICENSE)
