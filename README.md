# Desktop AI (MINI PERPLEXITY)

**Universal Desktop AI Copilot** is a powerful Electron-based assistant that bridges the gap between your desktop applications and your favorite AI web-based providers (ChatGPT, Gemini, Claude, Kimi, and DeepSeek). It provides a context-aware, persistent overlay that understands what you're working on without needing paid API keys.

---

## 🌟 Key Features

- **Universal Context ID (UCID):** Automatically detects the active project or document you're working on in VS Code, Android Studio, Microsoft Word, PowerPoint, and other desktop apps.
- **Zero-Config AI Integration:** Uses isolated "hidden browser" instances to interact with your existing free/paid AI web accounts. No expensive API keys or complex backend tokens required.
- **Concurrent Multi-Provider Startup Checks:** On startup, the app checks your login sessions for ChatGPT, Gemini, Claude, Kimi, and DeepSeek in parallel. If any session has expired, it prompts a login window, allowing you to log in, and then automatically hides itself once authenticated.
- **Context-Aware Chat:** Maintains separate conversation histories for different projects, allowing for seamless context switching.
- **Screen Analysis:** Capture your current screen with a single shortcut and ask the AI to analyze it instantly.
- **Floating Overlay:** A sleek, always-on-top chat interface that stays accessible while you work.
- **Global Shortcuts:** Trigger the copilot from anywhere in your OS with customizable hotkeys.
- **Project Management:** Organize your AI interactions into logical projects that map to your real-world workflow.

---

## ⌨️ Global Shortcuts

