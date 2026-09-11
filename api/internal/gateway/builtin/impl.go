package builtin

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/pl3lee/uwplan/api/internal/domain/template"
)

//go:embed templates.json
var definitions []byte

type BuiltinGatewayImpl struct{}

func NewBuiltinGateway() *BuiltinGatewayImpl { return &BuiltinGatewayImpl{} }

func (g *BuiltinGatewayImpl) Fetch(ctx context.Context) (template.Seed, error) {
	if err := ctx.Err(); err != nil {
		return template.Seed{}, err
	}
	var values []struct {
		Name        string  `json:"name"`
		Description *string `json:"description"`
		Items       []struct {
			Type        template.ItemType   `json:"type"`
			Description *string             `json:"description"`
			CourseType  template.CourseType `json:"course_type"`
			CourseCodes []string            `json:"course_codes"`
			CourseCount int                 `json:"course_count"`
		} `json:"items"`
	}
	if err := json.Unmarshal(definitions, &values); err != nil {
		return template.Seed{}, fmt.Errorf("decode built-in templates: %w", err)
	}
	result := template.Seed{Templates: make([]template.Blueprint, 0, len(values))}
	for _, value := range values {
		definition := template.Blueprint{Name: value.Name, Description: value.Description, Items: make([]template.DraftItem, 0, len(value.Items))}
		for _, item := range value.Items {
			definition.Items = append(definition.Items, template.DraftItem{Type: item.Type, Description: item.Description, CourseType: item.CourseType, CourseCodes: item.CourseCodes, CourseCount: item.CourseCount})
		}
		result.Templates = append(result.Templates, definition)
	}
	return result, nil
}
