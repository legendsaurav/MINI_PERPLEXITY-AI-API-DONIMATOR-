package uploads

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/providers"
)

// UploadManager orchestrates the upload lifecycle validation, zip extraction,
// temp file storage, progress logging, and cleanup.
type UploadManager struct {
	cfg config.UploadsConfig
}

// NewManager creates a new UploadManager.
func NewManager(cfg config.UploadsConfig) *UploadManager {
	// Ensure temp dir exists
	_ = os.MkdirAll(cfg.TempDir, 0755)
	return &UploadManager{cfg: cfg}
}

// ProcessUploads processes a MessageRequest, extracting zip files if needed,
// validating limits, writing files to a temporary directory, and returning the updated
// attachments and a cleanup function.
func (m *UploadManager) ProcessUploads(
	ctx context.Context,
	workspaceID string,
	req providers.MessageRequest,
	caps providers.ProviderCapabilities,
	progressChan chan<- providers.StreamChunk,
) ([]providers.FileAttachment, string, func(), error) {
	fileID := uuid.New().String()
	LogTransition(fileID, Pending, Uploading)

	if progressChan != nil {
		progressChan <- providers.StreamChunk{
			Type:    "status",
			Content: "Validating uploaded files...",
		}
	}

	// 1. Validate size and counts
	if err := ValidateUploads(req, m.cfg); err != nil {
		LogTransition(fileID, Uploading, UploadFailed)
		return nil, "", nil, fmt.Errorf("upload validation failed: %w", err)
	}

	// Create temp directory for this request
	tempSubdir := filepath.Join(m.cfg.TempDir, workspaceID, fmt.Sprintf("%d_%s", time.Now().UnixNano(), fileID))
	if err := os.MkdirAll(tempSubdir, 0755); err != nil {
		LogTransition(fileID, Uploading, UploadFailed)
		return nil, "", nil, fmt.Errorf("failed to create temporary upload directory: %w", err)
	}

	cleanup := func() {
		CleanDirectory(tempSubdir)
	}

	var processed []providers.FileAttachment

	// 2. Process Images
	for _, img := range req.Images {
		tempPath := filepath.Join(tempSubdir, img.Filename)
		if err := os.WriteFile(tempPath, img.Data, 0644); err != nil {
			cleanup()
			LogTransition(fileID, Uploading, UploadFailed)
			return nil, "", nil, fmt.Errorf("failed to write temporary image %s: %w", img.Filename, err)
		}
		processed = append(processed, providers.FileAttachment{
			Filename: tempPath, // Pass temp absolute path
			MimeType: img.MimeType,
			Data:     img.Data,
		})
	}

	// 3. Process Files
	for _, file := range req.Files {
		isZip := strings.HasSuffix(strings.ToLower(file.Filename), ".zip")
		if isZip && !caps.ZipUpload {
			if progressChan != nil {
				progressChan <- providers.StreamChunk{
					Type:    "status",
					Content: fmt.Sprintf("Extracting files from archive %s...", file.Filename),
				}
			}
			// Extract Zip fallback
			extractedFiles, err := ExtractZipArchive(file.Data, m.cfg)
			if err != nil {
				cleanup()
				LogTransition(fileID, Uploading, UploadFailed)
				return nil, "", nil, fmt.Errorf("failed to extract zip archive: %w", err)
			}

			// Validate total files count of the request including extracted
			totalCount := len(processed) + len(extractedFiles)
			if m.cfg.MaxFilesPerUpload > 0 && totalCount > m.cfg.MaxFilesPerUpload {
				cleanup()
				LogTransition(fileID, Uploading, UploadFailed)
				return nil, "", nil, fmt.Errorf("extracted file count %d exceeds maximum allowed files %d", totalCount, m.cfg.MaxFilesPerUpload)
			}

			for _, extFile := range extractedFiles {
				tempPath := filepath.Join(tempSubdir, extFile.Filename)
				// Ensure parent directory exists (if filename has subdirectories, though Base cleans it)
				_ = os.MkdirAll(filepath.Dir(tempPath), 0755)

				if err := os.WriteFile(tempPath, extFile.Data, 0644); err != nil {
					cleanup()
					LogTransition(fileID, Uploading, UploadFailed)
					return nil, "", nil, fmt.Errorf("failed to write extracted file %s: %w", extFile.Filename, err)
				}
				processed = append(processed, providers.FileAttachment{
					Filename: tempPath, // Pass absolute temp path
					MimeType: extFile.MimeType,
					Data:     extFile.Data,
				})
			}
		} else {
			// Normal upload or provider supports ZIP directly
			tempPath := filepath.Join(tempSubdir, file.Filename)
			if err := os.WriteFile(tempPath, file.Data, 0644); err != nil {
				cleanup()
				LogTransition(fileID, Uploading, UploadFailed)
				return nil, "", nil, fmt.Errorf("failed to write temporary file %s: %w", file.Filename, err)
			}
			processed = append(processed, providers.FileAttachment{
				Filename: tempPath, // Pass absolute temp path
				MimeType: file.MimeType,
				Data:     file.Data,
			})
		}
	}

	LogTransition(fileID, Uploading, Uploaded)
	if progressChan != nil {
		progressChan <- providers.StreamChunk{
			Type:    "status",
			Content: "Upload verification complete. Analyzing...",
		}
	}

	return processed, fileID, cleanup, nil
}
