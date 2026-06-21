package uploads

import (
	"log/slog"
)

type UploadState string

const (
	Pending           UploadState = "PENDING"
	Uploading         UploadState = "UPLOADING"
	Uploaded          UploadState = "UPLOADED"
	Processing        UploadState = "PROCESSING"
	Ready             UploadState = "READY"
	PromptSubmitted   UploadState = "PROMPT_SUBMITTED"
	Generating        UploadState = "GENERATING"
	Completed         UploadState = "COMPLETED"
	UploadFailed      UploadState = "UPLOAD_FAILED"
	ProcessingFailed  UploadState = "PROCESSING_FAILED"
	Timeout           UploadState = "TIMEOUT"
	Cancelled         UploadState = "CANCELLED"
)

// LogTransition logs state machine changes with structured logging.
func LogTransition(fileID string, fromState, toState UploadState) {
	slog.Info("[Upload State Machine] Transition",
		"file_id", fileID,
		"from", fromState,
		"to", toState,
	)
}
