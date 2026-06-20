package api

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/antigravity/go-ai-backend/internal/providers"
)

const maxUploadSize = 50 * 1024 * 1024 // 50MB

// ParsedUpload holds the parsed multipart upload data.
type ParsedUpload struct {
	Message  string
	Project  string
	Provider string
	Images   []providers.ImageAttachment
	Files    []providers.FileAttachment
}

// ParseMultipartUpload parses a multipart form request for chat with file attachments.
func ParseMultipartUpload(r *http.Request) (*ParsedUpload, error) {
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		return nil, fmt.Errorf("failed to parse multipart form: %w", err)
	}

	result := &ParsedUpload{
		Message:  r.FormValue("message"),
		Project:  r.FormValue("project"),
		Provider: r.FormValue("provider"),
	}

	if result.Provider == "" {
		result.Provider = "chatgpt"
	}

	// Process uploaded files
	if r.MultipartForm != nil && r.MultipartForm.File != nil {
		for _, fileHeaders := range r.MultipartForm.File {
			for _, fh := range fileHeaders {
				savedPath, mimeType, err := saveUploadedFile(fh)
				if err != nil {
					return nil, fmt.Errorf("failed to save file %s: %w", fh.Filename, err)
				}

				if isImageMIME(mimeType) {
					result.Images = append(result.Images, providers.ImageAttachment{
						Path:     savedPath,
						MimeType: mimeType,
					})
				} else {
					result.Files = append(result.Files, providers.FileAttachment{
						Path:     savedPath,
						MimeType: mimeType,
					})
				}
			}
		}
	}

	return result, nil
}

func saveUploadedFile(fh *multipart.FileHeader) (string, string, error) {
	src, err := fh.Open()
	if err != nil {
		return "", "", err
	}
	defer src.Close()

	// Create temp directory for uploads
	tmpDir := filepath.Join(os.TempDir(), "ai-backend-uploads")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return "", "", err
	}

	// Create destination file
	dst, err := os.CreateTemp(tmpDir, "upload-*-"+filepath.Base(fh.Filename))
	if err != nil {
		return "", "", err
	}
	defer dst.Close()

	// Copy file content
	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(dst.Name())
		return "", "", err
	}

	// Detect MIME type from header or extension
	mimeType := fh.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = detectMIMEFromExt(fh.Filename)
	}

	return dst.Name(), mimeType, nil
}

func isImageMIME(mimeType string) bool {
	return strings.HasPrefix(mimeType, "image/")
}

func detectMIMEFromExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	mimeMap := map[string]string{
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".png":  "image/png",
		".gif":  "image/gif",
		".webp": "image/webp",
		".svg":  "image/svg+xml",
		".pdf":  "application/pdf",
		".doc":  "application/msword",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".txt":  "text/plain",
		".csv":  "text/csv",
		".json": "application/json",
		".xml":  "application/xml",
		".py":   "text/x-python",
		".go":   "text/x-go",
		".js":   "text/javascript",
		".ts":   "text/typescript",
		".zip":  "application/zip",
	}
	if mt, ok := mimeMap[ext]; ok {
		return mt
	}
	return "application/octet-stream"
}

// CleanupUploadedFiles removes temporary uploaded files.
func CleanupUploadedFiles(upload *ParsedUpload) {
	for _, img := range upload.Images {
		os.Remove(img.Path)
	}
	for _, f := range upload.Files {
		os.Remove(f.Path)
	}
}
