package uploads

import (
	"log/slog"
	"os"
)

// CleanDirectory recursively deletes the given directory path.
func CleanDirectory(dirPath string) {
	if dirPath == "" {
		return
	}
	slog.Info("[Upload Cleanup] Removing directory", "path", dirPath)
	if err := os.RemoveAll(dirPath); err != nil {
		slog.Error("[Upload Cleanup] Failed to remove directory", "path", dirPath, "error", err)
	}
}
