const fs = require('fs/promises');
const path = require('path');
const { app } = require('electron');
const eventBus = require('./event-bus');
const stateManager = require('./state-manager');

/**
 * Default project metadata template.
 * New projects are seeded with these values.
 */
function createDefaultProject(projectName, overrides = {}) {
  return {
    project_name: projectName,
    display_name: overrides.display_name || projectName,
    ucid: overrides.ucid || '',
    provider: stateManager.get('currentProvider') || 'chatgpt',
    conversation_title: overrides.conversation_title || projectName,
    conversation_reference: '',
    conversation_status: 'active',
    interaction_count: 0,
    local_summary: '',
    auto_switch_enabled: true,
    created: new Date().toISOString(),
    last_opened: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Project Manager
 * Manages CRUD operations for project metadata stored in lightweight JSON files.
 * Each project is a subdirectory under userData/projects containing a project.json.
 */
class ProjectManager {
  constructor() {
    // Base path for projects inside the app data directory
    this.projectsPath = path.join(app.getPath('userData'), 'projects');
    this.ensureDirectory();
  }

  async ensureDirectory() {
    try {
      await fs.mkdir(this.projectsPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create projects directory:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Existing methods
  // ---------------------------------------------------------------------------

  /**
   * List all available projects
   * @returns {Promise<string[]>} list of project names
   */
  async listProjects() {
    try {
      const entries = await fs.readdir(this.projectsPath, { withFileTypes: true });
      return entries
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch (error) {
      console.error('Failed to list projects:', error);
      return [];
    }
  }

  /**
   * Get project metadata
   * @param {string} projectName
   * @returns {Promise<object|null>}
   */
  async getProject(projectName) {
    const projectFilePath = path.join(this.projectsPath, projectName, 'project.json');
    try {
      const data = await fs.readFile(projectFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is invalid
      return null;
    }
  }

  /**
   * Create or update a project
   * @param {string} projectName
   * @param {object} updates
   * @returns {Promise<object>} the complete project object
   */
  async saveProject(projectName, updates = {}) {
    const projectDir = path.join(this.projectsPath, projectName);
    const projectFilePath = path.join(projectDir, 'project.json');

    let existingData = await this.getProject(projectName);

    if (!existingData) {
      // Create new project directory and seed with defaults
      await fs.mkdir(projectDir, { recursive: true });
      existingData = createDefaultProject(projectName, updates);
    }

    const mergedData = {
      ...existingData,
      ...updates,
      last_opened: new Date().toISOString(),
    };

    await fs.writeFile(projectFilePath, JSON.stringify(mergedData, null, 2), 'utf8');

    // Update global state if this is the active project
    if (stateManager.get('currentProject') === projectName) {
      eventBus.emit('projectChanged', mergedData);
    }

    return mergedData;
  }

  /**
   * Switch the active project
   * @param {string} projectName
   */
  async switchProject(projectName) {
    const projectData = await this.getProject(projectName);
    if (projectData) {
      // Update timestamp
      await this.saveProject(projectName);
      stateManager.set('currentProject', projectName);
      stateManager.set('currentProvider', projectData.provider || 'chatgpt');
    } else {
      // Auto-create if it doesn't exist and we try to switch to it
      await this.saveProject(projectName);
      stateManager.set('currentProject', projectName);
    }
  }

  // ---------------------------------------------------------------------------
  // New methods
  // ---------------------------------------------------------------------------

  /**
   * Delete a project and its entire directory recursively
   * @param {string} name
   */
  async deleteProject(name) {
    const projectDir = path.join(this.projectsPath, name);
    try {
      await fs.rm(projectDir, { recursive: true, force: true });

      // If the deleted project was active, clear the state
      if (stateManager.get('currentProject') === name) {
        stateManager.set('currentProject', null);
      }

      eventBus.emit('projectDeleted', name);
    } catch (error) {
      console.error(`Failed to delete project "${name}":`, error);
      throw error;
    }
  }

  /**
   * List all projects with their full metadata
   * @returns {Promise<object[]>} array of project metadata objects
   */
  async listProjectsWithDetails() {
    const names = await this.listProjects();
    const details = await Promise.all(
      names.map(async (name) => {
        const data = await this.getProject(name);
        // Fallback: if project.json is missing / corrupt, return a stub
        return data || { project_name: name, display_name: name };
      })
    );
    return details;
  }

  /**
   * Update the conversation reference and title for a project
   * @param {string} name      - project name
   * @param {string} url       - conversation URL path (e.g. '/c/6a27c9aa-...')
   * @param {string} title     - conversation title
   * @returns {Promise<object>}
   */
  async updateConversationRef(name, url, title) {
    return this.saveProject(name, {
      conversation_reference: url,
      conversation_title: title,
    });
  }

  /**
   * Increment the interaction count by 1
   * @param {string} name
   * @returns {Promise<object>}
   */
  async incrementInteraction(name) {
    const data = await this.getProject(name);
    if (!data) return null;

    const count = (data.interaction_count || 0) + 1;
    return this.saveProject(name, { interaction_count: count });
  }

  /**
   * Unlink (clear) conversation reference and title
   * @param {string} name
   * @returns {Promise<object>}
   */
  async unlinkConversation(name) {
    return this.saveProject(name, {
      conversation_reference: '',
      conversation_title: '',
    });
  }

  /**
   * Rename a project by moving its directory and updating internal metadata
   * @param {string} oldName
   * @param {string} newName
   * @returns {Promise<object>} updated project data
   */
  async renameProject(oldName, newName) {
    const oldDir = path.join(this.projectsPath, oldName);
    const newDir = path.join(this.projectsPath, newName);

    try {
      await fs.rename(oldDir, newDir);
    } catch (error) {
      console.error(`Failed to rename project "${oldName}" → "${newName}":`, error);
      throw error;
    }

    // Update the project_name inside the metadata file
    const updated = await this.saveProject(newName, { project_name: newName });

    // If the renamed project was active, update state
    if (stateManager.get('currentProject') === oldName) {
      stateManager.set('currentProject', newName);
    }

    eventBus.emit('projectRenamed', { oldName, newName });
    return updated;
  }

  /**
   * Find a project by its Universal Context ID (UCID)
   * @param {string} ucid
   * @returns {Promise<object|null>}
   */
  async findByUCID(ucid) {
    const projects = await this.listProjectsWithDetails();
    return projects.find((p) => p.ucid === ucid) || null;
  }

  /**
   * Get an existing project by UCID or create one if it doesn't exist
   * @param {string} ucid        - e.g. 'vscode::my-project'
   * @param {string} displayName - human-readable name used when creating
   * @returns {Promise<object>}
   */
  async getOrCreateByUCID(ucid, displayName) {
    const existing = await this.findByUCID(ucid);
    if (existing) return existing;

    // Derive a filesystem-safe project name from the UCID
    const safeName = ucid.replace(/[^a-zA-Z0-9_-]/g, '_');

    return this.saveProject(safeName, {
      display_name: displayName || safeName,
      ucid,
    });
  }
}

module.exports = new ProjectManager();
