/**
 * Prompt Builder
 * Takes the strict JSON context object from Context Engine and formats it
 * into the final prompt text string to be sent to the AI Provider.
 * This ensures clean separation between extraction and formatting.
 */
class PromptBuilder {
  /**
   * Formats the context object into a unified prompt string
   * @param {object} context Strict JSON context from Context Engine
   * @returns {string} The final formatted prompt
   */
  build(context) {
    // If we are in Context Freeze mode and this is a follow-up question
    // (identified by not having image_base64 attached or explicit flag)
    // For MVP, if it's a frozen context we can just prefix it simply or send the raw question.
    
    // In a real system, we might only send the image on the first prompt, 
    // and subsequent prompts just contain the text to avoid re-uploading.
    
    let promptText = '';

    // If it's a fresh context capture, include the metadata block
    if (!context.freeze || (context.freeze && !context.isFollowUp)) {
      promptText += `[System Context]\n`;
      promptText += `- Active Application: ${context.application}\n`;
      promptText += `- Window Title: ${context.window_title}\n`;
      promptText += `- Project Context: ${context.project}\n`;
      
      if (context.selected_text) {
        promptText += `\n[Selected Text]\n${context.selected_text}\n`;
      }
      
      promptText += `\n[User Request]\n`;
    }

    // Always append the actual user question
    promptText += context.question;

    return promptText.trim();
  }
}

module.exports = new PromptBuilder();
