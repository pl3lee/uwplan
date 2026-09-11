package api_test

import (
	"encoding/json"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/api"
	"github.com/pl3lee/uwplan/api/internal/config"
)

func TestEmptyCourseSlotsAreNullableInOpenAPI(t *testing.T) {
	t.Parallel()
	_, app := api.NewRouter(config.Config{SecureCookies: true}, api.Dependencies{})
	for _, name := range []string{"PlanChoiceBody", "TemplateCourseItemBody", "FreeCourseBody"} {
		t.Run(name, func(t *testing.T) {
			property := app.OpenAPI().Components.Schemas.Map()[name].Properties["course_id"]
			encoded, err := json.Marshal(property)
			if err != nil {
				t.Fatal(err)
			}
			var got map[string]any
			if err := json.Unmarshal(encoded, &got); err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"type": []any{"string", "null"}}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
