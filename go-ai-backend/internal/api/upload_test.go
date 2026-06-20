package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/antigravity/go-ai-backend/internal/providers"
)

// ---------- isImageMIME ----------

func TestUpload_IsImageMIME_TrueForImageTypes(t *testing.T) {
	imageTypes := []string{
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"image/svg+xml",
	}
	for _, mt := range imageTypes {
		if !isImageMIME(mt) {
			t.Errorf("isImageMIME(%q) = false, want true", mt)
		}
	}
}

func TestUpload_IsImageMIME_FalseForNonImageTypes(t *testing.T) {
	nonImageTypes := []string{
		"application/pdf",
		"text/plain",
		"application/json",
		"application/octet-stream",
		"text/x-python",
		"",
	}
	for _, mt := range nonImageTypes {
		if isImageMIME(mt) {
			t.Errorf("isImageMIME(%q) = true, want false", mt)
		}
	}
}

// ---------- detectMIMEFromExt ----------

func TestUpload_DetectMIMEFromExt_KnownExtensions(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		{"photo.jpg", "image/jpeg"},
		{"photo.jpeg", "image/jpeg"},
		{"image.png", "image/png"},
		{"anim.gif", "image/gif"},
		{"pic.webp", "image/webp"},
		{"icon.svg", "image/svg+xml"},
		{"report.pdf", "application/pdf"},
		{"doc.doc", "application/msword"},
		{"doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"readme.txt", "text/plain"},
		{"data.csv", "text/csv"},
		{"config.json", "application/json"},
		{"feed.xml", "application/xml"},
		{"script.py", "text/x-python"},
		{"main.go", "text/x-go"},
		{"app.js", "text/javascript"},
		{"app.ts", "text/typescript"},
		{"archive.zip", "application/zip"},
	}
	for _, tc := range cases {
		got := detectMIMEFromExt(tc.filename)
		if got != tc.want {
			t.Errorf("detectMIMEFromExt(%q) = %q, want %q", tc.filename, got, tc.want)
		}
	}
}

func TestUpload_DetectMIMEFromExt_CaseInsensitive(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		{"PHOTO.JPG", "image/jpeg"},
		{"Image.PNG", "image/png"},
		{"Script.PY", "text/x-python"},
	}
	for _, tc := range cases {
		got := detectMIMEFromExt(tc.filename)
		if got != tc.want {
			t.Errorf("detectMIMEFromExt(%q) = %q, want %q", tc.filename, got, tc.want)
		}
	}
}

func TestUpload_DetectMIMEFromExt_UnknownExtension(t *testing.T) {
	unknowns := []string{
		"file.xyz",
		"archive.tar.gz",
		"binary.exe",
		"noextension",
	}
	for _, filename := range unknowns {
		got := detectMIMEFromExt(filename)
		if got != "application/octet-stream" {
			t.Errorf("detectMIMEFromExt(%q) = %q, want application/octet-stream", filename, got)
		}
	}
}

// ---------- CleanupUploadedFiles ----------

func TestUpload_CleanupUploadedFiles_RemovesFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create temp files to simulate uploads
	imgFile := filepath.Join(tmpDir, "test-image.png")
	if err := os.WriteFile(imgFile, []byte("fake png data"), 0644); err != nil {
		t.Fatalf("failed to create temp image file: %v", err)
	}

	docFile := filepath.Join(tmpDir, "test-doc.pdf")
	if err := os.WriteFile(docFile, []byte("fake pdf data"), 0644); err != nil {
		t.Fatalf("failed to create temp doc file: %v", err)
	}

	upload := &ParsedUpload{
		Images: []providers.ImageAttachment{
			{Path: imgFile, MimeType: "image/png"},
		},
		Files: []providers.FileAttachment{
			{Path: docFile, MimeType: "application/pdf"},
		},
	}

	// Verify files exist before cleanup
	if _, err := os.Stat(imgFile); err != nil {
		t.Fatalf("image file should exist before cleanup: %v", err)
	}
	if _, err := os.Stat(docFile); err != nil {
		t.Fatalf("doc file should exist before cleanup: %v", err)
	}

	CleanupUploadedFiles(upload)

	// Verify files are gone after cleanup
	if _, err := os.Stat(imgFile); !os.IsNotExist(err) {
		t.Errorf("image file should have been removed, but stat returned: %v", err)
	}
	if _, err := os.Stat(docFile); !os.IsNotExist(err) {
		t.Errorf("doc file should have been removed, but stat returned: %v", err)
	}
}

func TestUpload_CleanupUploadedFiles_EmptyUpload(t *testing.T) {
	// Should not panic on empty upload
	upload := &ParsedUpload{}
	CleanupUploadedFiles(upload)
}

func TestUpload_CleanupUploadedFiles_AlreadyRemovedFiles(t *testing.T) {
	// Should not panic when files are already gone
	upload := &ParsedUpload{
		Images: []providers.ImageAttachment{
			{Path: filepath.Join(os.TempDir(), "nonexistent-image-12345.png"), MimeType: "image/png"},
		},
		Files: []providers.FileAttachment{
			{Path: filepath.Join(os.TempDir(), "nonexistent-doc-12345.pdf"), MimeType: "application/pdf"},
		},
	}
	CleanupUploadedFiles(upload)
}
