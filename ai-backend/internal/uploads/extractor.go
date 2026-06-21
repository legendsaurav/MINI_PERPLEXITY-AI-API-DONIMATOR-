package uploads

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/providers"
)

// ExtractZipArchive extracts a zip archive's contents into individual FileAttachment elements,
// filtering out system files and enforcing depth and total file count limits.
func ExtractZipArchive(zipData []byte, cfg config.UploadsConfig) ([]providers.FileAttachment, error) {
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("failed to open zip reader: %w", err)
	}

	var extracted []providers.FileAttachment
	for _, file := range reader.File {
		// Skip directories themselves
		if file.FileInfo().IsDir() {
			continue
		}

		cleanPath := filepath.ToSlash(file.Name)

		// Filter out system files, git metadata, and MACOSX metadata
		parts := strings.Split(cleanPath, "/")
		shouldSkip := false
		for _, part := range parts {
			if part == "__MACOSX" || part == ".git" || part == ".DS_Store" || strings.HasPrefix(part, "._") {
				shouldSkip = true
				break
			}
		}
		if shouldSkip {
			continue
		}

		// Enforce directory depth limit
		if cfg.MaxDirectoryDepth > 0 && len(parts) > cfg.MaxDirectoryDepth {
			return nil, fmt.Errorf("zip path %s exceeds maximum directory depth of %d", cleanPath, cfg.MaxDirectoryDepth)
		}

		// Read file contents
		rc, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("failed to open file %s in zip: %w", cleanPath, err)
		}

		var fileBytes bytes.Buffer
		_, err = io.Copy(&fileBytes, rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read file %s in zip: %w", cleanPath, err)
		}

		data := fileBytes.Bytes()

		// Detect MimeType
		mimeType := mime.TypeByExtension(filepath.Ext(cleanPath))
		if mimeType == "" {
			mimeType = http.DetectContentType(data)
		}

		extracted = append(extracted, providers.FileAttachment{
			Filename: filepath.Base(cleanPath),
			MimeType: mimeType,
			Data:     data,
		})
	}

	return extracted, nil
}
