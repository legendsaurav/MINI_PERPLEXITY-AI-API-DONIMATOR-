package config

import (
	"encoding/json"
	"os"
)

type Config struct {
	Port        string            `json:"port"`
	DatabaseURL string            `json:"database_url"`
	APIKey      string            `json:"api_key"`
	Models      map[string]string `json:"models"`
}

func LoadConfig(path string) (*Config, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var cfg Config
	if err := json.NewDecoder(file).Decode(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
