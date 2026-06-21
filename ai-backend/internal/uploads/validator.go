package uploads

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/providers"
)

// ParseSizeString parses size strings like "500MB", "2GB", "10KB", "100B" into bytes.
func ParseSizeString(sizeStr string) (int64, error) {
	sizeStr = strings.TrimSpace(strings.ToUpper(sizeStr))
	if sizeStr == "" {
		return 0, nil
	}

	re := regexp.MustCompile(`^([0-9.]+)\s*(B|KB|MB|GB|TB)?$`)
	matches := re.FindStringSubmatch(sizeStr)
	if len(matches) != 3 {
		return 0, fmt.Errorf("invalid size format: %s", sizeStr)
	}

	val, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %s", matches[1])
	}

	var multiplier float64 = 1
	switch matches[2] {
	case "KB":
		multiplier = 1024
	case "MB":
		multiplier = 1024 * 1024
	case "GB":
		multiplier = 1024 * 1024 * 1024
	case "TB":
		multiplier = 1024 * 1024 * 1024 * 1024
	}

	return int64(val * multiplier), nil
}

// ValidateUploads performs preliminary validation against global configuration limits.
func ValidateUploads(req providers.MessageRequest, cfg config.UploadsConfig) error {
	maxFileSize, err := ParseSizeString(cfg.MaxFileSize)
	if err != nil {
		return fmt.Errorf("invalid MaxFileSize config: %w", err)
	}
	maxZipSize, err := ParseSizeString(cfg.MaxZipSize)
	if err != nil {
		return fmt.Errorf("invalid MaxZipSize config: %w", err)
	}
	maxTotalSize, err := ParseSizeString(cfg.MaxTotalRequestSize)
	if err != nil {
		return fmt.Errorf("invalid MaxTotalRequestSize config: %w", err)
	}

	var totalFilesCount int
	var totalSize int64

	// Validate Images
	for _, img := range req.Images {
		totalFilesCount++
		size := int64(len(img.Data))
		totalSize += size

		if maxFileSize > 0 && size > maxFileSize {
			return fmt.Errorf("image %s size %d exceeds limit of %d bytes", img.Filename, size, maxFileSize)
		}
	}

	// Validate Files
	for _, file := range req.Files {
		totalFilesCount++
		size := int64(len(file.Data))
		totalSize += size

		// Check if it is a ZIP archive
		isZip := strings.HasSuffix(strings.ToLower(file.Filename), ".zip")
		if isZip {
			if maxZipSize > 0 && size > maxZipSize {
				return fmt.Errorf("zip archive %s size %d exceeds limit of %d bytes", file.Filename, size, maxZipSize)
			}
		} else {
			if maxFileSize > 0 && size > maxFileSize {
				return fmt.Errorf("file %s size %d exceeds limit of %d bytes", file.Filename, size, maxFileSize)
			}
		}
	}

	if cfg.MaxFilesPerUpload > 0 && totalFilesCount > cfg.MaxFilesPerUpload {
		return fmt.Errorf("total files count %d exceeds limit of %d", totalFilesCount, cfg.MaxFilesPerUpload)
	}

	if maxTotalSize > 0 && totalSize > maxTotalSize {
		return fmt.Errorf("total request size %d exceeds limit of %d bytes", totalSize, maxTotalSize)
	}

	return nil
}