The Copilot is designed to be keyboard-first. Use these shortcuts from any application:

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Shift+Space` | **Analyze Screen:** Captures a screenshot and opens the input window. |
| `Ctrl+Shift+Q` | **Quick Question:** Opens a text-only input window. |
| `Ctrl+Shift+U` | **Upload Files:** Opens native file picker to upload multiple files into the active context. |
| `Ctrl+Shift+O` | **Toggle Overlay:** Show or hide the floating chat window. |
| `Ctrl+Shift+J` | **Toggle Projects Panel:** Manage your projects and context mappings. |
| `Ctrl+Shift+H` | **Conversation History:** Browse previous chats. |
| `Ctrl+Shift+N` | **New Project:** Quickly create a new context-mapped project. |
| `Ctrl+Alt+R` | **Reload AI Provider:** Refresh/reload the active AI provider context browser view. |
| `Escape` | **Cancel/Close:** Cancel an active request or close windows. |

---

## 🚀 Getting Started (Step-by-Step for New Users)

If your computer does not contain any preloaded developer tools, follow these steps to get everything installed and running.

### 📋 Prerequisites & Tool Installation

#### 1. Install Git (Version Control)
* Required to download the project repository.
* **Download**: Go to [git-scm.com/downloads](https://git-scm.com/downloads) and download the installer for Windows.
* **Installation**: Run the installer and select the default options.
* **Verify**: Open Command Prompt (cmd) or PowerShell and run:
  ```bash
  git --version
  ```

#### 2. Install Node.js & npm (JavaScript Runtime)
* Required to run the Electron application.
* **Download**: Go to [nodejs.org](https://nodejs.org/) and download the **LTS (Long Term Support)** installer for Windows (v18 or higher is recommended).
* **Installation**: Run the installer, making sure the option to **"Add to PATH"** is checked.
* **Verify**: Restart your terminal and run:
  ```bash
  node -v
  npm -v
  ```

#### 3. Install Go Compiler (Optional)
* Required **only** if you want to run the programmatic gateway API backend (`ai-backend`).
* **Download**: Go to [go.dev/dl](https://go.dev/dl/) and download the installer for Windows.
* **Installation**: Run the installer and proceed with the defaults.
* **Verify**: Restart your terminal and run:
  ```bash
  go version
  ```

---

### 📦 Installation & Setup

1. **Clone the Repository**
   Open your command prompt or PowerShell and clone the codebase:
   ```bash
   git clone https://github.com/legendsaurav/MINI_PERPLEXITY-AI-API-DONIMATOR-.git
   cd MINI_PERPLEXITY-AI-API-DONIMATOR-
   ```

2. **Install Dependencies**
   Run the following command to download and install Electron and other packages:
   ```bash
   npm install
   ```

3. **Start the Copilot Application**
   Run the application using the npm start script:
   ```bash
   npm start
   ```

### ⚠️ Troubleshooting Electron Installation

If you get this error during installation or startup:
> `Error: Electron failed to install correctly, please delete node_modules/electron and try installing again`

This is a common issue on Windows where npm skips or blocks the post-install download script for the precompiled Electron binary. You can easily fix it using one of the following methods:

- **Method 1: Manually trigger the Electron downloader**:
  ```bash
  node node_modules/electron/install.js
  ```
- **Method 2: Force npm to rebuild Electron**:
  ```bash
  npm rebuild electron
  ```
- **Method 3: Re-install Electron directly**:
  ```bash
  npm install electron --save-dev
  ```
- **Method 4: Perform a clean install (Recommended for persistent issues)**:
  Delete the cache, the dependencies folder, and the lock file, and reinstall:
  ```bash
  # Delete folders and files
  rmdir /s /q node_modules
  del package-lock.json
  
  # Clear npm cache and install
  npm cache clean --force
  npm install
  ```

---

### 💡 First-Time Startup & Authentication

1. **Background Tray Execution**:
   When you run `npm start`, the app launches **hidden** by default and places an icon in your Windows system tray (bottom-right taskbar area).
2. **Concurrent Login Check**:
   - The app will automatically spin up background browsers for **ChatGPT**, **Gemini**, **Claude**, **Kimi**, and **DeepSeek**.
   - If you are **not logged in** to any of these platforms, the browser window for that specific platform will pop up automatically.
   - Go ahead and log in. Once you are authenticated, **the browser window will automatically close and hide itself**.
3. **Using the Copilot**:
   - Right-click the system tray icon to switch providers or quit the application.
   - Press `Ctrl+Shift+O` to show/hide the main Chat Overlay on your screen.
   - Start typing your query or use `Ctrl+Shift+Space` to take a screenshot and query the model!

---

## 🔗 Centralized Go Backend & API Gateway (Optional)

In addition to the Electron overlay, this repository includes a production-grade Go backend (`ai-backend`) that serves as a centralized gateway. It routes programmatic API calls to your persistent, isolated desktop browser profiles, allowing other scripts or local services to communicate with your AI accounts without direct paid API keys.

The backend features a robust file upload architecture using a state machine and Server-Sent Events (SSE). It handles context injection directly into DOM elements within the hidden browser instances, allowing for seamless multi-file analysis and prompt submission.

### 🔑 Local API Authentication

The state manager auto-generates a unique API key on your first Electron startup:
- **How to Find Your Key**: Look at the terminal output when running `npm start`. You will see a log line like:
  `[StateManager] Generated new API Key: sk-xxxx...`
- **Location on Disk**: The state is stored in your user configuration file:
  `%APPDATA%/desktop-ai-copilot/copilot-state.json` (typically under `C:\Users\<YourUsername>\AppData\Roaming\desktop-ai-copilot\copilot-state.json`).

To generate additional API keys, run the keygen tool:
```bash
cd ai-backend
go run cmd/keygen/main.go -user <username> -device <device_name>
```

### 🚀 Running the Gateway

1. Navigate to the backend directory and download dependencies:
   ```bash
   cd ai-backend
   go mod tidy
   ```
2. Start the HTTP server:
   ```bash
   go run cmd/server/main.go
   ```
   *Note: If no database is running, the gateway automatically falls back to local file-based authentication using `ai-backend/data/api_keys.json`.*

### 🛠️ Programmatic Query Request (External Script)

To route requests from other applications or models, send a POST request with your authorization header:

```bash
curl -N -H "Authorization: Bearer <YOUR_GENERATED_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"project":"General","text":"Explain how recursion works"}' \
  http://127.0.0.1:8080/v1/chat
```

---

## 📁 Project Structure

- `src/main/`: Electron main process logic (shortcuts, state, context detection).
- `src/providers/`: Logic for managing hidden browsers and AI-specific selectors.
- `src/overlay/`: Frontend for the main chat interface.
- `src/input/`: Frontend for the quick command bar.
- `src/projects/`: UI for project and context management.

---

## ⚖️ License

[MIT License](LICENSE)
