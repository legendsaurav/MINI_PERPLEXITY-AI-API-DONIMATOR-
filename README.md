# Desktop AI Copilot

**Universal Desktop AI Copilot** is a powerful Electron-based assistant that bridges the gap between your desktop applications and your favorite AI providers (ChatGPT, Gemini, etc.). It provides a context-aware, persistent overlay that understands what you're working on without needing API keys.

---

## 🌟 Key Features

-   **Universal Context ID (UCID):** Automatically detects the active project or document you're working on in VS Code, Android Studio, Microsoft Word, PowerPoint, and more.
-   **Zero-Config AI Integration:** Uses hidden browser instances to interact with your existing AI web accounts (ChatGPT, Gemini). No expensive API keys or complex setups required.
-   **Context-Aware Chat:** Maintains separate conversation histories for different projects, allowing for seamless context switching.
-   **Screen Analysis:** Capture your current screen with a single shortcut and ask the AI to analyze it instantly.
-   **Floating Overlay:** A sleek, always-on-top chat interface that stays accessible while you work.
-   **Global Shortcuts:** Trigger the copilot from anywhere in your OS with customizable hotkeys.
-   **Project Management:** Organize your AI interactions into logical projects that map to your real-world workflow.

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
| `Ctrl+Shift+N` | **New Project:** Quickly create a new context-mapped project. |
| `Ctrl+Shift+R` | **Reload AI:** Refresh the underlying AI provider state. |
| `Escape` | **Cancel/Close:** Cancel an active request or close windows. |

---

## 🛠️ How It Works

### Context Detection
On Windows, the application uses PowerShell to monitor the foreground window. It extracts metadata like window titles and process names to generate a **Universal Context ID (UCID)**.
-   **VS Code:** `vscode::[Project Name]`
-   **Android Studio:** `androidstudio::[Project Name]`
-   **Word/PowerPoint:** `[word/powerpnt]::[Document Name]`

### Browser-Based AI
Instead of using REST APIs, this app manages "hidden browsers" (Electron BrowserViews). It automates the web UI of ChatGPT and Gemini by:
1.  **Injecting Prompts:** Directly into the web-based textareas.
2.  **Streaming Responses:** Using `MutationObserver` to watch for DOM changes and stream the AI's response back to the overlay in real-time.

---

## 🚀 Getting Started

### Prerequisites
-   **Node.js** (v18 or higher recommended)
-   **npm**
-   **Windows OS** (Required for PowerShell-based context detection; basic features work on other OSs)

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/your-repo/desktop-ai-copilot.git
    cd desktop-ai-copilot
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the application:
    ```bash
    npm start
    ```

### Usage
-   Upon startup, the app will initialize in the system tray.
-   Use `Ctrl+Shift+O` to open the overlay.
-   Select your preferred AI provider in the settings.
-   Log in to the AI provider through the browser window if prompted.

---

## 📁 Project Structure

-   `src/main/`: Electron main process logic (shortcuts, state, context detection).
-   `src/providers/`: Logic for managing hidden browsers and AI-specific selectors.
-   `src/overlay/`: Frontend for the main chat interface.
-   `src/input/`: Frontend for the quick command bar.
-   `src/projects/`: UI for project and context management.

---

## ⚖️ License

[MIT License](LICENSE)
"# MINI_PERPLEXITY-AI-API-DONIMATOR-" 
"# MINI_PERPLEXITY-AI-API-DONIMATOR-" 
