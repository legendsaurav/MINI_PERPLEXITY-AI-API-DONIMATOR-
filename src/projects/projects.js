/**
 * Projects Panel — Renderer Logic
 * Manages the project list UI, actions, and real-time updates.
 */
(function () {
  'use strict';

  // DOM references
  const activeContainer = document.getElementById('active-project-container');
  const projectList = document.getElementById('project-list');
  const newProjectDialog = document.getElementById('new-project-dialog');
  const newProjectInput = document.getElementById('new-project-input');
  const btnNewProject = document.getElementById('btn-new-project');
  const btnClose = document.getElementById('btn-close');
  const contextBanner = document.getElementById('context-banner');
  const contextText = document.getElementById('context-text');

  let allProjects = [];
  let activeProjectName = null;

  // ── Initialization ──
  async function init() {
    await loadProjects();
    setupListeners();
  }

  async function loadProjects() {
    try {
      const projects = await window.copilotAPI.getConversationHistory();
      const active = await window.copilotAPI.getActiveProject();
      allProjects = projects || [];
      activeProjectName = active?.name || null;
      render();
    } catch (err) {
      console.error('[Projects] Failed to load:', err);
      renderEmptyState();
    }
  }

  function setupListeners() {
    // Close button
    btnClose.addEventListener('click', () => {
      window.copilotAPI.toggleProjects();
    });

    // New project toggle
    btnNewProject.addEventListener('click', () => {
      const isVisible = newProjectDialog.style.display !== 'none';
      newProjectDialog.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        newProjectInput.value = '';
        newProjectInput.focus();
      }
    });

    // New project submit
    newProjectInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = newProjectInput.value.trim();
        if (name) {
          await window.copilotAPI.createProject(name);
          newProjectDialog.style.display = 'none';
          newProjectInput.value = '';
          await loadProjects();
        }
      } else if (e.key === 'Escape') {
        newProjectDialog.style.display = 'none';
      }
    });

    // Real-time updates
    if (window.copilotAPI.onProjectsUpdated) {
      window.copilotAPI.onProjectsUpdated(() => {
        loadProjects();
      });
    }

    // Context auto-detection updates
    if (window.copilotAPI.onContextChanged) {
      window.copilotAPI.onContextChanged((data) => {
        if (data && data.displayName) {
          contextBanner.style.display = 'flex';
          contextText.textContent = `Auto-detected: ${data.displayName}`;
        }
      });
    }

    // Project updates from main
    if (window.copilotAPI.onProjectUpdated) {
      window.copilotAPI.onProjectUpdated(() => {
        loadProjects();
      });
    }
  }

  // ── Rendering ──
  function render() {
    const activeProject = allProjects.find(p => p.project_name === activeProjectName);
    const otherProjects = allProjects.filter(p => p.project_name !== activeProjectName);

    // Render active project
    if (activeProject) {
      activeContainer.innerHTML = renderProjectCard(activeProject, true);
    } else {
      activeContainer.innerHTML = `
        <div class="empty-state" style="padding: 20px 10px;">
          <div class="empty-text" style="font-size: 12px;">No active project</div>
          <div class="empty-hint">Projects are auto-created from your active app</div>
        </div>`;
    }

    // Render project list
    if (allProjects.length === 0) {
      renderEmptyState();
    } else if (otherProjects.length === 0 && activeProject) {
      projectList.innerHTML = `
        <div class="empty-state" style="padding: 16px;">
          <div class="empty-text" style="font-size: 12px;">No other projects yet</div>
        </div>`;
    } else {
      projectList.innerHTML = otherProjects.map(p => renderProjectCard(p, false)).join('');
    }

    // Bind action buttons
    bindActions();
  }

  function renderProjectCard(project, isActive) {
    const p = project;
    const statusClass = (p.conversation_status === 'archived') ? 'archived' : 'active';
    const statusLabel = (p.conversation_status === 'archived') ? 'Archived' : 'Active';
    const displayName = p.display_name || p.project_name;
    const convTitle = p.conversation_title || null;
    const convRef = p.conversation_reference || null;
    const interactions = p.interaction_count || 0;
    const lastOpened = p.last_opened ? formatRelativeTime(p.last_opened) : 'Never';
    const provider = (p.provider || 'chatgpt').charAt(0).toUpperCase() + (p.provider || 'chatgpt').slice(1);

    let convLine;
    if (convTitle && convRef) {
      convLine = `<span class="conv-arrow">↳</span> <span class="conv-provider">${provider}:</span> <span class="conv-title">"${escapeHtml(convTitle)}"</span>`;
    } else if (convTitle) {
      convLine = `<span class="conv-arrow">↳</span> <span class="conv-provider">${provider}:</span> <span class="conv-title">"${escapeHtml(convTitle)}"</span>`;
    } else {
      convLine = `<span class="conv-arrow">↳</span> <span class="conv-none">No conversation linked</span>`;
    }

    let actions = '';
    if (isActive) {
      actions = `
        <div class="card-actions">
          ${convRef ? `<button class="action-btn btn-open" data-action="open" data-name="${escapeAttr(p.project_name)}">Open Chat</button>` : ''}
          ${convRef ? `<button class="action-btn btn-unlink" data-action="unlink" data-name="${escapeAttr(p.project_name)}">Unlink</button>` : ''}
          <button class="action-btn btn-delete" data-action="delete" data-name="${escapeAttr(p.project_name)}">Delete</button>
        </div>`;
    } else {
      actions = `
        <div class="card-actions">
          <button class="action-btn btn-switch" data-action="switch" data-name="${escapeAttr(p.project_name)}">Switch</button>
          ${convRef ? `<button class="action-btn btn-open" data-action="open" data-name="${escapeAttr(p.project_name)}">Open Chat</button>` : ''}
          <button class="action-btn btn-delete" data-action="delete" data-name="${escapeAttr(p.project_name)}">Delete</button>
        </div>`;
    }

    return `
      <div class="project-card ${isActive ? 'active' : ''}">
        <div class="card-header">
          <span class="card-icon">📁</span>
          <span class="card-name">${escapeHtml(displayName)}</span>
          <div class="card-status">
            <span class="status-dot ${statusClass}"></span>
            <span style="color: var(--text-dim)">${statusLabel}</span>
          </div>
        </div>
        <div class="card-conversation">${convLine}</div>
        <div class="card-meta">
          <span class="meta-item">🕐 ${lastOpened}</span>
          <span class="meta-item">💬 ${interactions} interactions</span>
        </div>
        ${actions}
      </div>`;
  }

  function renderEmptyState() {
    projectList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <div class="empty-text">No projects yet</div>
        <div class="empty-hint">Projects will be auto-created when you switch between apps, or click + to create one manually</div>
      </div>`;
  }

  // ── Actions ──
  function bindActions() {
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', handleAction);
    });
  }

  async function handleAction(e) {
    const action = e.currentTarget.dataset.action;
    const name = e.currentTarget.dataset.name;

    switch (action) {
      case 'switch':
        await window.copilotAPI.switchProject(name);
        await loadProjects();
        break;

      case 'open':
        await window.copilotAPI.openConversation(name);
        break;

      case 'unlink':
        showConfirm(
          'Unlink Conversation',
          `Remove the linked AI conversation from "${name}"? The conversation will still exist in ChatGPT.`,
          async () => {
            await window.copilotAPI.unlinkConversation(name);
            await loadProjects();
          }
        );
        break;

      case 'delete':
        showConfirm(
          'Delete Project',
          `Permanently delete "${name}" and all its local data? This cannot be undone.`,
          async () => {
            await window.copilotAPI.deleteProject(name);
            await loadProjects();
          }
        );
        break;
    }
  }

  // ── Confirm Dialog ──
  function showConfirm(title, message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">${escapeHtml(title)}</div>
        <div class="confirm-msg">${escapeHtml(message)}</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel">Cancel</button>
          <button class="confirm-btn danger">Confirm</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('.cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.danger').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── Helpers ──
  function formatRelativeTime(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) {
      const hours = date.getHours().toString().padStart(2, '0');
      const mins = date.getMinutes().toString().padStart(2, '0');
      return `Today ${hours}:${mins}`;
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Start ──
  document.addEventListener('DOMContentLoaded', init);
})();
