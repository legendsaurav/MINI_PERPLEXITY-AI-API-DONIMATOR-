package router

import (
	"fmt"
)

type ModelRouter struct {
	endpoints map[string]string
}

func NewModelRouter() *ModelRouter {
	return &ModelRouter{
		endpoints: make(map[string]string),
	}
}

func (r *ModelRouter) RegisterModel(name string, endpoint string) {
	r.endpoints[name] = endpoint
}

func (r *ModelRouter) GetEndpoint(modelName string) (string, error) {
	endpoint, ok := r.endpoints[modelName]
	if !ok {
		// Default or fallback
		if defaultEP, ok := r.endpoints["default"]; ok {
			return defaultEP, nil
		}
		return "", fmt.Errorf("model %s not found", modelName)
	}
	return endpoint, nil
}
